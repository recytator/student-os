import { warsawMidnight } from '../shared/time';
export { warsawMidnight } from '../shared/time';
import { z } from 'zod';
import {
  approvalSchema,
  documentPatchSchema,
  documentUploadSchema,
  preferencesInputSchema,
  type DocumentAgentOutput,
  type DocumentPage,
  type ProposedTask,
  type StudyBlock,
  type ReviewAgentOutput,
  type ClassSchedule,
  type CalendarEvent,
  type Preferences,
  type Task,
} from '../shared/contracts';
import {
  AgentProviderError,
  callAgent,
  contextualChunks,
  hasEvidence,
  independentReview,
  overlaps,
  dateInEvidence,
  warsawDate,
  type AgentName,
  type AiBinding,
} from './agents';
import { HttpError, json, readJson, type Env, type User } from './types';

export interface ReviewIdReconciliation {
  unknown_ids: string[];
  duplicate_ids: string[];
  conflicting_ids: string[];
  omitted_ids: string[];
  independently_rejected_ids: string[];
}

/** A missing or ambiguous model decision is always rejection, never implicit approval. */
export function reconcileReviewIds(
  modelReview: ReviewAgentOutput,
  proposalIds: readonly string[],
  independentlyAccepted: ReadonlySet<string>,
): { review: ReviewAgentOutput; reconciliation: ReviewIdReconciliation } {
  const known = new Set(proposalIds);
  const acceptedCounts = new Map<string, number>();
  const rejectedCounts = new Map<string, number>();
  for (const proposalId of modelReview.accepted_ids)
    acceptedCounts.set(proposalId, (acceptedCounts.get(proposalId) || 0) + 1);
  for (const proposalId of modelReview.rejected_ids)
    rejectedCounts.set(proposalId, (rejectedCounts.get(proposalId) || 0) + 1);
  const mentioned = new Set([...acceptedCounts.keys(), ...rejectedCounts.keys()]);
  const reconciliation: ReviewIdReconciliation = {
    unknown_ids: [...mentioned].filter((proposalId) => !known.has(proposalId)),
    duplicate_ids: [...mentioned].filter(
      (proposalId) =>
        (acceptedCounts.get(proposalId) || 0) > 1 || (rejectedCounts.get(proposalId) || 0) > 1,
    ),
    conflicting_ids: [...known].filter(
      (proposalId) => acceptedCounts.has(proposalId) && rejectedCounts.has(proposalId),
    ),
    omitted_ids: [...known].filter((proposalId) => !mentioned.has(proposalId)),
    independently_rejected_ids: [...known].filter(
      (proposalId) =>
        acceptedCounts.get(proposalId) === 1 &&
        !rejectedCounts.has(proposalId) &&
        !independentlyAccepted.has(proposalId),
    ),
  };
  const accepted = [...known].filter(
    (proposalId) =>
      acceptedCounts.get(proposalId) === 1 &&
      !rejectedCounts.has(proposalId) &&
      independentlyAccepted.has(proposalId),
  );
  const acceptedSet = new Set(accepted);
  const issues: ReviewAgentOutput['issues'] = [];
  const warn = (proposalId: string | null, message: string): void => {
    issues.push({
      proposal_id: proposalId,
      severity: 'warning',
      code: 'invalid_structure',
      message,
    });
  };
  if (reconciliation.unknown_ids.length)
    warn(
      null,
      `ReviewAgent wskazał nieznane identyfikatory; zostały pominięte: ${reconciliation.unknown_ids.join(', ')}`.slice(
        0,
        800,
      ),
    );
  for (const proposalId of reconciliation.duplicate_ids.filter((proposalId) =>
    known.has(proposalId),
  ))
    warn(
      proposalId,
      'ReviewAgent powtórzył identyfikator. Propozycja została zachowawczo odrzucona.',
    );
  for (const proposalId of reconciliation.conflicting_ids)
    warn(
      proposalId,
      'ReviewAgent jednocześnie zaakceptował i odrzucił propozycję. Zastosowano odrzucenie.',
    );
  for (const proposalId of reconciliation.omitted_ids)
    warn(
      proposalId,
      'ReviewAgent nie wydał decyzji o tej propozycji. Nie uznano jej za zaakceptowaną.',
    );
  for (const proposalId of reconciliation.independently_rejected_ids)
    issues.push({
      proposal_id: proposalId,
      severity: 'warning',
      code: 'other',
      message: 'Niezależny walidator odrzucił propozycję pomimo zgody ReviewAgent.',
    });
  const repaired =
    reconciliation.unknown_ids.length +
      reconciliation.duplicate_ids.length +
      reconciliation.conflicting_ids.length +
      reconciliation.omitted_ids.length >
    0;
  return {
    review: {
      ...modelReview,
      accepted_ids: accepted,
      rejected_ids: [...known].filter((proposalId) => !acceptedSet.has(proposalId)),
      issues: [...issues, ...modelReview.issues].slice(0, 100),
      summary: repaired
        ? `Zachowawczo uzgodniono decyzje ReviewAgent: ${accepted.length} zaakceptowanych, ${known.size - accepted.length} odrzuconych. ${modelReview.summary}`.slice(
            0,
            2000,
          )
        : modelReview.summary,
    },
    reconciliation,
  };
}

