import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Miniflare } from 'miniflare';
import { approveRun, handleOrchestrator } from '../../worker/orchestrator';
import type { Env, User } from '../../worker/types';
import type { ProposedTask, StudyBlock } from '../../shared/contracts';
import { localDatabase } from './harness';

let runtime: Miniflare;
let db: D1Database;
let env: Env;
const user: User = {
  id: 'owner',
  github_id: '123',
  github_login: 'test',
  name: 'Test',
  avatar_url: null,
  created_at: '',
};
beforeEach(async () => {
  ({ runtime, db } = await localDatabase(`limit-${crypto.randomUUID()}`));
  await db
    .prepare('INSERT INTO users(id,github_id) VALUES(?,?)')
    .bind(user.id, user.github_id)
    .run();
  env = { DB: db, AI: {} as Ai, ASSETS: {} as Fetcher };
});
afterEach(async () => {
  await runtime.dispose();
});

function observeStatements() {
  const nativePrepare = db.prepare.bind(db);
  let prepared = 0,
    maxBound = 0;
  const spy = vi.spyOn(db, 'prepare').mockImplementation((query: string) => {
    prepared++;
    const statement = nativePrepare(query);
    const nativeBind = statement.bind.bind(statement);
    vi.spyOn(statement, 'bind').mockImplementation((...values: unknown[]) => {
      maxBound = Math.max(maxBound, values.length);
      return nativeBind(...values);
    });
    return statement;
  });
  return { counts: () => ({ prepared, maxBound }), restore: () => spy.mockRestore() };
}

it('imports 100 pages using fewer than 50 D1 statements and at most 100 bound parameters', async () => {
  const observed = observeStatements();
  const response = await handleOrchestrator(
    new Request('https://example.com/api/documents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: '100 stron testowych',
        hash: '0'.repeat(64),
        academic_year: '2026/2027',
        subject_id: null,
        pages: Array.from({ length: 100 }, (_, index) => ({
          page: index + 1,
          text: `Rzeczywista treść testowa strony ${index + 1}.`,
        })),
      }),
    }),
    env,
    user,
  );
  expect(response?.status).toBe(201);
  const counts = observed.counts();
  observed.restore();
  expect(counts.prepared).toBeLessThan(45); // Leave headroom for authentication/rate limiting.
  expect(counts.maxBound).toBeLessThanOrEqual(100);
  expect(
    (await db.prepare('SELECT count(*) AS n FROM document_sections').first<{ n: number }>())?.n,
  ).toBe(100);
});

it('commits 40 reviewed tasks and 100 edited study blocks within Free query/parameter limits', async () => {
  const source = 'Wszystkie poniższe zadania należy oddać do 20.11.2030.';
  const proposals: ProposedTask[] = Array.from({ length: 40 }, (_, index) => ({
    id: `p${index}`,
    title: `Zadanie ${index}`,
    subject_id: null,
    due_date: '2030-11-20',
    priority: 'medium',
    estimated_minutes: 60,
    sources: [{ page: 1, quote: source }],
    confidence: 0.9,
    requires_confirmation: false,
    duplicate_of: null,
  }));
  const blocks: StudyBlock[] = Array.from({ length: 100 }, (_, index) => {
    const start = new Date(Date.UTC(2030, 10, 18, 15, index * 3));
    return {
      id: `b${index}`,
      proposal_id: `p${index % 40}`,
      title: `Etap ${index}`,
      start_at: start.toISOString(),
      end_at: new Date(start.getTime() + 180_000).toISOString(),
      estimated: true,
      reason: 'Jawny test przepustowości SQL; brak wywołań AI.',
    };
  });
  const context = {
    chunk: 0,
    documents: [],
    proposals,
    blocks,
    review: {
      accepted_ids: proposals.map((p) => p.id),
      rejected_ids: [],
      issues: [],
      needs_revision: false,
      revise_agent: null,
      summary: 'Jawny fixture testowy.',
    },
    revision: 0,
    warnings: [],
  };
  await db.batch([
    db
      .prepare(
        'INSERT INTO documents(id,user_id,name,hash,academic_year,page_count,text_length) VALUES(?,?,?,?,?,?,?)',
      )
      .bind('doc', user.id, 'fixture', 'a'.repeat(64), '2030/2031', 1, source.length),
    db
      .prepare('INSERT INTO document_sections(id,document_id,user_id,page,text) VALUES(?,?,?,?,?)')
      .bind('page', 'doc', user.id, 1, source),
    db
      .prepare(
        'INSERT INTO agent_runs(id,user_id,document_id,state,context_json,model) VALUES(?,?,?,?,?,?)',
      )
      .bind('run', user.id, 'doc', 'approval', JSON.stringify(context), 'test-fixture-no-ai'),
    db
      .prepare('INSERT INTO analysis_results(id,user_id,run_id,document_id) VALUES(?,?,?,?)')
      .bind('result', user.id, 'run', 'doc'),
  ]);
  const observed = observeStatements();
  const result = await approveRun(env, user.id, 'run', { proposals, blocks });
  const counts = observed.counts();
  observed.restore();
  expect(result.run.state).toBe('committed');
  expect(counts.prepared).toBeLessThan(45);
  expect(counts.maxBound).toBeLessThanOrEqual(100);
  expect((await db.prepare('SELECT count(*) AS n FROM tasks').first<{ n: number }>())?.n).toBe(40);
  expect(
    (
      await db
        .prepare('SELECT count(*) AS n FROM calendar_events WHERE task_id IS NOT NULL')
        .first<{ n: number }>()
    )?.n,
  ).toBe(140);
});
