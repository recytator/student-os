import { appendFile } from 'node:fs/promises';

// Run inside GitHub Actions: inspect availability without exposing secret values.
// This check creates no resources, changes no billing plan and invokes no model.
const configured = {
  cloudflare_token: Boolean(process.env.CLOUDFLARE_API_TOKEN),
  cloudflare_account: Boolean(process.env.CLOUDFLARE_ACCOUNT_ID),
  github_oauth_client: Boolean(process.env.GITHUB_CLIENT_ID),
  github_oauth_secret: Boolean(process.env.GITHUB_CLIENT_SECRET),
  owner: /^\d+$/.test(process.env.GITHUB_OWNER_ID || ''),
};
const report = { status: 'blocked', configured, cloudflare_access: 'not_checked', app_url: null };
if (configured.cloudflare_token && configured.cloudflare_account) {
  if (!/^[a-f0-9]{32}$/i.test(process.env.CLOUDFLARE_ACCOUNT_ID)) {
    report.cloudflare_access = 'invalid_account_id';
  } else {
    try {
      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/workers/subdomain`,
        {
          headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` },
          signal: AbortSignal.timeout(20_000),
        },
      );
      const data = await response.json();
      if (response.ok && data.success && /^[a-z0-9-]+$/i.test(data.result?.subdomain || '')) {
        report.cloudflare_access = 'verified';
        report.app_url = `https://studentos.${data.result.subdomain}.workers.dev`;
        report.status = configured.owner ? 'ready_for_initial_deployment' : 'owner_missing';
      } else {
        report.cloudflare_access = `http_${response.status}`;
      }
    } catch {
      report.cloudflare_access = 'request_failed';
    }
  }
}
console.log('STUDENTOS_DEPLOYMENT_READINESS=' + JSON.stringify(report));
if (process.env.GITHUB_STEP_SUMMARY) {
  await appendFile(
    process.env.GITHUB_STEP_SUMMARY,
    [
      '# StudentOS — gotowość wdrożenia',
      '',
      `Status: **${report.status}**. Sprawdzono tylko obecność konfiguracji i ewentualnie odczyt subdomeny Cloudflare.`,
      '',
      '| Konfiguracja | Obecna |',
      '| --- | --- |',
      ...Object.entries(configured).map(
        ([name, present]) => `| ${name} | ${present ? 'tak' : 'nie'} |`,
      ),
      '',
      'Żadna wartość sekretu nie jest wyświetlana. Gotowość nie oznacza wdrożenia ani potwierdzenia planu Free.',
      '',
    ].join('\n'),
  );
}
