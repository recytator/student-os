import { readFile } from 'node:fs/promises';
import { unstable_splitSqlQuery } from 'wrangler';
import { expect, it } from 'vitest';
import { localDatabase } from './harness';
import { handleApi } from '../../worker/api';
import { advanceRun } from '../../worker/orchestrator';
import type { Env, User } from '../../worker/types';

const migration = async (db: D1Database, name: string) => {
  const sql = await readFile(new URL(`../../migrations/${name}`, import.meta.url), 'utf8');
  await db.batch(unstable_splitSqlQuery(sql).map((statement) => db.prepare(statement)));
};

it('imports the GL2 photo once for its owner, persists it in bootstrap/export and deletes it with owner data', async () => {
  const { runtime, db } = await localDatabase('semester-import');
  try {
    await db
      .prepare("INSERT INTO users(id,github_id) VALUES('owner','166433083'),('other','2')")
      .run();
    await db
      .prepare(
        "INSERT INTO subjects(id,user_id,name) VALUES('existing','owner','Biologia obliczeniowa')",
      )
      .run();
    await migration(db, '0004_semester_timetable.sql');
    await migration(db, '0004_semester_timetable.sql');
    const env = { DB: db } as Env;
    const user = { id: 'owner' } as User;
    const bootstrap = (await (await handleApi(
      new Request('https://example.test/api/bootstrap'),
      env,
      user,
    ))!.json()) as {
      timetables: Array<{
        group: string;
        starts_on: string;
        entries: Array<{ class_type: string; start_time: string; end_time: string; notes: string }>;
      }>;
      subjects: unknown[];
      schedules: unknown[];
    };
    expect(bootstrap.subjects).toHaveLength(10);
    expect(bootstrap.schedules).toEqual([]); // No invented dated recurrence.
    expect(bootstrap.timetables).toHaveLength(1);
    const timetable = bootstrap.timetables[0]!;
    expect(timetable.group).toBe('GI1 / GL2');
    expect(timetable.starts_on).toBe('2026-10-04');
    expect(timetable.entries).toHaveLength(18);
    expect(timetable.entries.find((entry) => entry.class_type === 'GL2')).toMatchObject({
      start_time: '17:00',
      end_time: '19:45',
      notes: '10 spotkań, od 10.11.2026',
    });
    expect(timetable.entries.some((entry) => entry.class_type === 'GL1')).toBe(false);
    const other = (await (await handleApi(new Request('https://example.test/api/bootstrap'), env, {
      id: 'other',
    } as User))!.json()) as { timetables: unknown[]; subjects: unknown[] };
    expect(other.timetables).toEqual([]);
    expect(other.subjects).toEqual([]);
    const exported = (await (await handleApi(
      new Request('https://example.test/api/export'),
      env,
      user,
    ))!.json()) as { semester_timetables: unknown[] };
    expect(exported.semester_timetables).toHaveLength(1);
    await handleApi(new Request('https://example.test/api/data', { method: 'DELETE' }), env, user);
    expect((await db.prepare('SELECT * FROM semester_timetables').all()).results).toEqual([]);
  } finally {
    await runtime.dispose();
  }
}, 30_000);

it('recovers only the latest matching failure once, preserves budgets and advances with >20 real catalog references', async () => {
  const { runtime, db } = await localDatabase('source-limit-recovery');
  try {
    await db.prepare("INSERT INTO users(id,github_id) VALUES('owner','1')").run();
    const text = Array.from({ length: 35 }, (_, i) => `Zdanie numer ${i}.\n`).join('');
    const context = JSON.stringify({
      chunk: 0,
      documents: [],
      proposals: [],
      blocks: [],
      warnings: [],
      review: null,
      revision: 0,
    });
    const validation = JSON.stringify({
      validation_code: 'SCHEMA',
      issues: [{ path: ['sections', 0, 'sources'], code: 'too_big' }],
    });
    for (const doc of ['doc', 'unrelated', 'older']) {
      await db
        .prepare(
          'INSERT INTO documents(id,user_id,name,hash,academic_year,page_count,text_length) VALUES(?,?,?,?,?,?,?)',
        )
        .bind(doc, 'owner', 'Test', doc.padEnd(64, 'a'), '2026/2027', 1, text.length)
        .run();
      await db
        .prepare(
          'INSERT INTO document_sections(id,user_id,document_id,page,text) VALUES(?,?,?,?,?)',
        )
        .bind(doc, 'owner', doc, 1, text)
        .run();
    }
    for (const [run, doc, report] of [
      ['old', 'doc', validation],
      ['recover', 'doc', validation],
      ['wrong-error', 'unrelated', JSON.stringify({ validation_code: 'JSON' })],
      ['superseded', 'older', validation],
      ['newer', 'older', JSON.stringify({ validation_code: 'JSON' })],
    ]) {
      await db
        .prepare(
          "INSERT INTO agent_runs(id,user_id,document_id,state,context_json,model,calls,retries) VALUES(?,?,?,'failed',?,'@cf/zai-org/glm-4.7-flash',2,2)",
        )
        .bind(run, 'owner', doc, context)
        .run();
      await db
        .prepare(
          "INSERT INTO agent_steps(id,run_id,user_id,agent,state,started_at,validation_json) VALUES(?,?,'owner','document','failed','2026-10-16',?)",
        )
        .bind(run, run, report)
        .run();
    }
    await db
      .prepare("INSERT INTO ai_usage(user_id,day,analyses,calls) VALUES('owner','2026-10-16',4,10)")
      .run();
    await migration(db, '0005_recover_source_limit_failures.sql');
    expect(
      (await db.prepare("SELECT id FROM agent_runs WHERE state='document'").all()).results,
    ).toEqual([{ id: 'recover' }]);
    expect(
      await db.prepare("SELECT calls,retries FROM agent_runs WHERE id='recover'").first(),
    ).toEqual({ calls: 2, retries: 0 });
    expect(await db.prepare('SELECT analyses,calls FROM ai_usage').first()).toEqual({
      analyses: 4,
      calls: 10,
    });
    const env = {
      DB: db,
      AI: {
        run: async () => ({
          response: JSON.stringify({
            subject_name: null,
            document_type: 'other',
            summary: 'Wynik regresji',
            sections: [
              {
                title: 'Treść',
                kind: 'content',
                sources: Array.from({ length: 35 }, (_, i) => ({ ref_id: `s${i}` })),
              },
            ],
            warnings: [],
          }),
        }),
      },
    } as unknown as Env;
    const result = await advanceRun(env, 'owner', 'recover');
    expect(result.run.state).toBe('deadline');
    const checkpoint = await db
      .prepare("SELECT context_json FROM agent_runs WHERE id='recover'")
      .first<{ context_json: string }>();
    expect(
      JSON.parse(checkpoint!.context_json).documents[0].sections.map(
        (section: { sources: unknown[] }) => section.sources.length,
      ),
    ).toEqual([20, 15]);
    await db.prepare("UPDATE agent_runs SET state='failed' WHERE id='recover'").run();
    await migration(db, '0005_recover_source_limit_failures.sql');
    expect(
      (await db.prepare("SELECT id FROM agent_runs WHERE state='document'").all()).results,
    ).toEqual([]);
    expect(
      await db.prepare("SELECT analyses FROM ai_usage WHERE day='2026-10-16'").first(),
    ).toEqual({ analyses: 4 });
  } finally {
    await runtime.dispose();
  }
}, 30_000);
