import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
const id = process.env.GITHUB_CLIENT_ID?.trim();
const secret = process.env.GITHUB_CLIENT_SECRET?.trim();
if (!id || !secret) {
  console.log(
    'OAuth not configured yet: private API remains locked. Add STUDENTOS_GITHUB_CLIENT_ID and STUDENTOS_GITHUB_CLIENT_SECRET to GitHub Actions Secrets, then redeploy.',
  );
  process.exit(0);
}
const result = spawnSync(
  'npx',
  ['wrangler', 'secret', 'bulk', '--config', 'wrangler.production.json'],
  {
    input: JSON.stringify({ GITHUB_CLIENT_ID: id, GITHUB_CLIENT_SECRET: secret }),
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  },
);
if (result.status !== 0) {
  // Do not relay CLI output which may contain submitted secret material.
  console.error('Secure OAuth configuration failed. Check Cloudflare token permissions.');
  process.exit(1);
}
console.log('OAuth secrets configured securely.');
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, 'oauth_configured=true\n');
