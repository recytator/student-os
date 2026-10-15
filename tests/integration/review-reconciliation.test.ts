/** Fixture AI outputs exercise real validation/D1. They are not live model measurements. */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Miniflare } from 'miniflare';
import {
  reviewAgentOutputSchema,
  type DocumentAgentOutput,
  type ProposedTask,
  type ReviewAgentOutput,
} from '../../shared/contracts';
import { advanceRun, reconcileReviewIds } from '../../worker/orchestrator';
import type { Env } from '../../worker/types';
import { localDatabase } from './harness';

const review = (accepted_ids: string[], rejected_ids: string[] = []): ReviewAgentOutput => ({
  accepted_ids,
  rejected_ids,
  issues: [],
  needs_revision: false,
  revise_agent: null,
  summary: 'Jawny wynik testowy ReviewAgent.',
});

describe('zachowawcze uzgadnianie decyzji ReviewAgent', () => {
  it('nieznane identyfikatory ignoruje, a braki, powtórzenia i sprzeczności odrzuca', () => {
    const original = review(
      ['good', 'duplicate', 'duplicate', 'conflict', 'independently-unsafe', 'alien'],
      ['conflict', 'explicit-no', 'repeated-no', 'repeated-no'],
    );
    const before = structuredClone(original);
    const known = [
      'good',
      'duplicate',
      'conflict',
      'independently-unsafe',
      'omitted',
      'explicit-no',
      'repeated-no',
    ];
    const result = reconcileReviewIds(
      original,
      known,
      new Set(known.filter((id) => id !== 'independently-unsafe')),
    );
    expect(result.review.accepted_ids).toEqual(['good']);
    expect(result.review.rejected_ids).toEqual(known.filter((id) => id !== 'good'));
    expect(result.reconciliation).toEqual({
      unknown_ids: ['alien'],
      duplicate_ids: ['duplicate', 'repeated-no'],
      conflicting_ids: ['conflict'],
      omitted_ids: ['omitted'],
      independently_rejected_ids: ['independently-unsafe'],
    });
    expect(result.review.issues.map((issue) => issue.proposal_id)).toEqual(
      expect.arrayContaining([
        null,
        'duplicate',
        'repeated-no',
        'conflict',
        'omitted',
        'independently-unsafe',
      ]),
    );
    expect(reviewAgentOutputSchema.safeParse(result.review).success).toBe(true);
    expect(original).toEqual(before);
  });
  it.each(
    [0, 1, 2].flatMap((accepted) =>
      [0, 1, 2].flatMap((rejected) =>
        [false, true].map((independent) => ({ accepted, rejected, independent })),
      ),
    ),
  )(
    'akceptuje wyłącznie jedną jednoznaczną zgodę i niezależne potwierdzenie: %j',
    ({ accepted, rejected, independent }) => {
      const model = review([...Array(accepted).fill('p'), 'alien'], Array(rejected).fill('p'));
      const result = reconcileReviewIds(
        model,
        ['p', 'omitted'],
        new Set(independent ? ['p', 'omitted'] : ['omitted']),
      );
      expect(result.review.accepted_ids).toEqual(
        accepted === 1 && rejected === 0 && independent ? ['p'] : [],
      );
      expect(result.review.rejected_ids).toContain('omitted');
      expect(new Set([...result.review.accepted_ids, ...result.review.rejected_ids])).toEqual(
        new Set(['p', 'omitted']),
      );
      expect(result.review.accepted_ids.some((id) => result.review.rejected_ids.includes(id))).toBe(
        false,
      );
    },
  );
  it('nie uznaje samych nieznanych ID ani samej zgody niezależnego walidatora za zgodę modelu', () => {
    const result = reconcileReviewIds(
      review(['made-up']),
      ['real-a', 'real-b'],
      new Set(['real-a', 'real-b']),
    );
    expect(result.review.accepted_ids).toEqual([]);
    expect(result.review.rejected_ids).toEqual(['real-a', 'real-b']);
  });
  it('zachowuje ograniczony rozmiar raportu przy wielu błędach', () => {
    const original = review(Array(60).fill('p'));
    original.issues = Array.from({ length: 100 }, () => ({
      proposal_id: null,
      severity: 'warning' as const,
      code: 'other' as const,
      message: 'Uwaga modelu.',
    }));
    const result = reconcileReviewIds(original, ['p', 'missing'], new Set(['p', 'missing']));
    expect(result.review.accepted_ids).toEqual([]);
    expect(result.review.issues).toHaveLength(100);
    expect(result.review.issues[0]?.code).toBe('invalid_structure');
    expect(reviewAgentOutputSchema.safeParse(result.review).success).toBe(true);
  });
});