const VERSION = 'v4-guided-json';
class WorkflowValidationError extends Error {
  constructor(
    public readonly validationCode: 'DOCUMENT_SOURCE' | 'DEADLINE_SOURCE' | 'VALIDATION',
  ) {
    super(validationCode);
  }
}
const MAX_CALLS = 12;
const MAX_ANALYSES_PER_DAY = 4;
export const MAX_CALLS_PER_DAY = 24;
const MODELS = ['@cf/zai-org/glm-4.7-flash', '@cf/google/gemma-4-26b-a4b-it'];
interface DocumentRecord {
  id: string;
  user_id: string;
  name: string;
  hash: string;
  subject_id: string | null;
  academic_year: string;
  page_count: number;
  text_length: number;
}
interface Context {
  chunk: number;
  documents: DocumentAgentOutput[];
  proposals: ProposedTask[];
  blocks: StudyBlock[];
  review: ReviewAgentOutput | null;
  revision: number;
  warnings: string[];
}
interface Run {
  id: string;
  user_id: string;
  document_id: string;
  state: string;
  context_json: string;
  model: string;
  calls: number;
  retries: number;
  lease_until: number;
  lease_token: string | null;
  error: string | null;
  created_at: string;
}
const initialContext = (): Context => ({
  chunk: 0,
  documents: [],
  proposals: [],
  blocks: [],
  review: null,
  revision: 0,
  warnings: [],
});
const id = () => crypto.randomUUID();
const nowISO = () => new Date().toISOString();
async function sha256(value: string): Promise<string> {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))),
    (b) => b.toString(16).padStart(2, '0'),
  ).join('');
}
function insertRows(
  env: Env,
  table: string,
  columns: string[],
  rows: unknown[][],
  guard?: { runId: string; token: string },
  conflict = '',
): D1PreparedStatement[] {
  const size = Math.floor((100 - (guard ? 2 : 0)) / columns.length);
  const statements: D1PreparedStatement[] = [];
  for (let offset = 0; offset < rows.length; offset += size) {
    const chunk = rows.slice(offset, offset + size);
    if (guard) {
      const values = chunk.map(() => `(${columns.map(() => '?').join(',')})`).join(',');
      const selectedColumns = columns.map((_, index) => `column${index + 1}`).join(',');
      statements.push(
        env.DB.prepare(
          `INSERT INTO ${table}(${columns.join(',')}) SELECT ${selectedColumns} FROM (VALUES ${values}) WHERE EXISTS(SELECT 1 FROM agent_runs WHERE id=? AND lease_token=?) ${conflict}`,
        ).bind(...chunk.flat(), guard.runId, guard.token),
      );
    } else
      statements.push(
        env.DB.prepare(
          `INSERT INTO ${table}(${columns.join(',')}) VALUES ${chunk.map(() => `(${columns.map(() => '?').join(',')})`).join(',')}`,
        ).bind(...chunk.flat()),
      );
  }
  return statements;
}
async function ownedDocument(
  env: Env,
  userId: string,
  documentId: string,
): Promise<DocumentRecord> {
  const row = await env.DB.prepare('SELECT * FROM documents WHERE id=? AND user_id=?')
    .bind(documentId, userId)
    .first<DocumentRecord>();
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'Nie znaleziono dokumentu.');
  return row;
}
async function ownedRun(env: Env, userId: string, runId: string): Promise<Run> {
  const row = await env.DB.prepare('SELECT * FROM agent_runs WHERE id=? AND user_id=?')
    .bind(runId, userId)
    .first<Run>();
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'Nie znaleziono analizy.');
  return row;
}
async function pagesFor(env: Env, userId: string, documentId: string): Promise<DocumentPage[]> {
  return (
    await env.DB.prepare(
      'SELECT page,text FROM document_sections WHERE document_id=? AND user_id=? ORDER BY page',
    )
      .bind(documentId, userId)
      .all<DocumentPage>()
  ).results;
}
async function preferencesFor(env: Env, userId: string): Promise<Preferences> {
  const row = await env.DB.prepare('SELECT value_json FROM user_preferences WHERE user_id=?')
    .bind(userId)
    .first<{ value_json: string }>();
  return preferencesInputSchema.parse(row ? JSON.parse(row.value_json) : {});
}
async function recordsFor(env: Env, userId: string) {
  const [tasks, events, schedules] = await Promise.all([
    env.DB.prepare(
      "SELECT id,user_id,subject_id,document_id,title,due_date,priority,status,'' AS notes,created_at,updated_at FROM tasks WHERE user_id=? ORDER BY due_date LIMIT 500",
    )
      .bind(userId)
      .all<Task>(),
    env.DB.prepare(
      'SELECT id,user_id,subject_id,document_id,title,start_at,end_at,location,created_at,updated_at FROM calendar_events WHERE user_id=? ORDER BY start_at LIMIT 500',
    )
      .bind(userId)
      .all<CalendarEvent>(),
    env.DB.prepare(
      'SELECT id,user_id,subject_id,weekday,start_time,end_time,valid_from,valid_to,location,created_at,updated_at FROM class_schedules WHERE user_id=? LIMIT 200',
    )
      .bind(userId)
      .all<ClassSchedule>(),
  ]);
  // Never silently omit data that the planner must consider.
  if (
    tasks.results.length === 500 ||
    events.results.length === 500 ||
    schedules.results.length === 200
  )
    throw new HttpError(
      422,
      'PLANNING_LIMIT',
      'Zbyt dużo rekordów do bezpiecznej analizy. Usuń archiwalne dane.',
    );
  return { tasks: tasks.results, events: events.results, schedules: schedules.results };
}
export async function runDetail(env: Env, userId: string, runId: string) {
  const run = await ownedRun(env, userId, runId);
  const [steps, result] = await Promise.all([
    env.DB.prepare('SELECT * FROM agent_steps WHERE run_id=? AND user_id=? ORDER BY started_at,id')
      .bind(runId, userId)
      .all(),
    env.DB.prepare('SELECT * FROM analysis_results WHERE run_id=? AND user_id=?')
      .bind(runId, userId)
      .first<{
        proposals_json: string;
        blocks_json: string;
        review_json: string;
        approved_at: string | null;
      }>(),
  ]);
  return {
    run: { ...run, context_json: undefined, lease_token: undefined },
    steps: steps.results,
    result: result
      ? {
          proposals: JSON.parse(result.proposals_json),
          blocks: JSON.parse(result.blocks_json),
          review: JSON.parse(result.review_json),
          approved_at: result.approved_at,
        }
      : null,
  };
}
export async function startRun(env: Env, userId: string, documentId: string, force = false) {
  const document = await ownedDocument(env, userId, documentId);
  const preferences = await preferencesFor(env, userId);
  if (!preferences.ai_enabled)
    throw new HttpError(403, 'AI_DISABLED', 'Analiza AI jest wyłączona w preferencjach.');
  const model = env.AI_MODEL || MODELS[0];
  if (!MODELS.includes(model))
    throw new HttpError(
      503,
      'MODEL_CONFIG',
      'Model AI nie znajduje się na dozwolonej liście darmowych modeli.',
    );
  const snapshot = await recordsFor(env, userId);
  const snapshotHash = await sha256(
    JSON.stringify({
      tasks: snapshot.tasks,
      events: snapshot.events,
      schedules: snapshot.schedules,
      preferences,
    }),
  );
  const cacheKey = await sha256(
    `${VERSION}|${document.hash}|${model}|${document.academic_year}|${snapshotHash}`,
  );
  const active = await env.DB.prepare(
    "SELECT id FROM agent_runs WHERE user_id=? AND document_id=? AND state IN ('document','deadline','planner','review','approval') ORDER BY created_at DESC LIMIT 1",
  )
    .bind(userId, documentId)
    .first<{ id: string }>();
  if (active) {
    const activeRun = await ownedRun(env, userId, active.id);
    if (!force) return { run: (await runDetail(env, userId, active.id)).run, cached: true };
    if (activeRun.lease_until > Date.now())
      throw new HttpError(
        409,
        'RUN_BUSY',
        'Poczekaj na zakończenie aktualnego etapu przed ponowną analizą.',
      );
    await env.DB.prepare(
      "UPDATE agent_runs SET state='failed',error='Użytkownik zlecił ponowną analizę.',updated_at=? WHERE id=? AND user_id=? AND lease_until<?",
    )
      .bind(nowISO(), active.id, userId, Date.now())
      .run();
  }
  const cached = await env.DB.prepare(
    "SELECT id FROM agent_runs WHERE user_id=? AND cache_key=? AND state='committed' ORDER BY created_at DESC LIMIT 1",
  )
    .bind(userId, cacheKey)
    .first<{ id: string }>();
  if (cached && !force) return { run: (await runDetail(env, userId, cached.id)).run, cached: true };
  const day = warsawDate(nowISO());
  const reservation = await env.DB.prepare(
    `INSERT INTO ai_usage(user_id,day,analyses) VALUES (?,?,1) ON CONFLICT(user_id,day) DO UPDATE SET analyses=analyses+1 WHERE analyses<? RETURNING analyses`,
  )
    .bind(userId, day, MAX_ANALYSES_PER_DAY)
    .first();
  if (!reservation)
    throw new HttpError(
      429,
      'AI_LIMIT',
      `Wykorzystano limit ${MAX_ANALYSES_PER_DAY} analiz dziennie. Dokument jest zapisany; zadania i kalendarz nadal działają.`,
    );
  const runId = id();
  try {
    await env.DB.prepare(
      'INSERT INTO agent_runs(id,user_id,document_id,model,cache_key,context_json) VALUES(?,?,?,?,?,?)',
    )
      .bind(runId, userId, documentId, model, cacheKey, JSON.stringify(initialContext()))
      .run();
  } catch (error) {
    const concurrent = await env.DB.prepare(
      "SELECT id FROM agent_runs WHERE user_id=? AND document_id=? AND state IN ('document','deadline','planner','review','approval') LIMIT 1",
    )
      .bind(userId, documentId)
      .first<{ id: string }>();
    if (concurrent) return { run: (await runDetail(env, userId, concurrent.id)).run, cached: true };
    throw error;
  }
  return { run: (await runDetail(env, userId, runId)).run, cached: false };
}
const availabilityFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Warsaw',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
export function blockFitsAvailability(
  block: StudyBlock,
  preferences: Preferences,
  schedules: ClassSchedule[],
): boolean {
  const local = (value: string) => {
    const parts = availabilityFormatter.formatToParts(new Date(value));
    const part = (type: string) => parts.find((p) => p.type === type)?.value || '';
    return {
      date: `${part('year')}-${part('month')}-${part('day')}`,
      time: `${part('hour')}:${part('minute')}`,
      weekday: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(part('weekday')) + 1,
    };
  };
  const a = local(block.start_at),
    b = local(block.end_at);
  return (
    a.date === b.date &&
    preferences.study_days.includes(a.weekday) &&
    a.time >= preferences.available_from &&
    b.time <= preferences.available_to &&
    !schedules.some(
      (s) =>
        s.weekday === a.weekday &&
        a.date >= s.valid_from &&
        a.date <= s.valid_to &&
        a.time < s.end_time &&
        s.start_time < b.time,
    )
  );
}
export async function advanceRun(env: Env, userId: string, runId: string) {
  const before = await ownedRun(env, userId, runId);
  if (['approval', 'committed', 'failed'].includes(before.state))
    return runDetail(env, userId, runId);
  const token = id(),
    started = Date.now(),
    startedAt = nowISO();
  if (before.lease_token && before.lease_until < started && before.retries >= 1) {
    await env.DB.prepare(
      "UPDATE agent_runs SET state='failed',lease_token=NULL,lease_until=0,error='Wygasła dzierżawa etapu; limit ponowień został wyczerpany.' WHERE id=? AND user_id=? AND lease_until<?",
    )
      .bind(runId, userId, started)
      .run();
    return runDetail(env, userId, runId);
  }
  const run = await env.DB.prepare(
    `UPDATE agent_runs SET retries=retries+CASE WHEN lease_token IS NULL THEN 0 ELSE 1 END,lease_until=?,lease_token=?,calls=calls+1,updated_at=? WHERE id=? AND user_id=? AND lease_until<? AND calls<? AND state NOT IN ('approval','committed','failed') RETURNING *`,
  )
    .bind(started + 300_000, token, startedAt, runId, userId, started, MAX_CALLS)
    .first<Run>();
  if (!run) {
    if (before.calls >= MAX_CALLS) {
      await env.DB.prepare(
        "UPDATE agent_runs SET state='failed',error='Wyczerpano limit 12 wywołań modelu.',updated_at=? WHERE id=? AND user_id=? AND lease_until<?",
      )
        .bind(nowISO(), runId, userId, Date.now())
        .run();
      return runDetail(env, userId, runId);
    }
    throw new HttpError(
      409,
      'RUN_BUSY',
      'Ten etap już jest wykonywany. Poczekaj na zapis punktu kontrolnego.',
    );
  }
  await env.DB.prepare(
    "UPDATE agent_steps SET state='failed',finished_at=?,error='Dzierżawa poprzedniego żądania wygasła; wznowiono z punktu kontrolnego.' WHERE run_id=? AND user_id=? AND state='running'",
  )
    .bind(startedAt, runId, userId)
    .run();
  const stepId = id();
  const names: Record<string, AgentName> = {
    document: 'DocumentAgent',
    deadline: 'DeadlineAgent',
    planner: 'PlannerAgent',
    review: 'ReviewAgent',
  };
  const context = JSON.parse(run.context_json) as Context;
  await env.DB.prepare(
    'INSERT INTO agent_steps(id,run_id,user_id,agent,state,started_at,model,input_summary,attempt) VALUES(?,?,?,?,?,?,?,?,?)',
  )
    .bind(
      stepId,
      runId,
      userId,
      run.state,
      'running',
      startedAt,
      run.model,
      `Stan ${run.state}; fragment ${context.chunk + 1}; wywołanie ${run.calls}/${MAX_CALLS}`,
      run.retries + 1,
    )
    .run();
  try {
    const day = warsawDate(nowISO());
    const quota = await env.DB.prepare(
      'INSERT INTO ai_usage(user_id,day,calls) VALUES(?,?,1) ON CONFLICT(user_id,day) DO UPDATE SET calls=calls+1 WHERE calls<? RETURNING calls',
    )
      .bind(userId, day, MAX_CALLS_PER_DAY)
      .first();
    if (!quota)
      throw new HttpError(
        429,
        'AI_LIMIT',
        `Wykorzystano dzienny limit ${MAX_CALLS_PER_DAY} wywołań AI. Zapisane dane są bezpieczne.`,
      );
    const [document, pages, records, preferences] = await Promise.all([
      ownedDocument(env, userId, run.document_id),
      pagesFor(env, userId, run.document_id),
      recordsFor(env, userId),
      preferencesFor(env, userId),
    ]);
    if (!preferences.ai_enabled)
      throw new HttpError(403, 'AI_DISABLED', 'Analiza AI została wyłączona.');
    const chunks = contextualChunks(pages);
    let input: unknown;
    if (run.state === 'document')
      input = {
        name: document.name,
        pages: chunks[context.chunk],
        academic_year: document.academic_year,
        subject_name: null,
      };
    else if (run.state === 'deadline')
      input = {
        document: context.documents[context.chunk],
        pages: chunks[context.chunk],
        academic_year: document.academic_year,
        today: warsawDate(nowISO()),
        existing_tasks: records.tasks,
      };
    else if (run.state === 'planner')
      input = {
        proposals: context.proposals,
        events: records.events,
        schedules: records.schedules,
        preferences,
        today: warsawDate(nowISO()),
      };
    else {
      // ReviewAgent sees only cited excerpts verified against full source below, never silently truncated pages.
      const citations = context.proposals.flatMap((proposal) => proposal.sources);
      const reviewPages: DocumentPage[] = [];
      for (const source of citations)
        if (hasEvidence(pages, source)) reviewPages.push({ page: source.page, text: source.quote });
      input = {
        pages: reviewPages,
        document: context.documents[0],
        deadlines: { proposals: context.proposals, warnings: context.warnings },
        plan: { blocks: context.blocks, warnings: [] },
        existing_tasks: records.tasks,
        events: records.events,
      };
    }
    const { output, usage } = await callAgent(
      env.AI as unknown as AiBinding,
      run.model,
      names[run.state],
      input,
    );
    let nextState = run.state;
    let validation: unknown = { schema: 'passed' };
    if (run.state === 'document') {
      const value = output as DocumentAgentOutput;
      if (
        !value.sections.every((section) =>
          section.sources.every((source) => hasEvidence(pages, source)),
        )
      )
        throw new WorkflowValidationError('DOCUMENT_SOURCE');
      context.documents.push(value);
      context.chunk++;
      if (context.chunk >= chunks.length) {
        context.chunk = 0;
        nextState = 'deadline';
      }
    } else if (run.state === 'deadline') {
      const value = output as { proposals: ProposedTask[]; warnings: string[] };
      for (const proposal of value.proposals) {
        if (!proposal.sources.every((source) => hasEvidence(pages, source)))
          throw new WorkflowValidationError('DEADLINE_SOURCE');
        proposal.id = `p${context.chunk}-${context.proposals.length}`;
        proposal.subject_id = document.subject_id;
        if (proposal.due_date && !dateInEvidence(proposal.due_date, proposal.sources)) {
          proposal.due_date = null;
          proposal.requires_confirmation = true;
        }
        context.proposals.push(proposal);
      }
      if (context.proposals.length > 40)
        throw new Error('Wykryto ponad 40 propozycji. Podziel dokument na mniejsze dokumenty.');
      context.warnings.push(...value.warnings);
      context.chunk++;
      if (context.chunk >= chunks.length) {
        context.chunk = 0;
        nextState = 'planner';
      }
    } else if (run.state === 'planner') {
      const value = output as { blocks: StudyBlock[]; warnings: string[] };
      const availability = value.blocks.map((block) => ({
        block,
        fits: blockFitsAvailability(block, preferences, records.schedules),
      }));
      context.blocks = availability.filter((item) => item.fits).map((item) => item.block);
      if (context.blocks.length !== value.blocks.length)
        context.warnings.push(
          'Walidator odrzucił bloki poza dostępnością lub kolidujące z zajęciami.',
        );
      context.warnings.push(...value.warnings);
      const rejected = availability.filter((item) => !item.fits).map((item) => item.block);
      validation = {
        schema: 'passed',
        proposed_blocks: value.blocks.length,
        retained_blocks: context.blocks.length,
        rejected_ids: rejected.map((block) => block.id),
        rejected_blocks: rejected.map((block) => ({
          id: block.id,
          reason: 'outside_availability_or_class_conflict',
        })),
      };
      nextState = 'review';
    } else {
      const independent = independentReview(
        pages,
        context.proposals,
        context.blocks,
        records.events.map((event) => ({ start: event.start_at, end: event.end_at })),
        records.tasks,
        nowISO(),
      );
      const accepted = new Set(
        independent.decisions.filter((d) => d.accepted).map((d) => d.proposalId),
      );
      const { review: value, reconciliation } = reconcileReviewIds(
        output as ReviewAgentOutput,
        context.proposals.map((proposal) => proposal.id),
        accepted,
      );
      for (const decision of independent.decisions)
        for (const message of decision.reasons)
          value.issues.push({
            proposal_id: decision.proposalId,
            severity: 'warning',
            code: 'other',
            message,
          });
      for (const message of independent.issues)
        value.issues.push({ proposal_id: null, severity: 'warning', code: 'conflict', message });
      context.blocks = independent.blocks.filter((block) =>
        value.accepted_ids.includes(block.proposal_id),
      );
      value.issues = value.issues.slice(0, 100);
      context.review = value;
      validation = {
        ...independent,
        original_model_ids: {
          accepted_ids: [...(output as ReviewAgentOutput).accepted_ids],
          rejected_ids: [...(output as ReviewAgentOutput).rejected_ids],
        },
        review_id_reconciliation: reconciliation,
      };
      if (
        value.needs_revision &&
        value.revise_agent === 'planner' &&
        context.revision < 1 &&
        run.calls <= 10
      ) {
        context.revision++;
        nextState = 'planner';
      } else nextState = 'approval';
    }
    const finished = nowISO();
    const inputTokens = usage?.prompt_tokens ?? usage?.input_tokens ?? null,
      outputTokens = usage?.completion_tokens ?? usage?.output_tokens ?? null;
    const statements = [
      env.DB.prepare(
        'UPDATE agent_steps SET state=?,finished_at=?,duration_ms=?,output_summary=?,output_json=?,validation_json=?,input_tokens=?,output_tokens=? WHERE id=? AND EXISTS(SELECT 1 FROM agent_runs WHERE id=? AND lease_token=?)',
      ).bind(
        'completed',
        finished,
        Date.now() - started,
        `Zakończono ${names[run.state]}; następny stan: ${nextState}`,
        JSON.stringify(output),
        JSON.stringify(validation),
        inputTokens,
        outputTokens,
        stepId,
        runId,
        token,
      ),
      env.DB.prepare(
        'UPDATE ai_usage SET input_tokens=input_tokens+?,output_tokens=output_tokens+? WHERE user_id=? AND day=?',
      ).bind(inputTokens ?? 0, outputTokens ?? 0, userId, day),
    ];
    if (nextState === 'approval')
      statements.push(
        env.DB.prepare(
          'INSERT INTO analysis_results(id,user_id,run_id,document_id,proposals_json,blocks_json,review_json) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM agent_runs WHERE id=? AND lease_token=?) ON CONFLICT(run_id) DO UPDATE SET proposals_json=excluded.proposals_json,blocks_json=excluded.blocks_json,review_json=excluded.review_json',
        ).bind(
          id(),
          userId,
          runId,
          run.document_id,
          JSON.stringify(context.proposals),
          JSON.stringify(context.blocks),
          JSON.stringify(context.review),
          runId,
          token,
        ),
      );
    statements.push(
      env.DB.prepare(
        'UPDATE agent_runs SET state=?,context_json=?,lease_until=0,lease_token=NULL,error=NULL,updated_at=? WHERE id=? AND user_id=? AND lease_token=?',
      ).bind(nextState, JSON.stringify(context), finished, runId, userId, token),
    );
    await env.DB.batch(statements);
  } catch (error) {
    // A failed HTTP call consumes its reservation. At most one retry across the entire run.
    const permanent =
      (error instanceof HttpError && (error.status === 429 || error.status === 403)) ||
      (error instanceof AgentProviderError &&
        (error.kind === 'quota' || error.kind === 'configuration'));
    const exhausted = permanent || run.retries >= 1 || run.calls >= MAX_CALLS;
    const message =
      error instanceof HttpError
        ? error.message
        : error instanceof AgentProviderError
          ? {
              quota: 'Wyczerpano limit AI dostawcy. Dokument i pozostałe funkcje są dostępne.',
              configuration: 'AI wymaga poprawnej konfiguracji bindingu i dostępu do modelu.',
              timeout:
                'Upłynął limit 180 sekund etapu AI. Rezerwacja limitu została zachowana; wywołania dostawcy nie można anulować.',
              unavailable:
                'Dostawca AI jest chwilowo niedostępny. Dozwolona jest najwyżej jedna ponowna próba.',
            }[error.kind]
          : 'Etap AI nie powiódł się lub odpowiedź narusza kontrakt. Wyniki nie zostały zatwierdzone.';
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE agent_steps SET state='failed',finished_at=?,duration_ms=?,error=?,validation_json=? WHERE id=? AND EXISTS(SELECT 1 FROM agent_runs WHERE id=? AND lease_token=?)",
      ).bind(
        nowISO(),
        Date.now() - started,
        message,
        JSON.stringify({
          schema: 'failed',
          validation_code:
            error instanceof WorkflowValidationError
              ? error.validationCode
              : error instanceof AgentProviderError
                ? error.kind
                : error instanceof z.ZodError
                  ? 'SCHEMA'
                  : error instanceof SyntaxError
                    ? 'JSON'
                    : 'VALIDATION',
          category:
            error instanceof z.ZodError
              ? 'schema'
              : error instanceof SyntaxError
                ? 'json'
                : 'provider_or_validation',
          ...(error instanceof z.ZodError
            ? { issues: error.issues.map((issue) => ({ path: issue.path, code: issue.code })) }
            : {}),
        }),
        stepId,
        runId,
        token,
      ),
      env.DB.prepare(
        'UPDATE agent_runs SET state=?,retries=retries+1,lease_until=0,lease_token=NULL,error=?,updated_at=? WHERE id=? AND user_id=? AND lease_token=?',
      ).bind(exhausted ? 'failed' : run.state, message, nowISO(), runId, userId, token),
    ]);
  }
  return runDetail(env, userId, runId);
}
export async function approveRun(env: Env, userId: string, runId: string, input: unknown) {
  const body = approvalSchema.parse(input),
    run = await ownedRun(env, userId, runId);
  if (run.state === 'committed')
    return { ...(await runDetail(env, userId, runId)), idempotent: true };
  if (run.state !== 'approval')
    throw new HttpError(409, 'NOT_REVIEWED', 'Najpierw zakończ analizę i weryfikację agentów.');
  const context = JSON.parse(run.context_json) as Context;
  if (!context.review) throw new HttpError(409, 'NOT_REVIEWED', 'Brak raportu weryfikacji.');
  const pages = await pagesFor(env, userId, run.document_id),
    records = await recordsFor(env, userId),
    preferences = await preferencesFor(env, userId);
  const originalIds = new Set(context.proposals.map((p) => p.id));
  const ids = new Set<string>();
  const semanticIds = new Set<string>();
  const subjectIds = [
    ...new Set(body.proposals.map((p) => p.subject_id).filter((value): value is string => !!value)),
  ];
  const ownedSubjects = subjectIds.length
    ? (
        await env.DB.prepare(
          `SELECT id FROM subjects WHERE user_id=? AND id IN (${subjectIds.map(() => '?').join(',')})`,
        )
          .bind(userId, ...subjectIds)
          .all<{ id: string }>()
      ).results
    : [];
  const ownedSubjectIds = new Set(ownedSubjects.map((subject) => subject.id));
  for (const proposal of body.proposals) {
    if (!originalIds.has(proposal.id) || ids.has(proposal.id))
      throw new HttpError(422, 'PROPOSAL_ID', 'Nieznana lub powtórzona propozycja.');
    ids.add(proposal.id);
    if (!proposal.sources.every((source) => hasEvidence(pages, source)))
      throw new HttpError(
        422,
        'INVALID_SOURCE',
        'Źródło nie występuje na wskazanej stronie dokumentu.',
      );
    const semanticKey = `${proposal.title.trim().toLocaleLowerCase('pl')}|${proposal.due_date}`;
    if (semanticIds.has(semanticKey))
      throw new HttpError(
        422,
        'DUPLICATE',
        'Wybrano dwie propozycje tego samego zadania i terminu.',
      );
    semanticIds.add(semanticKey);
    if (proposal.requires_confirmation)
      throw new HttpError(
        422,
        'CONFIRMATION_REQUIRED',
        'Popraw niepełne dane i oznacz ręczne potwierdzenie przed zatwierdzeniem.',
      );
    if (proposal.subject_id && !ownedSubjectIds.has(proposal.subject_id))
      throw new HttpError(422, 'SUBJECT', 'Wybrany przedmiot nie istnieje.');
  }
  const selected = body.proposals;
  const selectedIds = new Set(selected.map((p) => p.id));
  if (new Set(body.blocks.map((block) => block.id)).size !== body.blocks.length)
    throw new HttpError(422, 'BLOCK_ID', 'Identyfikatory bloków muszą być unikalne.');
  for (let index = 0; index < body.blocks.length; index++) {
    const block = body.blocks[index];
    const proposal = selected.find((p) => p.id === block.proposal_id);
    if (
      !selectedIds.has(block.proposal_id) ||
      !proposal?.due_date ||
      Date.parse(block.start_at) >= Date.parse(block.end_at) ||
      Date.parse(block.start_at) < Date.now() ||
      warsawDate(block.end_at) > proposal.due_date ||
      !blockFitsAvailability(block, preferences, records.schedules) ||
      records.events.some((event) =>
        overlaps(
          { start: event.start_at, end: event.end_at },
          { start: block.start_at, end: block.end_at },
        ),
      ) ||
      body.blocks
        .slice(0, index)
        .some((previous) =>
          overlaps(
            { start: previous.start_at, end: previous.end_at },
            { start: block.start_at, end: block.end_at },
          ),
        )
    )
      throw new HttpError(
        422,
        'BLOCK_CONFLICT',
        'Blok nauki ma nieprawidłową datę, wykracza poza dostępność lub koliduje z planem.',
      );
  }
  const token = id();
  const locked = await env.DB.prepare(
    "UPDATE agent_runs SET lease_until=?,lease_token=? WHERE id=? AND user_id=? AND state='approval' AND lease_until<? RETURNING id",
  )
    .bind(Date.now() + 60_000, token, runId, userId, Date.now())
    .first();
  if (!locked) throw new HttpError(409, 'RUN_BUSY', 'Zatwierdzanie już trwa.');
  const taskIds: string[] = [],
    eventIds: string[] = [];
  const statements: D1PreparedStatement[] = [];
  const taskRows: unknown[][] = [];
  const eventRows: unknown[][] = [];
  const taskIdsByProposal = new Map<string, string>();
  try {
    for (const proposal of selected) {
      const duplicate = records.tasks.find(
        (task) =>
          task.title.trim().toLocaleLowerCase('pl') ===
            proposal.title.trim().toLocaleLowerCase('pl') && task.due_date === proposal.due_date,
      );
      if (duplicate) {
        taskIds.push(duplicate.id);
        taskIdsByProposal.set(proposal.id, duplicate.id);
        continue;
      }
      const taskId = `task-${runId}-${proposal.id}`;
      taskIds.push(taskId);
      taskIdsByProposal.set(proposal.id, taskId);
      const userConfirmed =
        proposal.due_date && !dateInEvidence(proposal.due_date, proposal.sources);
      const notes = JSON.stringify({
        sources: proposal.sources,
        run_id: runId,
        estimated_minutes: proposal.estimated_minutes,
        date_origin: userConfirmed ? 'user_confirmed' : 'document',
        warning: userConfirmed
          ? 'Termin wprowadzony i potwierdzony przez użytkownika; brak pełnej daty w źródle.'
          : null,
      });
      taskRows.push([
        taskId,
        userId,
        proposal.subject_id,
        run.document_id,
        proposal.title,
        proposal.due_date,
        proposal.priority,
        notes,
        `${runId}:${proposal.id}`,
      ]);
      if (proposal.due_date) {
        const eventId = `event-${runId}-${proposal.id}`;
        eventIds.push(eventId);
        const nextDate = new Date(`${proposal.due_date}T12:00:00Z`);
        nextDate.setUTCDate(nextDate.getUTCDate() + 1);
        eventRows.push([
          eventId,
          userId,
          proposal.subject_id,
          run.document_id,
          `Termin: ${proposal.title}`.slice(0, 240),
          warsawMidnight(proposal.due_date),
          warsawMidnight(nextDate.toISOString().slice(0, 10)),
          'Termin dzienny — dokument nie określa godziny',
          `${runId}:due-${proposal.id}`,
          taskId,
        ]);
      }
    }
    for (const [blockIndex, block] of body.blocks.entries()) {
      const eventId = `block-${runId}-${blockIndex}`;
      eventIds.push(eventId);
      const proposal = selected.find((p) => p.id === block.proposal_id)!;
      eventRows.push([
        eventId,
        userId,
        proposal.subject_id,
        run.document_id,
        block.title,
        block.start_at,
        block.end_at,
        'Szacowany blok nauki',
        `${runId}:block-${block.id}`,
        taskIdsByProposal.get(block.proposal_id)!,
      ]);
    }
    const guard = { runId, token };
    statements.push(
      ...insertRows(
        env,
        'tasks',
        [
          'id',
          'user_id',
          'subject_id',
          'document_id',
          'title',
          'due_date',
          'priority',
          'notes',
          'proposal_id',
        ],
        taskRows,
        guard,
        'ON CONFLICT(user_id,document_id,proposal_id) DO NOTHING',
      ),
    );
    statements.push(
      ...insertRows(
        env,
        'calendar_events',
        [
          'id',
          'user_id',
          'subject_id',
          'document_id',
          'title',
          'start_at',
          'end_at',
          'location',
          'proposal_id',
          'task_id',
        ],
        eventRows,
        guard,
        'ON CONFLICT(user_id,document_id,proposal_id) DO NOTHING',
      ),
    );
    statements.push(
      env.DB.prepare(
        'UPDATE analysis_results SET proposals_json=?,blocks_json=?,approved_at=? WHERE run_id=? AND user_id=? AND EXISTS(SELECT 1 FROM agent_runs WHERE id=? AND lease_token=?)',
      ).bind(
        JSON.stringify(selected),
        JSON.stringify(body.blocks),
        nowISO(),
        runId,
        userId,
        runId,
        token,
      ),
    );
    statements.push(
      env.DB.prepare(
        "UPDATE agent_runs SET state='committed',lease_until=0,lease_token=NULL,updated_at=? WHERE id=? AND user_id=? AND lease_token=?",
      ).bind(nowISO(), runId, userId, token),
    );
    await env.DB.batch(statements);
  } catch (error) {
    await env.DB.prepare(
      'UPDATE agent_runs SET lease_until=0,lease_token=NULL WHERE id=? AND user_id=? AND lease_token=?',
    )
      .bind(runId, userId, token)
      .run();
    throw error;
  }
  return { ...(await runDetail(env, userId, runId)), task_ids: taskIds, event_ids: eventIds };
}
export async function handleOrchestrator(
  request: Request,
  env: Env,
  user: User,
): Promise<Response | null> {
  const parts = new URL(request.url).pathname.split('/').filter(Boolean);
  if (parts[0] !== 'api' || !['documents', 'runs', 'usage'].includes(parts[1])) return null;
  const itemId = parts[2],
    action = parts[3];
  if (parts[1] === 'usage' && request.method === 'GET') {
    const usage = await env.DB.prepare('SELECT * FROM ai_usage WHERE user_id=? AND day=?')
      .bind(user.id, warsawDate(nowISO()))
      .first();
    return json({
      usage: usage ?? { analyses: 0, calls: 0, input_tokens: 0, output_tokens: 0 },
      limits: {
        analyses: MAX_ANALYSES_PER_DAY,
        calls: MAX_CALLS_PER_DAY,
        max_calls_per_run: MAX_CALLS,
      },
      note: 'Tokeny pochodzą z odpowiedzi dostawcy, jeśli je udostępnia. Brak dokładnego odczytu neuronów lub kosztu Cloudflare.',
    });
  }
  if (parts[1] === 'runs') {
    if (request.method === 'GET' && !itemId)
      return json({
        runs: (
          await env.DB.prepare(
            'SELECT id,document_id,state,model,calls,retries,error,created_at,updated_at FROM agent_runs WHERE user_id=? ORDER BY created_at DESC LIMIT 100',
          )
            .bind(user.id)
            .all()
        ).results,
      });
    if (request.method === 'GET' && itemId) return json(await runDetail(env, user.id, itemId));
    if (request.method === 'POST' && itemId && action === 'advance')
      return json(await advanceRun(env, user.id, itemId));
    if (request.method === 'POST' && itemId && action === 'approve')
      return json(await approveRun(env, user.id, itemId, await readJson(request)));
  } else if (parts[1] === 'documents') {
    if (request.method === 'GET' && !itemId)
      return json({
        documents: (
          await env.DB.prepare(
            'SELECT * FROM documents WHERE user_id=? ORDER BY created_at DESC LIMIT 200',
          )
            .bind(user.id)
            .all()
        ).results,
      });
    if (request.method === 'GET' && itemId) {
      const document = await ownedDocument(env, user.id, itemId);
      return json({ document, pages: await pagesFor(env, user.id, itemId) });
    }
    if (request.method === 'POST' && itemId && action === 'analyze')
      return json(
        await startRun(
          env,
          user.id,
          itemId,
          new URL(request.url).searchParams.get('force') === '1',
        ),
      );
    if (request.method === 'POST' && !itemId) {
      const data = documentUploadSchema.parse(await readJson(request));
      // Recompute content hash on the server: a supplied digest cannot poison another result cache.
      const sortedPages = [...data.pages].sort((a, b) => a.page - b.page);
      const hash = await sha256(JSON.stringify(sortedPages));
      const existing = await env.DB.prepare('SELECT * FROM documents WHERE user_id=? AND hash=?')
        .bind(user.id, hash)
        .first<DocumentRecord>();
      if (existing) return json({ document: existing, cached: true });
      if (
        data.subject_id &&
        !(await env.DB.prepare('SELECT id FROM subjects WHERE id=? AND user_id=?')
          .bind(data.subject_id, user.id)
          .first())
      )
        throw new HttpError(422, 'SUBJECT', 'Wybrany przedmiot nie istnieje.');
      const documentId = id();
      try {
        await env.DB.batch([
          env.DB.prepare(
            'INSERT INTO documents(id,user_id,subject_id,name,hash,academic_year,page_count,text_length) VALUES(?,?,?,?,?,?,?,?)',
          ).bind(
            documentId,
            user.id,
            data.subject_id,
            data.name,
            hash,
            data.academic_year,
            data.pages.length,
            data.pages.reduce((sum, page) => sum + page.text.length, 0),
          ),
          ...insertRows(
            env,
            'document_sections',
            ['id', 'document_id', 'user_id', 'page', 'text'],
            data.pages.map((page) => [id(), documentId, user.id, page.page, page.text]),
          ),
        ]);
      } catch (error) {
        const concurrent = await env.DB.prepare(
          'SELECT * FROM documents WHERE user_id=? AND hash=?',
        )
          .bind(user.id, hash)
          .first<DocumentRecord>();
        if (concurrent) return json({ document: concurrent, cached: true });
        throw error;
      }
      return json({ document: await ownedDocument(env, user.id, documentId), cached: false }, 201);
    }
    if (request.method === 'PATCH' && itemId && !action) {
      await ownedDocument(env, user.id, itemId);
      const input = documentPatchSchema.parse(await readJson(request));
      if (
        input.subject_id &&
        !(await env.DB.prepare('SELECT id FROM subjects WHERE id=? AND user_id=?')
          .bind(input.subject_id, user.id)
          .first())
      )
        throw new HttpError(422, 'SUBJECT', 'Wybrany przedmiot nie istnieje.');
      const fields = Object.entries(input).filter(([, value]) => value !== undefined);
      if (fields.length)
        await env.DB.prepare(
          `UPDATE documents SET ${fields.map(([key]) => `${key}=?`).join(',')},updated_at=? WHERE id=? AND user_id=?`,
        )
          .bind(...fields.map(([, value]) => value), nowISO(), itemId, user.id)
          .run();
      return json({ document: await ownedDocument(env, user.id, itemId) });
    }
    if (request.method === 'DELETE' && itemId) {
      await ownedDocument(env, user.id, itemId);
      const active = await env.DB.prepare(
        'SELECT id FROM agent_runs WHERE document_id=? AND user_id=? AND lease_until>?',
      )
        .bind(itemId, user.id, Date.now())
        .first();
      if (active)
        throw new HttpError(
          409,
          'RUN_BUSY',
          'Poczekaj na zakończenie aktualnego etapu przed usunięciem dokumentu.',
        );
      await env.DB.batch([
        env.DB.prepare('DELETE FROM tasks WHERE document_id=? AND user_id=?').bind(itemId, user.id),
        env.DB.prepare('DELETE FROM calendar_events WHERE document_id=? AND user_id=?').bind(
          itemId,
          user.id,
        ),
        env.DB.prepare('DELETE FROM documents WHERE id=? AND user_id=?').bind(itemId, user.id),
      ]);
      return json({ deleted: true });
    }
  }
  throw new HttpError(405, 'METHOD', 'Niedostępna operacja.');
}
