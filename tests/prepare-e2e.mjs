import { rm, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

// This directory is reserved for E2E; never reset the normal development D1.
await rm(new URL('../.wrangler/e2e/', import.meta.url), { recursive: true, force: true });
execFileSync(
  'npx',
  [
    'wrangler',
    'd1',
    'migrations',
    'apply',
    'studentos',
    '--local',
    '--persist-to',
    '.wrangler/e2e',
  ],
  { stdio: 'inherit' },
);

// Import the real transcription into this disposable local database only.
const semester = await readFile(
  new URL('../migrations/0004_semester_timetable.sql', import.meta.url),
  'utf8',
);
const sql =
  "INSERT OR IGNORE INTO users(id,github_id) VALUES('local-developer','0');\n" +
  semester
    .slice(semester.indexOf('-- Import only'))
    .replaceAll("github_id='166433083'", "github_id='0'");
await writeFile(new URL('../.wrangler/e2e/semester.sql', import.meta.url), sql);
execFileSync(
  'npx',
  [
    'wrangler',
    'd1',
    'execute',
    'studentos',
    '--local',
    '--persist-to',
    '.wrangler/e2e',
    '--file',
    '.wrangler/e2e/semester.sql',
  ],
  { stdio: 'inherit' },
);