let runtime: Miniflare;
let db: D1Database;
const source = { page: 1, quote: 'Projekt do 20.11.2026.' };
const document: DocumentAgentOutput = {
  subject_name: null,
  document_type: 'syllabus',
  summary: 'Test',
  sections: [{ title: 'Projekt', kind: 'deadline', sources: [source] }],
  warnings: [],
};
const proposal = (id: string): ProposedTask => ({
  id,
  title: `Obowiązek ${id}`,
  subject_id: null,
  due_date: '2026-11-20',
  priority: 'medium',
  estimated_minutes: 60,
  sources: [source],
  confidence: 0.9,
  requires_confirmation: false,
  duplicate_of: null,
});

beforeAll(async () => {
  ({ runtime, db } = await localDatabase('qa-review-reconciliation'));
  await db.prepare("INSERT INTO users(id,github_id) VALUES('review-owner','42')").run();
}, 30_000);
afterAll(async () => {
  await runtime?.dispose();
});

async function seed(key: string, state = 'review', proposals: ProposedTask[] = [proposal('good')]) {
  const documentId = `doc-${key}`,
    runId = `run-${key}`;
  await db.batch([
    db
      .prepare(
        'INSERT INTO documents(id,user_id,name,hash,academic_year,page_count,text_length) VALUES(?,?,?,?,?,?,?)',
      )
      .bind(documentId, 'review-owner', 'Test.pdf', key.padEnd(64, 'a'), '2026/2027', 1, 100),
    db
      .prepare('INSERT INTO document_sections(id,document_id,user_id,page,text) VALUES(?,?,?,?,?)')
      .bind(`page-${key}`, documentId, 'review-owner', 1, 'Projekt do 20.11.2026. Brak daty.'),
    db
      .prepare(
        'INSERT INTO agent_runs(id,user_id,document_id,state,model,calls,retries,context_json) VALUES(?,?,?,?,?,?,?,?)',
      )
      .bind(
        runId,
        'review-owner',
        documentId,
        state,
        '@cf/zai-org/glm-4.7-flash',
        3,
        1,
        JSON.stringify({
          chunk: 0,
          documents: [document],
          proposals,
          blocks: [],
          review: null,
          revision: 0,
          warnings: [],
        }),
      ),
  ]);
  return runId;
}
async function execute(runId: string, response: unknown) {
  const run = vi.fn().mockResolvedValue({
    response: typeof response === 'string' ? response : JSON.stringify(response),
    usage: { prompt_tokens: 10, completion_tokens: 20 },
  });
  const env = { DB: db, AI: { run } } as unknown as Env;
  return { detail: await advanceRun(env, 'review-owner', runId), run, env };
}

