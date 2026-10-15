import { rm } from 'node:fs/promises';
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
