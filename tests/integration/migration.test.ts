import { readFile } from 'node:fs/promises';
import type { Miniflare } from 'miniflare';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { localDatabase } from './harness';

let runtime: Miniflare;
let db: D1Database;

beforeAll(async () => {
  ({ runtime, db } = await localDatabase('qa-active-run-migration'));
  await db.prepare("INSERT INTO users(id,github_id) VALUES('owner','1')").run();
  for (const [id, hash] of [
    ['document', 'a'],
    ['historical', 'b'],
  ]) {
    await db
      .prepare(
        'INSERT INTO documents(id,user_id,name,hash,academic_year,page_count,text_length) VALUES(?,?,?,?,?,?,?)',
      )
      .bind(id, 'owner', 'Fixture', hash!.repeat(64), '2026/2027', 1, 100)
      .run();
  }
}, 30_000);
afterAll(async () => {
  await runtime?.dispose();
});

describe('D1 — migracja atomowej ochrony aktywnych analiz', () => {
  it('odrzuca drugi aktywny run i umożliwia nowy dopiero po zamknięciu pierwszego', async () => {
    await db
      .prepare(
        "INSERT INTO agent_runs(id,user_id,document_id,model) VALUES('first','owner','document','test-model')",
      )
      .run();
    await expect(
      db
        .prepare(
          "INSERT INTO agent_runs(id,user_id,document_id,model) VALUES('duplicate','owner','document','test-model')",
        )
        .run(),
    ).rejects.toThrow('UNIQUE');
    expect(
      await db
        .prepare("SELECT COUNT(*) AS count FROM agent_runs WHERE document_id='document'")
        .first(),
    ).toEqual({ count: 1 });
    await db.prepare("UPDATE agent_runs SET state='committed' WHERE id='first'").run();
    await db
      .prepare(
        "INSERT INTO agent_runs(id,user_id,document_id,model) VALUES('second','owner','document','test-model')",
      )
      .run();
    expect(
      await db
        .prepare("SELECT COUNT(*) AS count FROM agent_runs WHERE document_id='document'")
        .first(),
    ).toEqual({ count: 2 });
  });

  it('porządkuje historyczny wyścig bez usuwania checkpointów i logów', async () => {
    // Reproduce a database created before 0002 was introduced.
    await db.prepare('DROP INDEX agent_runs_one_active_document').run();
    const fixtures = [
      ['early', 'document', '2026-10-01'],
      ['planner', 'planner', '2026-10-02'],
      ['keep', 'approval', '2026-10-03'],
      ['later', 'approval', '2026-10-04'],
    ];
    for (const [id, state, created] of fixtures) {
      await db
        .prepare(
          'INSERT INTO agent_runs(id,user_id,document_id,state,model,created_at,context_json,lease_until,lease_token) VALUES(?,?,?,?,?,?,?,?,?)',
        )
        .bind(
          id,
          'owner',
          'historical',
          state,
          'test-model',
          created,
          '{"preserved":true}',
          999,
          'lease',
        )
        .run();
    }
    await db
      .prepare(
        "INSERT INTO agent_steps(id,run_id,user_id,agent,state,started_at) VALUES('history','early','owner','document','completed','2026-10-01')",
      )
      .run();
    const migration = await readFile(
      new URL('../../migrations/0002_one_active_run.sql', import.meta.url),
      'utf8',
    );
    for (const statement of migration.split(/;\s*(?:\n|$)/)) {
      if (statement.trim()) await db.prepare(statement).run();
    }
    expect(
      (
        await db
          .prepare("SELECT id FROM agent_runs WHERE document_id='historical' AND state='approval'")
          .all()
      ).results,
    ).toEqual([{ id: 'keep' }]);
    expect(
      await db
        .prepare(
          "SELECT COUNT(*) AS count FROM agent_runs WHERE document_id='historical' AND state='failed' AND lease_until=0 AND lease_token IS NULL AND error IS NOT NULL",
        )
        .first(),
    ).toEqual({ count: 3 });
    expect(
      await db
        .prepare('SELECT COUNT(*) AS count FROM agent_runs WHERE document_id=? AND context_json=?')
        .bind('historical', '{"preserved":true}')
        .first(),
    ).toEqual({ count: 4 });
    expect(
      await db.prepare("SELECT COUNT(*) AS count FROM agent_steps WHERE id='history'").first(),
    ).toEqual({ count: 1 });
    await expect(
      db
        .prepare(
          "INSERT INTO agent_runs(id,user_id,document_id,model) VALUES('blocked','owner','historical','test-model')",
        )
        .run(),
    ).rejects.toThrow('UNIQUE');
    expect((await db.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
  });
});