describe('uzgodnienie decyzji w prawdziwym checkpointcie D1', () => {
  it('zapisuje oryginalne decyzje modelu i odrzuca niepewne propozycje bez dodatkowego wywołania', async () => {
    const proposals = ['good', 'duplicate', 'conflict', 'omitted', 'unsafe'].map(proposal);
    proposals[4]!.sources = [{ page: 1, quote: 'Brak daty.' }];
    const runId = await seed('mixed', 'review', proposals);
    const original = review(
      ['good', 'duplicate', 'duplicate', 'conflict', 'unsafe', 'alien'],
      ['conflict'],
    );
    const { detail, run } = await execute(runId, original);
    expect(detail.run).toMatchObject({ state: 'approval', calls: 4, retries: 1 });
    expect(detail.result?.review.accepted_ids).toEqual(['good']);
    expect(detail.result?.review.rejected_ids).toEqual([
      'duplicate',
      'conflict',
      'omitted',
      'unsafe',
    ]);
    expect(run).toHaveBeenCalledOnce();
    const step = detail.steps[0]! as Record<string, unknown>;
    expect(step.state).toBe('completed');
    expect(JSON.parse(String(step.output_json))).toEqual(original);
    const validation = JSON.parse(String(step.validation_json));
    expect(validation.original_model_ids).toEqual({
      accepted_ids: original.accepted_ids,
      rejected_ids: original.rejected_ids,
    });
    expect(validation.review_id_reconciliation).toMatchObject({
      unknown_ids: ['alien'],
      duplicate_ids: ['duplicate'],
      conflicting_ids: ['conflict'],
      omitted_ids: ['omitted'],
      independently_rejected_ids: ['unsafe'],
    });
    expect(
      await db
        .prepare('SELECT COUNT(*) AS count FROM tasks WHERE user_id=?')
        .bind('review-owner')
        .first(),
    ).toEqual({ count: 0 });
  });
  it('błędny JSON nadal kończy uruchomienie po wykorzystanym retry, bez fikcyjnej akceptacji', async () => {
    const runId = await seed('invalid-json');
    const { detail, run, env } = await execute(runId, 'tajne dane testowe: niepoprawny JSON');
    expect(detail.run).toMatchObject({ state: 'failed', calls: 4, retries: 2 });
    expect(detail.result).toBeNull();
    const validation = JSON.parse(
      String((detail.steps[0] as Record<string, unknown>).validation_json),
    );
    expect(validation.validation_code).toBe('JSON');
    expect(JSON.stringify(detail)).not.toContain('tajne dane testowe');
    await advanceRun(env, 'review-owner', runId);
    expect(run).toHaveBeenCalledOnce();
  });
  it.each([
    ['document', 'DOCUMENT_SOURCE'],
    ['deadline', 'DEADLINE_SOURCE'],
  ] as const)(
    'raportuje bezpieczny kod %s bez ujawniania odrzuconego cytatu',
    async (state, code) => {
      const runId = await seed(`bad-${state}`, state);
      const fake = { page: 1, quote: 'NIEOBECNY POUFNY FRAGMENT' };
      const output =
        state === 'document'
          ? { ...document, sections: [{ title: 'Projekt', kind: 'deadline', sources: [fake] }] }
          : { proposals: [{ ...proposal('bad'), sources: [fake] }], warnings: [] };
      const { detail } = await execute(runId, output);
      expect(detail.run.state).toBe('failed');
      const step = detail.steps[0]! as Record<string, unknown>;
      expect(JSON.parse(String(step.validation_json)).validation_code).toBe(code);
      expect(JSON.stringify(detail)).not.toContain(fake.quote);
    },
  );
  it('oddzielnie zapisuje propozycje planera i bloki zachowane przez walidator', async () => {
    const runId = await seed('planner', 'planner');
    const block = {
      id: 'outside',
      proposal_id: 'good',
      title: 'Nauka',
      start_at: '2026-11-18T08:00:00+01:00',
      end_at: '2026-11-18T09:00:00+01:00',
      estimated: true,
      reason: 'Jawna propozycja testowa',
    };
    const { detail } = await execute(runId, { blocks: [block], warnings: [] });
    expect(detail.run.state).toBe('review');
    const step = detail.steps[0]! as Record<string, unknown>;
    expect(JSON.parse(String(step.output_json)).blocks).toEqual([block]);
    expect(JSON.parse(String(step.validation_json))).toMatchObject({
      proposed_blocks: 1,
      retained_blocks: 0,
      rejected_ids: ['outside'],
      rejected_blocks: [{ id: 'outside', reason: 'outside_availability_or_class_conflict' }],
    });
  });
});
