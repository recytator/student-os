/* eslint-disable @typescript-eslint/no-explicit-any -- JSON assertions inspect server payloads at the integration boundary. */
import { readFile } from 'node:fs/promises';
import type { Miniflare } from 'miniflare';
import { unstable_splitSqlQuery } from 'wrangler';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../../worker/index';
import type { Env } from '../../worker/types';
import { localDatabase } from './harness';
import exact from '../fixtures/syllabus-exact.json';

let runtime: Miniflare;
let db: D1Database;
let env: Env;
let ai: ReturnType<typeof vi.fn>;
const origin = 'http://localhost:8787';
const request = async (path: string, method = 'GET', data?: unknown) =>
  worker.fetch(
    new Request(`${origin}/api${path}`, {
      method,
      headers: {
        ...(method !== 'GET' ? { Origin: origin } : {}),
        ...(data ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(data ? { body: JSON.stringify(data) } : {}),
    }),
    env,
  );
const body = async (response: Response) => (await response.json()) as Record<string, any>;
const sql = async (name: string, fromMarker?: string) => {
  let text = await readFile(new URL(`../../migrations/${name}`, import.meta.url), 'utf8');
  if (fromMarker) text = text.slice(text.indexOf(fromMarker));
  await db.batch(unstable_splitSqlQuery(text).map((statement) => db.prepare(statement)));
};
const notesResponse = (pages: number[]) => ({
  choices: [
    {
      message: {
        content: JSON.stringify({
          title: 'Organizacja przedmiotu',
          summary: 'Zasady zaliczenia i terminy.',
          sections: [
            { heading: 'Zaliczenie', pages: [...pages, 99], points: ['Projekt i kolokwium.', ''] },
            { heading: '', pages: [1], points: ['pominięta sekcja bez nagłówka'] },
          ],
          key_terms: [
            { term: 'Kolokwium', definition: 'Pisemny sprawdzian.' },
            { term: '', definition: 'bez nazwy' },
          ],
          questions: [{ question: 'Kiedy jest kolokwium?', answer: 'Według sylabusa.' }],
        }),
      },
    },
  ],
  usage: { prompt_tokens: 120, completion_tokens: 80 },
});

beforeEach(async () => {
  ({ runtime, db } = await localDatabase(`plan-notes-${crypto.randomUUID()}`));
  ai = vi.fn().mockResolvedValue(notesResponse([1, 2]));
  env = {
    DB: db,
    AI: { run: ai } as unknown as Ai,
    ASSETS: { fetch: async () => new Response('assets') } as unknown as Fetcher,
    DEV_AUTH: 'true',
    APP_ORIGIN: origin,
  };
});
afterEach(async () => {
  await runtime?.dispose();
});

describe('plan semestru jako edytowalne zajęcia cykliczne', () => {
  it('importuje transkrypcję GL2 do zajęć z zakresami tygodni i niepewnością', async () => {
    await db
      .prepare("INSERT INTO users(id,github_id) VALUES('owner','166433083'),('other','2')")
      .run();
    await sql('0004_semester_timetable.sql', '-- Import only');
    await sql('0007_plan_tasks_notes.sql', '-- Timetable import');
    await sql('0007_plan_tasks_notes.sql', '-- Timetable import');
    const rows = (
      await db
        .prepare(
          'SELECT s.*,sub.name FROM class_schedules s JOIN subjects sub ON sub.id=s.subject_id WHERE s.user_id=?',
        )
        .bind('owner')
        .all<Record<string, any>>()
    ).results;
    expect(rows).toHaveLength(18);
    const gl2 = rows.find((row) => row.class_type === 'GL2');
    expect(gl2).toMatchObject({
      weekday: 2,
      start_time: '17:00',
      end_time: '19:45',
      valid_from: '2026-11-10',
      valid_to: '2027-01-31',
      tentative: 0,
    });
    expect(
      rows.find(
        (row) => row.name === 'Percepcja wizyjna w robotyce' && row.class_type === 'wykład',
      ),
    ).toMatchObject({ valid_from: '2026-10-05', valid_to: '2026-11-03' });
    expect(
      rows.filter((row) => row.name.startsWith('Zastosowania AI')).map((row) => row.valid_from),
    ).toEqual(['2026-11-23', '2026-11-23']);
    expect(rows.filter((row) => row.tentative === 1)).toHaveLength(12);
    expect(
      await db.prepare("SELECT count(*) AS n FROM class_schedules WHERE user_id='other'").first(),
    ).toEqual({ n: 0 });
    expect(
      (
        await db
          .prepare("SELECT count(*) AS n FROM subjects WHERE user_id='owner' AND class_type!=''")
          .first()
      )?.n,
    ).toBe(0);
  });

  it('odwołuje pojedynczy tydzień, eksportuje EXDATE i przechowuje typ zadania', async () => {
    const subject = await body(await request('/subjects', 'POST', { name: 'Robotyka' }));
    const schedule = await request('/schedules', 'POST', {
      subject_id: subject.id,
      weekday: 2,
      start_time: '17:00',
      end_time: '18:30',
      valid_from: '2026-10-06',
      valid_to: '2027-01-26',
      location: 's. E',
      class_type: 'wykład',
      tentative: 1,
    });
    expect(schedule.status).toBe(201);
    const scheduleId = (await body(schedule)).id;
    const exception = await request(`/schedules/${scheduleId}/exceptions`, 'POST', {
      date: '2026-10-20',
      kind: 'cancelled',
    });
    expect(exception.status).toBe(201);
    expect(
      (
        await request(`/schedules/${scheduleId}/exceptions`, 'POST', {
          date: '2026-10-27',
          kind: 'maybe',
        })
      ).status,
    ).toBe(400);
    const bootstrap = await body(await request('/bootstrap'));
    expect(bootstrap.schedule_exceptions).toMatchObject([
      { schedule_id: scheduleId, date: '2026-10-20', kind: 'cancelled' },
    ]);
    const ics = await (await request('/export.ics')).text();
    expect(ics).toContain('EXDATE;TZID=Europe/Warsaw:20261020T170000');
    expect(ics).toContain('SUMMARY:Robotyka (wykład) ?');
    expect((await request(`/schedules/${scheduleId}/exceptions/2026-10-20`, 'DELETE')).status).toBe(
      200,
    );
    expect((await body(await request('/bootstrap'))).schedule_exceptions).toEqual([]);

    const exam = await request('/tasks', 'POST', { title: 'Egzamin', kind: 'exam' });
    expect((await body(exam)).kind).toBe('exam');
    expect((await request('/tasks', 'POST', { title: 'X', kind: 'party' })).status).toBe(400);
    const plain = await body(await request('/tasks', 'POST', { title: 'Lektura' }));
    expect(plain.kind).toBe('task');
  });
});

describe('notatki AI z dokumentu', () => {
  async function importDocument() {
    const response = await request('/documents', 'POST', {
      name: exact.name,
      hash: 'a'.repeat(64),
      pages: exact.pages,
      academic_year: exact.academic_year,
      subject_id: null,
    });
    expect(response.status).toBe(201);
    return (await body(response)).document.id as string;
  }

  it('generuje, oczyszcza i zlicza notatki we wspólnym limicie wywołań', async () => {
    const documentId = await importDocument();
    const started = await request(`/documents/${documentId}/notes`, 'POST', { detail: 'concise' });
    expect(started.status).toBe(201);
    const note = await body(started);
    expect(note).toMatchObject({ state: 'running', chunks_total: 1, chunks_done: 0 });
    expect(ai).not.toHaveBeenCalled();
    const ready = await body(await request(`/notes/${note.id}/advance`, 'POST'));
    expect(ready.state).toBe('ready');
    const part = ready.content.parts[0];
    expect(part.sections).toEqual([
      { heading: 'Zaliczenie', pages: [1, 2], points: ['Projekt i kolokwium.'] },
    ]);
    expect(part.key_terms).toEqual([{ term: 'Kolokwium', definition: 'Pisemny sprawdzian.' }]);
    expect(ai.mock.calls[0][1].response_format.type).toBe('json_schema');
    expect(ai.mock.calls[0][1].messages[1].content).toContain('[Strona 1]');
    const usage = await body(await request('/usage'));
    expect(usage.usage).toMatchObject({ calls: 1, input_tokens: 120, output_tokens: 80 });
    const bootstrap = await body(await request('/bootstrap'));
    expect(bootstrap.notes).toMatchObject([
      { id: note.id, state: 'ready', title: 'Organizacja przedmiotu' },
    ]);
    // Regenerating replaces the same note instead of duplicating it.
    const again = await body(await request(`/documents/${documentId}/notes`, 'POST', {}));
    expect(again).toMatchObject({ id: note.id, state: 'running', detail: 'standard' });
  });

  it('zapisuje błąd modelu, pozwala ponowić i respektuje dzienny limit', async () => {
    const documentId = await importDocument();
    const note = await body(await request(`/documents/${documentId}/notes`, 'POST', {}));
    ai.mockRejectedValueOnce(new Error('provider down'));
    const failed = await body(await request(`/notes/${note.id}/advance`, 'POST'));
    expect(failed.state).toBe('failed');
    expect(failed.error).toContain('niedostępny');
    expect((await body(await request(`/notes/${note.id}/advance`, 'POST'))).state).toBe('ready');
    await db.prepare('UPDATE ai_usage SET calls=24').run();
    const retry = await body(await request(`/documents/${documentId}/notes`, 'POST', {}));
    const limited = await request(`/notes/${retry.id}/advance`, 'POST');
    expect(limited.status).toBe(429);
    expect(ai).toHaveBeenCalledTimes(2);
    expect((await request(`/notes/${note.id}`, 'DELETE')).status).toBe(200);
    expect((await request(`/notes/${note.id}`)).status).toBe(404);
  });

  it('strumieniuje advance z heartbeatem i kończy część mimo zerwanego połączenia', async () => {
    const documentId = await importDocument();
    const note = await body(await request(`/documents/${documentId}/notes`, 'POST', {}));
    let release!: () => void;
    ai.mockImplementationOnce(
      () => new Promise((resolve) => (release = () => resolve(notesResponse([1])))),
    );
    const waits: Promise<unknown>[] = [];
    const streamed = await worker.fetch(
      new Request(`${origin}/api/notes/${note.id}/advance`, {
        method: 'POST',
        headers: { Origin: origin, Accept: 'text/event-stream' },
      }),
      env,
      {
        waitUntil: (promise: Promise<unknown>) => void waits.push(promise),
      } as unknown as ExecutionContext,
    );
    expect(streamed.headers.get('content-type')).toContain('text/event-stream');
    expect(streamed.headers.get('cache-control')).toContain('no-transform');
    // The client disconnects: the stream is cancelled while the model is still working.
    await streamed.body!.cancel();
    const busy = await request(`/notes/${note.id}/advance`, 'POST');
    expect(busy.status).toBe(409);
    expect((await body(busy)).error.details.retry_after_ms).toBeGreaterThan(1000);
    expect((await body(await request(`/notes/${note.id}`))).busy_ms).toBeGreaterThan(0);
    release();
    await Promise.all(waits);
    const saved = await body(await request(`/notes/${note.id}`));
    expect(saved).toMatchObject({ state: 'ready', chunks_done: 1, busy_ms: 0 });
    // A connected client receives the result as the final event.
    const retry = await body(await request(`/documents/${documentId}/notes`, 'POST', {}));
    const live = await worker.fetch(
      new Request(`${origin}/api/notes/${retry.id}/advance`, {
        method: 'POST',
        headers: { Origin: origin, Accept: 'text/event-stream' },
      }),
      env,
    );
    const text = await live.text();
    expect(text.startsWith(': start')).toBe(true);
    const event = text.split('\n\n').find((block) => block.startsWith('event: note'))!;
    expect(JSON.parse(event.split('data: ')[1]!)).toMatchObject({ state: 'ready' });
  });

  it('zachowuje gotowe sekcje z odpowiedzi uciętej przez limit tokenów', async () => {
    const documentId = await importDocument();
    const note = await body(await request(`/documents/${documentId}/notes`, 'POST', {}));
    const full = JSON.stringify({
      title: 'Organizacja',
      summary: 'Zasady.',
      sections: [
        { heading: 'Zaliczenie', pages: [1], points: ['Projekt.'] },
        {
          heading: 'Kolokwium',
          pages: [2],
          points: ['Pisemne, w grudniu i jeszcze więcej tekstu'],
        },
      ],
      key_terms: [],
      questions: [],
    });
    ai.mockResolvedValueOnce({
      choices: [{ message: { content: full.slice(0, full.indexOf('w grudniu')) } }],
    });
    const ready = await body(await request(`/notes/${note.id}/advance`, 'POST'));
    expect(ready.state).toBe('ready');
    expect(ready.content.parts[0].sections.map((s: any) => s.heading)).toEqual(['Zaliczenie']);
  });

  it('przypisuje dokument do własnego przedmiotu', async () => {
    const documentId = await importDocument();
    const subject = await body(await request('/subjects', 'POST', { name: 'AI' }));
    const patched = await body(
      await request(`/documents/${documentId}`, 'PATCH', { subject_id: subject.id }),
    );
    expect(patched.document.subject_id).toBe(subject.id);
    expect(
      (await request(`/documents/${documentId}`, 'PATCH', { subject_id: 'foreign' })).status,
    ).toBe(422);
  });
});
