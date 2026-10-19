import { readFile, readdir } from 'node:fs/promises';
import { Miniflare } from 'miniflare';
import { unstable_splitSqlQuery } from 'wrangler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let runtime: Miniflare;
let db: D1Database;

beforeAll(async () => {
  runtime = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("test"); } }',
    d1Databases: { DB: 'qa-wrangler-migration-splitting' },
    compatibilityDate: '2026-08-06',
  });
  db = (await runtime.getD1Database('DB')) as unknown as D1Database;
  await db
    .prepare(
      'CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT UNIQUE,applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)',
    )
    .run();
  const directory = new URL('../../migrations/', import.meta.url);
  for (const file of (await readdir(directory)).filter((file) => file.endsWith('.sql')).sort()) {
    // This is Wrangler's actual migration payload and installed local splitter,
    // including the migration marker appended after the file's final END.
    const raw = `${await readFile(new URL(file, directory), 'utf8')}\nINSERT INTO d1_migrations(name) VALUES('${file}');`;
    await db.batch(unstable_splitSqlQuery(raw).map((statement) => db.prepare(statement)));
  }
  await db.prepare("INSERT INTO users(id,github_id) VALUES('alice','1'),('bob','2')").run();
  await db
    .prepare("INSERT INTO subjects(id,user_id,name) VALUES('sa','alice','A'),('sb','bob','B')")
    .run();
  for (const [user, subject, document, task, run, hash] of [
    ['alice', 'sa', 'da', 'ta', 'ra', 'a'],
    ['bob', 'sb', 'db', 'tb', 'rb', 'b'],
  ]) {
    await db
      .prepare(
        'INSERT INTO documents(id,user_id,subject_id,name,hash,academic_year,page_count,text_length) VALUES(?,?,?,?,?,?,?,?)',
      )
      .bind(document, user, subject, 'Fixture', hash!.repeat(64), '2026/2027', 1, 100)
      .run();
    await db
      .prepare('INSERT INTO tasks(id,user_id,subject_id,document_id,title) VALUES(?,?,?,?,?)')
      .bind(task, user, subject, document, 'Fixture')
      .run();
    await db
      .prepare('INSERT INTO agent_runs(id,user_id,document_id,model) VALUES(?,?,?,?)')
      .bind(run, user, document, 'test-model')
      .run();
  }
  await db
    .prepare(
      "INSERT INTO calendar_events(id,user_id,subject_id,document_id,task_id,title,start_at,end_at) VALUES('event','alice','sa','da','ta','Fixture','2026-11-01T10:00:00Z','2026-11-01T11:00:00Z')",
    )
    .run();
  await db
    .prepare(
      "INSERT INTO class_schedules(id,user_id,subject_id,weekday,start_time,end_time,valid_from,valid_to) VALUES('schedule','alice','sa',1,'10:00','11:00','2026-10-01','2027-01-31')",
    )
    .run();
  await db
    .prepare(
      "INSERT INTO subtasks(id,user_id,task_id,title) VALUES('subtask','alice','ta','Fixture')",
    )
    .run();
}, 30_000);
afterAll(async () => {
  await runtime?.dispose();
});

const ownershipChecks = [
  [
    'task insert subject',
    "INSERT INTO tasks(id,user_id,subject_id,title) VALUES('bad','alice','sb','Bad')",
  ],
  [
    'task insert document',
    "INSERT INTO tasks(id,user_id,document_id,title) VALUES('bad','alice','db','Bad')",
  ],
  ['task update subject', "UPDATE tasks SET subject_id='sb' WHERE id='ta'"],
  ['task update document', "UPDATE tasks SET document_id='db' WHERE id='ta'"],
  [
    'event insert subject',
    "INSERT INTO calendar_events(id,user_id,subject_id,title,start_at,end_at) VALUES('bad','alice','sb','Bad','2026-11-01T10:00:00Z','2026-11-01T11:00:00Z')",
  ],
  [
    'event insert document',
    "INSERT INTO calendar_events(id,user_id,document_id,title,start_at,end_at) VALUES('bad','alice','db','Bad','2026-11-01T10:00:00Z','2026-11-01T11:00:00Z')",
  ],
  ['event update subject', "UPDATE calendar_events SET subject_id='sb' WHERE id='event'"],
  ['event update document', "UPDATE calendar_events SET document_id='db' WHERE id='event'"],
  [
    'schedule insert subject',
    "INSERT INTO class_schedules(id,user_id,subject_id,weekday,start_time,end_time,valid_from,valid_to) VALUES('bad','alice','sb',1,'10:00','11:00','2026-10-01','2027-01-31')",
  ],
  ['schedule update subject', "UPDATE class_schedules SET subject_id='sb' WHERE id='schedule'"],
  [
    'document insert subject',
    `INSERT INTO documents(id,user_id,subject_id,name,hash,academic_year,page_count,text_length) VALUES('bad','alice','sb','Bad','${'c'.repeat(64)}','2026/2027',1,100)`,
  ],
  ['document update subject', "UPDATE documents SET subject_id='sb' WHERE id='da'"],
  [
    'subtask insert task',
    "INSERT INTO subtasks(id,user_id,task_id,title) VALUES('bad','alice','tb','Bad')",
  ],
  ['subtask update task', "UPDATE subtasks SET task_id='tb' WHERE id='subtask'"],
  [
    'section insert document',
    "INSERT INTO document_sections(id,user_id,document_id,page,text) VALUES('bad','alice','db',1,'Bad')",
  ],
  [
    'run insert document',
    "INSERT INTO agent_runs(id,user_id,document_id,model) VALUES('bad','alice','db','test-model')",
  ],
  [
    'step insert run',
    "INSERT INTO agent_steps(id,user_id,run_id,agent,state,started_at) VALUES('bad','alice','rb','document','completed','2026-10-01')",
  ],
  [
    'result insert run',
    "INSERT INTO analysis_results(id,user_id,run_id,document_id) VALUES('bad','alice','rb','db')",
  ],
  [
    'linked event insert task',
    "INSERT INTO calendar_events(id,user_id,task_id,title,start_at,end_at) VALUES('bad','alice','tb','Bad','2026-11-01T10:00:00Z','2026-11-01T11:00:00Z')",
  ],
  ['linked event update task', "UPDATE calendar_events SET task_id='tb' WHERE id='event'"],
];

describe('Wrangler SQL splitter + D1 — semantyka triggerów po poprawce transportu', () => {
  it.each(ownershipChecks)('blokuje cudzą relację: %s', async (_name, sql) => {
    await expect(db.prepare(sql!).run()).rejects.toThrow('ownership');
  });
  it('zachowuje poprawne dane i znaczniki wszystkich migracji', async () => {
    expect(
      await db.prepare("SELECT subject_id,document_id FROM tasks WHERE id='ta'").first(),
    ).toEqual({ subject_id: 'sa', document_id: 'da' });
    expect(
      await db.prepare("SELECT task_id FROM calendar_events WHERE id='event'").first(),
    ).toEqual({ task_id: 'ta' });
    expect((await db.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
    expect(
      (await db.prepare('SELECT name FROM d1_migrations ORDER BY name').all()).results,
    ).toEqual([
      { name: '0001_initial.sql' },
      { name: '0002_one_active_run.sql' },
      { name: '0003_task_calendar_links.sql' },
      { name: '0004_semester_timetable.sql' },
      { name: '0005_recover_source_limit_failures.sql' },
      { name: '0006_recover_deadline_source_failures.sql' },
      { name: '0007_plan_tasks_notes.sql' },
    ]);
  });
});
