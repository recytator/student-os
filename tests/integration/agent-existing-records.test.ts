import { afterEach, expect, it, vi } from 'vitest';
import type { Miniflare } from 'miniflare';
import { advanceRun, approveRun, startRun } from '../../worker/orchestrator';
import type { Env } from '../../worker/types';
import type { ProposedTask } from '../../shared/contracts';
import { localDatabase } from './harness';

let runtime: Miniflare | undefined;
afterEach(async () => {
  await runtime?.dispose();
});

it('validates agent inputs with manual records and previously approved AI records on reanalysis', async () => {
  const local = await localDatabase(`existing-${crypto.randomUUID()}`);
  runtime = local.runtime;
  const db = local.db;
  const userId = 'owner',
    source = 'Projekt semestralny należy oddać do 20.11.2030.';
  await db.batch([
    db.prepare('INSERT INTO users(id,github_id) VALUES(?,?)').bind(userId, '123'),
    db
      .prepare(
        'INSERT INTO documents(id,user_id,name,hash,academic_year,page_count,text_length) VALUES(?,?,?,?,?,?,?)',
      )
      .bind('doc', userId, 'Test zapisanych danych', 'a'.repeat(64), '2030/2031', 1, source.length),
    db
      .prepare('INSERT INTO document_sections(id,document_id,user_id,page,text) VALUES(?,?,?,?,?)')
      .bind('page', 'doc', userId, 1, source),
    db
      .prepare('INSERT INTO tasks(id,user_id,title,due_date,proposal_id) VALUES(?,?,?,?,?)')
      .bind('manual-task', userId, 'Ręcznie dodane zadanie', '2030-11-19', null),
    db
      .prepare(
        'INSERT INTO calendar_events(id,user_id,title,start_at,end_at,proposal_id,task_id) VALUES(?,?,?,?,?,?,?)',
      )
      .bind(
        'manual-event',
        userId,
        'Ręcznie dodane wydarzenie',
        '2030-11-18T17:00:00+01:00',
        '2030-11-18T18:00:00+01:00',
        null,
        null,
      ),
  ]);
  // Stored source envelopes may exceed the user-editable 10k notes limit. These details are irrelevant
  // to scheduling/deduplication and must remain in D1 without leaking or breaking strict agent inputs.
  const privateNotes = 'z'.repeat(12_500);
  await db.prepare('UPDATE tasks SET notes=? WHERE id=?').bind(privateNotes, 'manual-task').run();
  const proposal: ProposedTask = {
    id: 'model-p1',
    title: 'Projekt semestralny '.padEnd(240, 'x'),
    subject_id: null,
    due_date: '2030-11-20',
    priority: 'high',
    estimated_minutes: 120,
    sources: [{ page: 1, quote: source }],
    confidence: 0.95,
    requires_confirmation: false,
    duplicate_of: null,
  };
  const inputRecords: Array<{
    existing_tasks?: Array<Record<string, unknown>>;
    events?: Array<Record<string, unknown>>;
  }> = [];
  // Deliberate mock of the provider; callAgent itself and all strict input schemas remain real.
  const ai = vi
    .fn()
    .mockImplementation(async (_model: string, input: { messages: Array<{ content: string }> }) => {
      const system = input.messages[0]!.content;
      const data = JSON.parse(input.messages[1]!.content).data;
      inputRecords.push(data);
      let response: unknown;
      if (system.includes('rozpoznaj strukturę'))
        response = {
          subject_name: null,
          document_type: 'syllabus',
          summary: 'Jawny test schematów wejściowych.',
          sections: [{ title: 'Projekt', kind: 'deadline', sources: proposal.sources }],
          warnings: [],
        };
      else if (system.includes('wydobądź obowiązki'))
        response = { proposals: [proposal], warnings: [] };
      else if (system.includes('rozłóż zatwierdzalne')) response = { blocks: [], warnings: [] };
      else
        response = {
          accepted_ids: data.deadlines.proposals.map((p: ProposedTask) => p.id),
          rejected_ids: [],
          issues: [],
          needs_revision: false,
          revise_agent: null,
          summary: 'Jawny mock ReviewAgent; walidacja deterministyczna działa.',
        };
      return { response: JSON.stringify(response) };
    });
  const env: Env = { DB: db, AI: { run: ai } as unknown as Ai, ASSETS: {} as Fetcher };
  const first = await startRun(env, userId, 'doc');
  let detail = await advanceRun(env, userId, first.run.id);
  for (let stage = 1; stage < 4; stage++) detail = await advanceRun(env, userId, first.run.id);
  expect(detail.run.state).toBe('approval');
  const result = detail.result as { proposals: ProposedTask[] };
  await approveRun(env, userId, first.run.id, {
    proposals: result.proposals,
    blocks: [
      {
        id: 'b'.repeat(100),
        proposal_id: result.proposals[0]!.id,
        title: 'Edytowany blok z maksymalnym ID',
        start_at: '2030-11-18T16:00:00+01:00',
        end_at: '2030-11-18T16:30:00+01:00',
        estimated: true,
        reason: 'Jawny test granicy identyfikatora.',
      },
    ],
  });
  expect(
    (
      await db
        .prepare('SELECT max(length(id)) AS max_id FROM calendar_events')
        .first<{ max_id: number }>()
    )?.max_id,
  ).toBeLessThanOrEqual(100);
  expect(
    (
      await db
        .prepare('SELECT count(*) AS n FROM calendar_events WHERE task_id IS NOT NULL')
        .first<{ n: number }>()
    )?.n,
  ).toBe(2);
  const second = await startRun(env, userId, 'doc', true);
  for (let stage = 0; stage < 4; stage++) detail = await advanceRun(env, userId, second.run.id);
  expect(detail.run.state).toBe('approval');
  expect(detail.run.error).toBe(null);
  expect(ai).toHaveBeenCalledTimes(8);
  expect(
    (
      await db
        .prepare('SELECT max(length(title)) AS max_title FROM calendar_events')
        .first<{ max_title: number }>()
    )?.max_title,
  ).toBeLessThanOrEqual(240);
  expect(
    (
      await db
        .prepare('SELECT notes FROM tasks WHERE id=?')
        .bind('manual-task')
        .first<{ notes: string }>()
    )?.notes,
  ).toBe(privateNotes);
  const secondInputs = inputRecords.slice(4);
  expect(secondInputs[1]?.existing_tasks).toHaveLength(2);
  expect(secondInputs[2]?.events).toHaveLength(3);
  for (const input of inputRecords) {
    expect(
      input.existing_tasks?.every((task) => !('proposal_id' in task) && task.notes === '') ?? true,
    ).toBe(true);
    expect(
      input.events?.every((event) => !('proposal_id' in event) && !('task_id' in event)) ?? true,
    ).toBe(true);
  }
}, 30_000);
