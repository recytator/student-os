import type { Miniflare } from 'miniflare';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import worker from '../../worker';
import { handleApi } from '../../worker/api';
import { nextDate, warsawMidnight } from '../../shared/time';
import type { Env, User } from '../../worker/types';
import { localDatabase } from './harness';

let runtime: Miniflare;
let db: D1Database;
let env: Env;
const user = { id: 'alice' } as User;

beforeAll(async () => {
  ({ runtime, db } = await localDatabase('qa-calendar-consistency'));
  env = { DB: db } as Env;
  await db.prepare("INSERT INTO users(id,github_id) VALUES('alice','1'),('bob','2')").run();
  await db
    .prepare(
      "INSERT INTO subjects(id,user_id,name) VALUES('s1','alice','AI'),('s2','alice','Robotyka')",
    )
    .run();
  await db
    .prepare(
      "INSERT INTO documents(id,user_id,name,hash,academic_year,page_count,text_length) VALUES('doc','alice','Sylabus',?,'2026/2027',1,100)",
    )
    .bind('a'.repeat(64))
    .run();
}, 30_000);
afterAll(async () => {
  await runtime?.dispose();
});

async function fixture(key: string) {
  const taskId = `task-${key}`;
  const runId = `run-${key}`;
  const notes = {
    sources: [{ page: 1, quote: 'Projekt do 20.11.2026.' }],
    run_id: runId,
    estimated_minutes: 60,
    date_origin: 'document',
    warning: null,
  };
  await db.batch([
    db
      .prepare(
        'INSERT INTO tasks(id,user_id,document_id,subject_id,title,due_date,proposal_id,notes) VALUES(?,?,?,?,?,?,?,?)',
      )
      .bind(
        taskId,
        'alice',
        'doc',
        's1',
        'Projekt',
        '2026-11-20',
        `${runId}:p1`,
        JSON.stringify(notes),
      ),
    db
      .prepare(
        'INSERT INTO calendar_events(id,user_id,task_id,document_id,subject_id,title,start_at,end_at,proposal_id) VALUES(?,?,?,?,?,?,?,?,?)',
      )
      .bind(
        `event-${runId}-p1`,
        'alice',
        taskId,
        'doc',
        's1',
        'Termin: Projekt',
        '2026-11-20T00:00:00+01:00',
        '2026-11-21T00:00:00+01:00',
        `${runId}:due-p1`,
      ),
    db
      .prepare(
        'INSERT INTO calendar_events(id,user_id,task_id,document_id,subject_id,title,start_at,end_at,proposal_id) VALUES(?,?,?,?,?,?,?,?,?)',
      )
      .bind(
        `block-${key}`,
        'alice',
        taskId,
        'doc',
        's1',
        'Przygotowanie',
        '2026-11-18T17:00:00+01:00',
        '2026-11-18T18:00:00+01:00',
        `${runId}:block-b1`,
      ),
    db
      .prepare(
        'INSERT INTO calendar_events(id,user_id,document_id,title,start_at,end_at) VALUES(?,?,?,?,?,?)',
      )
      .bind(
        `manual-${key}`,
        'alice',
        'doc',
        'Własne wydarzenie',
        '2026-11-20T12:00:00+01:00',
        '2026-11-20T13:00:00+01:00',
      ),
  ]);
  return { taskId, runId, notes };
}
async function patch(taskId: string, input: unknown) {
  const response = await handleApi(
    new Request(`https://studentos.example/api/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),
    env,
    user,
  );
  expect(response?.status).toBe(200);
  return (await response!.json()) as Record<string, unknown>;
}
async function event(id: string) {
  return db
    .prepare('SELECT * FROM calendar_events WHERE id=?')
    .bind(id)
    .first<Record<string, unknown>>();
}

describe('zadanie i kalendarz — transakcje na prawdziwym lokalnym D1', () => {
  it('synchronizuje tytuł i przedmiot bez usuwania poprawnego planu nauki', async () => {
    const { taskId, runId } = await fixture('title');
    await patch(taskId, { title: 'Nowy projekt', subject_id: 's2' });
    expect(await event(`event-${runId}-p1`)).toMatchObject({
      title: 'Termin: Nowy projekt',
      subject_id: 's2',
      start_at: '2026-11-20T00:00:00+01:00',
    });
    expect(await event('block-title')).toMatchObject({ subject_id: 's2' });
    expect(await event('manual-title')).toMatchObject({
      title: 'Własne wydarzenie',
      task_id: null,
    });
  });
  it('zmiana daty unieważnia tylko powiązane bloki i zachowuje niezmienne źródła', async () => {
    const { taskId, runId, notes } = await fixture('date');
    await fixture('other');
    const result = await patch(taskId, {
      due_date: '2026-03-29',
      notes: JSON.stringify({
        sources: [{ page: 9, quote: 'Fałsz' }],
        run_id: 'forged',
        date_origin: 'document',
        user_notes: 'Moja notatka',
      }),
    });
    expect(result.warnings).toEqual([
      'Zmieniono termin. Poprzednie bloki nauki usunięto; zaplanuj je ponownie.',
    ]);
    const stored = JSON.parse(String(result.notes));
    expect(stored).toMatchObject({
      sources: notes.sources,
      run_id: runId,
      user_notes: 'Moja notatka',
      date_origin: 'user_confirmed',
      planning_status: 'needs_replanning',
    });
    expect(await event(`event-${runId}-p1`)).toMatchObject({
      start_at: '2026-03-29T00:00:00+01:00',
      end_at: '2026-03-30T00:00:00+02:00',
    });
    expect(await event('block-date')).toBeNull();
    expect(await event('manual-date')).not.toBeNull();
    expect(await event('block-other')).not.toBeNull();
  });
  it('usunięcie i ponowne ustawienie daty usuwa i odtwarza dokładnie termin zadania', async () => {
    const { taskId, runId } = await fixture('clear');
    await patch(taskId, { due_date: null });
    expect(await event(`event-${runId}-p1`)).toBeNull();
    await patch(taskId, { due_date: '2026-10-25' });
    expect(await event(`event-${runId}-p1`)).toMatchObject({
      task_id: taskId,
      start_at: '2026-10-25T00:00:00+02:00',
      end_at: '2026-10-26T00:00:00+01:00',
    });
    expect(await event('block-clear')).toBeNull();
  });
  it('zapis notatki nie niszczy źródeł, a usunięcie zadania kaskaduje tylko jawne relacje', async () => {
    const { taskId, runId, notes } = await fixture('delete');
    const result = await patch(taskId, { notes: 'Zadzwonić do prowadzącego' });
    expect(JSON.parse(String(result.notes))).toMatchObject({
      ...notes,
      user_notes: 'Zadzwonić do prowadzącego',
    });
    await handleApi(
      new Request(`https://studentos.example/api/tasks/${taskId}`, { method: 'DELETE' }),
      env,
      user,
    );
    expect(await event(`event-${runId}-p1`)).toBeNull();
    expect(await event('block-delete')).toBeNull();
    expect(await event('manual-delete')).not.toBeNull();
  });
  it('błąd kalendarza wycofuje również zmianę terminu i usuwanie bloków', async () => {
    const { taskId, runId } = await fixture('rollback');
    await db
      .prepare('UPDATE calendar_events SET task_id=NULL,proposal_id=NULL WHERE id=?')
      .bind(`event-${runId}-p1`)
      .run();
    await expect(patch(taskId, { due_date: '2026-12-01' })).rejects.toThrow();
    expect(await db.prepare('SELECT due_date FROM tasks WHERE id=?').bind(taskId).first()).toEqual({
      due_date: '2026-11-20',
    });
    expect(await event('block-rollback')).not.toBeNull();
  });
  it('ręczne zadania zachowują zwykłe notatki i nie tworzą arbitralnych wydarzeń', async () => {
    await db
      .prepare(
        "INSERT INTO tasks(id,user_id,title,notes) VALUES('manual-task','alice','Ręczne','Treść')",
      )
      .run();
    const result = await patch('manual-task', { due_date: '2026-12-02', notes: 'Własna treść' });
    expect(result.notes).toBe('Własna treść');
    expect(
      await db
        .prepare("SELECT COUNT(*) AS count FROM calendar_events WHERE task_id='manual-task'")
        .first(),
    ).toEqual({ count: 0 });
  });
  it('D1 blokuje powiązanie wydarzenia z zadaniem innego właściciela', async () => {
    await expect(
      db
        .prepare(
          "INSERT INTO calendar_events(id,user_id,task_id,title,start_at,end_at) VALUES('intruder','bob','manual-task','Obce','2026-11-01T10:00:00Z','2026-11-01T11:00:00Z')",
        )
        .run(),
    ).rejects.toThrow('ownership');
  });
  it('liczne odczyty nie zużywają budżetu zapisu, który nadal blokuje nadmiarowe mutacje', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-15T12:00:00Z'));
    const localEnv = { ...env, DEV_AUTH: 'true' };
    try {
      for (let index = 0; index < 65; index++) {
        const response = await worker.fetch(
          new Request('http://localhost:8787/api/tasks'),
          localEnv,
        );
        expect(response.status).toBe(200);
      }
      for (let index = 0; index < 60; index++) {
        const response = await worker.fetch(
          new Request('http://localhost:8787/api/tasks', {
            method: 'POST',
            headers: { Origin: 'http://localhost:8787', 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: `Limit test ${index}` }),
          }),
          localEnv,
        );
        expect(response.status).toBe(201);
      }
      const limited = await worker.fetch(
        new Request('http://localhost:8787/api/tasks', {
          method: 'POST',
          headers: { Origin: 'http://localhost:8787', 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: 'Ponad limit' }),
        }),
        localEnv,
      );
      expect(limited.status).toBe(429);
      expect(await limited.json()).toMatchObject({ error: { code: 'RATE_LIMIT' } });
      expect(
        (await worker.fetch(new Request('http://localhost:8787/api/tasks'), localEnv)).status,
      ).toBe(200);
    } finally {
      clock.mockRestore();
    }
  }, 30_000); // 127 sequential Worker/D1 requests also run on slower CI hosts.
  it('północ warszawska uwzględnia 23- i 25-godzinny dzień zmiany czasu', () => {
    for (const [date, hours] of [
      ['2026-03-29', 23],
      ['2026-10-25', 25],
    ] as const) {
      expect(
        (Date.parse(warsawMidnight(nextDate(date))) - Date.parse(warsawMidnight(date))) / 3600000,
      ).toBe(hours);
    }
  });
});
