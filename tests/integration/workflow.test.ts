/* eslint-disable @typescript-eslint/no-explicit-any -- JSON assertions intentionally inspect server payloads at integration boundary. */
import { mkdir, writeFile } from 'node:fs/promises';
import type { Miniflare } from 'miniflare';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../../worker/index';
import type { Env } from '../../worker/types';
import type { ProposedTask } from '../../shared/contracts';
import { localDatabase } from './harness';
import exact from '../fixtures/syllabus-exact.json';
import ambiguous from '../fixtures/syllabus-ambiguous.json';

let runtime: Miniflare;
let db: D1Database;
let env: Env;
const origin = 'http://localhost:8787';
const request = async (path: string, method = 'GET', data?: unknown, requestOrigin = origin) =>
  worker.fetch(
    new Request(`${origin}/api${path}`, {
      method,
      headers: {
        ...(method !== 'GET' ? { Origin: requestOrigin } : {}),
        ...(data ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(data ? { body: JSON.stringify(data) } : {}),
    }),
    env,
  );
const body = async (response: Response) => (await response.json()) as Record<string, any>;

beforeEach(async () => {
  ({ runtime, db } = await localDatabase(`workflow-${crypto.randomUUID()}`));
  env = {
    DB: db,
    AI: {
      run: vi.fn().mockRejectedValue(new Error('AI unavailable — test mock')),
    } as unknown as Ai,
    ASSETS: { fetch: async () => new Response('assets') } as unknown as Fetcher,
    DEV_AUTH: 'true',
    APP_ORIGIN: origin,
  };
});
afterEach(async () => {
  await runtime?.dispose();
});

async function importDocument(fixture = exact) {
  const imported = await request('/documents', 'POST', {
    name: fixture.name,
    hash: 'a'.repeat(64),
    pages: fixture.pages,
    academic_year: fixture.academic_year,
    subject_id: null,
  });
  expect(imported.status).toBe(201);
  return (await body(imported)).document.id as string;
}
async function start(documentId: string) {
  const response = await request(`/documents/${documentId}/analyze`, 'POST');
  expect(response.status).toBe(200);
  return (await body(response)).run.id as string;
}
function proposalFromGold(item: (typeof exact.gold)[number], index: number): ProposedTask {
  return {
    id: `demo-${index}`,
    title: item.title,
    subject_id: null,
    due_date: item.due_date,
    priority: 'medium',
    estimated_minutes: 60,
    sources: [{ page: item.page, quote: item.quote }],
    confidence: 0.9,
    requires_confirmation: item.due_date === null,
    duplicate_of: null,
  };
}

/** Explicit fixture responses test orchestration; these are not real AI extraction. */
function fixtureAI(proposals: ProposedTask[]) {
  return vi
    .fn()
    .mockImplementation(async (_model: string, input: { messages: Array<{ content: string }> }) => {
      const system = input.messages[0]!.content;
      const data = JSON.parse(input.messages[1]!.content).data;
      let output: unknown;
      if (system.includes('rozpoznaj strukturę'))
        output = {
          subject_name: 'Sztuczna inteligencja',
          document_type: 'syllabus',
          summary: 'Jawna odpowiedź demonstracyjna testu',
          sections: [{ title: 'Wymagania', kind: 'deadline', sources: proposals[0]!.sources }],
          warnings: [],
        };
      else if (system.includes('wydobądź obowiązki')) output = { proposals, warnings: [] };
      else if (system.includes('rozłóż zatwierdzalne'))
        output = {
          blocks: [
            {
              id: 'b1',
              proposal_id: data.proposals[0].id,
              title: 'Szacowane przygotowanie',
              start_at: '2026-11-18T17:00:00+01:00',
              end_at: '2026-11-18T18:00:00+01:00',
              estimated: true,
              reason: 'Demonstracyjny szacunek',
            },
          ],
          warnings: [],
        };
      else
        output = {
          accepted_ids: data.deadlines.proposals.map((p: ProposedTask) => p.id),
          rejected_ids: [],
          issues: [],
          needs_revision: false,
          revise_agent: null,
          summary: 'Mock celowo akceptuje wszystkie: niezależny walidator musi odrzucić błędy.',
        };
      return {
        response: JSON.stringify(output),
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      };
    });
}

describe('Worker handler + rzeczywisty lokalny D1, AI jawnie demonstracyjne', () => {
  it('blokuje anonimowy dostęp poza localhost nawet przy DEV_AUTH=true', async () => {
    const response = await worker.fetch(
      new Request('https://studentos.example/api/bootstrap'),
      env,
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: 'UNAUTHENTICATED' } });
  });
  it('egzekwuje CSRF i izoluje rekordy innego użytkownika', async () => {
    expect(
      (await request('/tasks', 'POST', { title: 'Atak' }, 'https://evil.example')).status,
    ).toBe(403);
    await db.prepare("INSERT INTO users(id,github_id) VALUES('bob','2')").run();
    await db
      .prepare("INSERT INTO tasks(id,user_id,title) VALUES('bobs-task','bob','Prywatne')")
      .run();
    expect((await request('/tasks/bobs-task')).status).toBe(404);
    expect((await request('/tasks/bobs-task', 'PATCH', { title: 'Atak' })).status).toBe(404);
    expect((await request('/tasks/bobs-task', 'DELETE')).status).toBe(404);
    const bootstrap = await body(await request('/bootstrap'));
    expect(bootstrap.tasks).toEqual([]);
  });
  it('wykonuje cztery role z checkpointami, logami, źródłami i idempotentnym zatwierdzeniem', async () => {
    const ai = fixtureAI(exact.gold.map(proposalFromGold));
    env.AI = { run: ai } as unknown as Ai;
    const documentId = await importDocument();
    const runId = await start(documentId);
    const observed = [];
    let detail: Record<string, any> = {};
    for (let i = 0; i < 4; i++) {
      detail = await body(await request(`/runs/${runId}/advance`, 'POST'));
      observed.push(detail.run.state);
      // A fresh read resumes entirely from the D1 checkpoint.
      const resumed = await body(await request(`/runs/${runId}`));
      expect(resumed.run.state).toBe(detail.run.state);
    }
    expect(observed).toEqual(['deadline', 'planner', 'review', 'approval']);
    expect(ai).toHaveBeenCalledTimes(4);
    expect(detail.steps.map((step: any) => step.agent)).toEqual([
      'document',
      'deadline',
      'planner',
      'review',
    ]);
    expect(
      detail.steps.every(
        (step: any) =>
          step.state === 'completed' &&
          step.duration_ms >= 0 &&
          step.input_tokens === 100 &&
          step.output_tokens === 50,
      ),
    ).toBe(true);
    await mkdir(new URL('../../artifacts/', import.meta.url), { recursive: true });
    await writeFile(
      new URL('../../artifacts/qa-workflow-mock.json', import.meta.url),
      JSON.stringify(
        {
          test_only: true,
          ai_binding: 'DEMONSTRACYJNY MOCK — nie jest to odpowiedź Cloudflare AI',
          execution: 'Rzeczywisty handler Worker + lokalny D1 Miniflare',
          ...detail,
        },
        null,
        2,
      ) + '\n',
    );
    expect(detail.result.proposals).toHaveLength(5);
    expect(detail.result.review.accepted_ids).toHaveLength(4);
    expect(detail.result.review.rejected_ids).toHaveLength(1);
    expect((await body(await request('/tasks'))).items).toEqual([]);
    expect((await body(await request(`/documents/${documentId}/analyze`, 'POST'))).cached).toBe(
      true,
    );
    const approval = {
      proposals: detail.result.proposals.filter((p: ProposedTask) => !p.requires_confirmation),
      blocks: detail.result.blocks,
    };
    const committed = await body(await request(`/runs/${runId}/approve`, 'POST', approval));
    expect(committed.run.state).toBe('committed');
    expect(committed.task_ids).toHaveLength(4);
    expect((await body(await request('/tasks'))).items).toHaveLength(4);
    expect((await body(await request(`/runs/${runId}/approve`, 'POST', approval))).idempotent).toBe(
      true,
    );
    expect((await body(await request('/tasks'))).items).toHaveLength(4);
    expect(ai).toHaveBeenCalledTimes(4);
    const usage = await body(await request('/usage'));
    expect(usage.usage).toMatchObject({
      analyses: 1,
      calls: 4,
      input_tokens: 400,
      output_tokens: 200,
    });
    expect((await request(`/documents/${documentId}`, 'DELETE')).status).toBe(200);
    expect((await body(await request('/tasks'))).items).toEqual([]);
    expect((await request(`/runs/${runId}`)).status).toBe(404);
  });
  it('ponowny import przelicza hash treści, zapobiega zatruwaniu cache i duplikatom', async () => {
    const documentId = await importDocument();
    const reimport = await body(
      await request('/documents', 'POST', {
        name: 'inna-nazwa.pdf',
        hash: 'b'.repeat(64),
        pages: exact.pages,
        academic_year: exact.academic_year,
        subject_id: null,
      }),
    );
    expect(reimport.cached).toBe(true);
    expect(reimport.document.id).toBe(documentId);
    const changed = await body(
      await request('/documents', 'POST', {
        name: 'zmieniony.pdf',
        hash: 'a'.repeat(64),
        pages: [{ page: 1, text: 'Projekt zmieniony. Termin 21.11.2026.' }],
        academic_year: exact.academic_year,
        subject_id: null,
      }),
    );
    expect(changed.document.id).not.toBe(documentId);
    expect((await body(await request('/bootstrap'))).documents).toHaveLength(2);
  });
  it('błąd dostawcy / zły JSON ma jeden retry i nie tworzy fikcyjnego wyniku', async () => {
    const ai = vi.fn().mockResolvedValue({ response: 'to nie jest JSON' });
    env.AI = { run: ai } as unknown as Ai;
    const documentId = await importDocument();
    const runId = await start(documentId);
    const first = await body(await request(`/runs/${runId}/advance`, 'POST'));
    expect(first.run.state).toBe('document');
    expect(first.run.retries).toBe(1);
    const failed = await body(await request(`/runs/${runId}/advance`, 'POST'));
    expect(failed.run.state).toBe('failed');
    expect(failed.result).toBe(null);
    expect(failed.steps).toHaveLength(2);
    expect(failed.steps.every((step: any) => step.state === 'failed')).toBe(true);
    await request(`/runs/${runId}/advance`, 'POST');
    expect(ai).toHaveBeenCalledTimes(2);
    expect((await body(await request('/tasks'))).items).toEqual([]);
    expect((await request(`/documents/${documentId}`)).status).toBe(200);
    expect(
      (await request('/tasks', 'POST', { title: 'Ręczne zadanie po błędzie AI' })).status,
    ).toBe(201);
  });
  it('wyczerpany budżet AI pozostawia dokument i ręczne operacje dostępne', async () => {
    const documentId = await importDocument();
    const runId = await start(documentId);
    await db.prepare('UPDATE ai_usage SET calls=24 WHERE user_id=?').bind('local-developer').run();
    const result = await body(await request(`/runs/${runId}/advance`, 'POST'));
    expect(result.run.state).toBe('failed');
    expect(result.run.error).toContain('limit');
    expect(env.AI.run).not.toHaveBeenCalled();
    expect((await request(`/documents/${documentId}`)).status).toBe(200);
    expect((await request('/tasks', 'POST', { title: 'Ręczny projekt' })).status).toBe(201);
  });
  it('nie dopisuje roku do niepełnej daty', async () => {
    const documentId = await importDocument(ambiguous as typeof exact);
    const unsupported = proposalFromGold(
      { title: 'Egzamin', due_date: '2027-01-12', page: 2, quote: 'Egzamin: 12.01 (brak roku).' },
      0,
    );
    const ai = fixtureAI([unsupported]);
    env.AI = { run: ai } as unknown as Ai;
    const runId = await start(documentId);
    await request(`/runs/${runId}/advance`, 'POST');
    const deadlines = await body(await request(`/runs/${runId}/advance`, 'POST'));
    expect(deadlines.run.state).toBe('planner');
    const row = await db
      .prepare('SELECT context_json FROM agent_runs WHERE id=?')
      .bind(runId)
      .first<{ context_json: string }>();
    expect(JSON.parse(row!.context_json).proposals[0]).toMatchObject({
      due_date: null,
      requires_confirmation: true,
    });
    expect(
      (await request(`/runs/${runId}/approve`, 'POST', { proposals: [], blocks: [] })).status,
    ).toBe(409);
  });
  it('fałszywe źródło jest błędem walidacji i nie przechodzi do kolejnego agenta', async () => {
    const ai = fixtureAI([
      {
        ...proposalFromGold(exact.gold[0]!, 0),
        sources: [{ page: 99, quote: 'Nieistniejace zrodlo 20.11.2026' }],
      },
    ]);
    env.AI = { run: ai } as unknown as Ai;
    const runId = await start(await importDocument());
    const first = await body(await request(`/runs/${runId}/advance`, 'POST'));
    expect(first.run.state).toBe('document');
    expect(first.steps[0].state).toBe('failed');
    expect(first.result).toBe(null);
    expect((await body(await request('/tasks'))).items).toEqual([]);
  });
  it('czwarta analiza jest dostępna, piąta blokowana bez ograniczania ręcznych funkcji', async () => {
    const documentId = await importDocument();
    await db
      .prepare('INSERT INTO ai_usage(user_id,day,analyses) VALUES(?,?,3)')
      .bind(
        'local-developer',
        new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw' }).format(new Date()),
      )
      .run();
    expect((await request(`/documents/${documentId}/analyze`, 'POST')).status).toBe(200);
    const usage = await body(await request('/usage'));
    expect(usage.usage.analyses).toBe(4);
    expect(usage.limits).toEqual({ analyses: 4, calls: 24, max_calls_per_run: 12 });
    const secondDocument = await importDocument(ambiguous);
    const limited = await request(`/documents/${secondDocument}/analyze`, 'POST');
    expect(limited.status).toBe(429);
    expect((await body(limited)).error.code).toBe('AI_LIMIT');
    expect((await request(`/documents/${documentId}`)).status).toBe(200);
    expect((await request('/tasks', 'POST', { title: 'Po limicie' })).status).toBe(201);
  });

  it('blokada etapu nie pozwala dwóm klientom wywołać modelu równocześnie', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const delegate = fixtureAI([proposalFromGold(exact.gold[0]!, 0)]);
    const ai = vi.fn().mockImplementation(async (...args: unknown[]) => {
      await gate;
      return delegate(...args);
    });
    env.AI = { run: ai } as unknown as Ai;
    const runId = await start(await importDocument());
    const first = request(`/runs/${runId}/advance`, 'POST');
    await vi.waitFor(() => expect(ai).toHaveBeenCalledTimes(1));
    const concurrent = await request(`/runs/${runId}/advance`, 'POST');
    expect(concurrent.status).toBe(409);
    expect((await body(concurrent)).error.code).toBe('RUN_BUSY');
    release();
    expect((await body(await first)).run.state).toBe('deadline');
    expect(ai).toHaveBeenCalledTimes(1);
  });
  it('limit dostawcy429 kończy analizę bez retry i bez utraty dokumentu', async () => {
    const ai = vi.fn().mockRejectedValue({ status: 429, message: 'Daily neurons quota exceeded' });
    env.AI = { run: ai } as unknown as Ai;
    const documentId = await importDocument();
    const runId = await start(documentId);
    const result = await body(await request(`/runs/${runId}/advance`, 'POST'));
    expect(result.run.state).toBe('failed');
    expect(result.run.error).toMatch(/limit|AI/i);
    expect(result.result).toBe(null);
    await request(`/runs/${runId}/advance`, 'POST');
    expect(ai).toHaveBeenCalledTimes(1);
    expect((await request(`/documents/${documentId}`)).status).toBe(200);
  });
  it('zatwierdza40 zadań bez przekroczenia limitu parametrów pojedynczego SQL', async () => {
    const proposals = Array.from({ length: 40 }, (_, index) => ({
      ...proposalFromGold(exact.gold[0]!, index),
      title: `Obowiazek ${index + 1}`,
    }));
    env.AI = { run: fixtureAI(proposals) } as unknown as Ai;
    const runId = await start(await importDocument());
    let detail: Record<string, any> = {};
    for (let i = 0; i < 4; i++)
      detail = await body(await request(`/runs/${runId}/advance`, 'POST'));
    expect(detail.run.state).toBe('approval');
    const response = await request(`/runs/${runId}/approve`, 'POST', {
      proposals: detail.result.proposals,
      blocks: detail.result.blocks,
    });
    expect(response.status).toBe(200);
    expect((await body(response)).run.state).toBe('committed');
    expect((await body(await request('/tasks'))).items).toHaveLength(40);
  });
});
