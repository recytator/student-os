import { readFile, writeFile } from 'node:fs/promises';
import { parse } from 'jsonc-parser';

// This script never prints credentials. A configured Free account is required;
// it never changes plans, activates billing, purchases a domain or AI credits.
const required = ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'GITHUB_OWNER_ID'];
for (const name of required) {
  if (!process.env[name]) throw new Error(`Missing secure environment configuration: ${name}`);
}
if (process.env.FREE_PLAN_CONFIRMED !== 'true') {
  throw new Error('Confirm the account is on Workers Free. Paid billing is not authorized.');
}
if (!/^\d+$/.test(process.env.GITHUB_OWNER_ID))
  throw new Error('GITHUB_OWNER_ID must be a numeric GitHub user id.');
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!/^[a-f0-9]{32}$/i.test(account)) throw new Error('Invalid Cloudflare account ID.');
const base = `https://api.cloudflare.com/client/v4/accounts/${account}`;
async function cf(path, method = 'GET', body) {
  const response = await fetch(base + path, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30_000),
  });
  const data = await response.json();
  if (!response.ok || !data.success)
    throw new Error(
      `Cloudflare ${method} ${path} failed (${response.status}). Check token permissions in the dashboard.`,
    );
  return data.result;
}
const subdomain = await cf('/workers/subdomain');
if (!subdomain?.subdomain || !/^[a-z0-9-]+$/i.test(subdomain.subdomain)) {
  throw new Error('Enable a free workers.dev subdomain in Cloudflare Workers & Pages first.');
}
const databases = await cf('/d1/database?name=studentos');
const matches = databases.filter((database) => database.name === 'studentos');
if (matches.length > 1)
  throw new Error('Multiple studentos databases exist; choose one explicitly before deployment.');
const db =
  matches[0] ||
  (await cf('/d1/database', 'POST', { name: 'studentos', primary_location_hint: 'weur' }));
const configErrors = [];
const original = parse(await readFile('wrangler.jsonc', 'utf8'), configErrors, {
  allowTrailingComma: true,
});
if (configErrors.length || !original?.d1_databases?.[0])
  throw new Error('Invalid Wrangler source configuration.');
if (!/^[a-f0-9-]{36}$/i.test(db.uuid || ''))
  throw new Error('Cloudflare returned an invalid D1 identifier.');
original.d1_databases[0].database_id = db.uuid;
original.vars = {
  ...original.vars,
  DEV_AUTH: 'false',
  GITHUB_OWNER_ID: process.env.GITHUB_OWNER_ID,
  APP_ORIGIN: `https://${original.name}.${subdomain.subdomain}.workers.dev`,
};
// Root-relative generated config keeps source, migrations and assets paths correct.
await writeFile('wrangler.production.json', JSON.stringify(original, null, 2));
if (process.env.GITHUB_OUTPUT) {
  await writeFile(process.env.GITHUB_OUTPUT, `app_url=${original.vars.APP_ORIGIN}\n`, {
    flag: 'a',
  });
}
console.log(`Prepared Free deployment: ${original.vars.APP_ORIGIN}`);
console.log(
  'Production DEV_AUTH=false; all private endpoints require the configured GitHub owner.',
);
