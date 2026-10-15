import type { Miniflare } from 'miniflare';
import { localDatabase } from './harness';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let runtime: Miniflare;
let db: D1Database;

beforeAll(async () => {
  ({ runtime, db } = await localDatabase('qa-database'));
  await db.prepare("INSERT INTO users(id,github_id) VALUES('alice','1'),('bob','2')").run();
  await db
    .prepare(
      "INSERT INTO subjects(id,user_id,name) VALUES('alice-subject','alice','AI'),('bob-subject','bob','Drony')",
    )
    .run();
}, 30_000);
afterAll(async () => {
  await runtime?.dispose();
});

describe('rzeczywisty lokalny D1 — integralność i izolacja', () => {
  it('zapisuje i ponownie odczytuje zadanie', async () => {
    await db
      .prepare('INSERT INTO tasks(id,user_id,subject_id,title,due_date) VALUES(?,?,?,?,?)')
      .bind('alice-task', 'alice', 'alice-subject', 'Projekt', '2026-11-20')
      .run();
    const result = await db
      .prepare('SELECT title,due_date FROM tasks WHERE id=? AND user_id=?')
      .bind('alice-task', 'alice')
      .first();
    expect(result).toEqual({ title: 'Projekt', due_date: '2026-11-20' });
    expect(
      await db
        .prepare('SELECT * FROM tasks WHERE id=? AND user_id=?')
        .bind('alice-task', 'bob')
        .first(),
    ).toBe(null);
  });
  it('odrzuca obce powiązanie przedmiotu również na poziomie D1', async () => {
    await expect(
      db
        .prepare('INSERT INTO tasks(id,user_id,subject_id,title) VALUES(?,?,?,?)')
        .bind('bad-task', 'bob', 'alice-subject', 'Intruz')
        .run(),
    ).rejects.toThrow('ownership');
  });
  it('usuwa podzadania kaskadowo i zachowuje dane innego użytkownika', async () => {
    await db
      .prepare(
        "INSERT INTO subtasks(id,user_id,task_id,title) VALUES('sub','alice','alice-task','Etap 1')",
      )
      .run();
    await db.prepare("DELETE FROM tasks WHERE id='alice-task'").run();
    expect(await db.prepare("SELECT * FROM subtasks WHERE id='sub'").first()).toBe(null);
    expect(await db.prepare("SELECT * FROM subjects WHERE id='bob-subject'").first()).not.toBe(
      null,
    );
  });
  it('batch D1 wycofuje całość po błędzie ograniczenia', async () => {
    await expect(
      db.batch([
        db.prepare("INSERT INTO subjects(id,user_id,name) VALUES('rollback','alice','Rollback')"),
        db.prepare(
          "INSERT INTO tasks(id,user_id,subject_id,title) VALUES('bad-batch','alice','bob-subject','Obca relacja')",
        ),
      ]),
    ).rejects.toThrow();
    expect(await db.prepare("SELECT * FROM subjects WHERE id='rollback'").first()).toBe(null);
  });
});
