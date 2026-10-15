import { readFile, readdir } from 'node:fs/promises';
import { Miniflare } from 'miniflare';

export async function localDatabase(name: string): Promise<{ runtime: Miniflare; db: D1Database }> {
  const runtime = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("test"); } }',
    d1Databases: { DB: name },
    compatibilityDate: '2026-08-06',
  });
  const db = (await runtime.getD1Database('DB')) as unknown as D1Database;
  const directory = new URL('../../migrations/', import.meta.url);
  const files = (await readdir(directory)).filter((file) => file.endsWith('.sql')).sort();
  const migration = (
    await Promise.all(files.map((file) => readFile(new URL(file, directory), 'utf8')))
  ).join('\n');
  // Preserve full CREATE TRIGGER bodies, including their CASE ... END statements.
  const statements = migration.split(/;\s*(?:\n|$)/);
  let pending = '';
  for (const statement of statements) {
    pending += statement + ';\n';
    if (/CREATE TRIGGER/i.test(pending) && !/(?:^|\n)END;\s*$/.test(pending)) continue;
    if (pending.replace(/--[^\n]*/g, '').trim() !== ';') await db.prepare(pending).run();
    pending = '';
  }
  return { runtime, db };
}
