const base = process.env.APP_URL;
if (!base || !/^https:\/\/[a-z0-9.-]+\.workers\.dev$/.test(base))
  throw new Error('Expected HTTPS workers.dev APP_URL.');
for (const [path, status] of [
  ['/api/health', 200],
  ['/api/bootstrap', 401],
  ['/api/tasks', 401],
]) {
  const response = await fetch(base + path, { signal: AbortSignal.timeout(20_000) });
  if (response.status !== status)
    throw new Error(`Smoke check ${path}: expected ${status}, got ${response.status}`);
}
console.log(`Health and private API protection verified: ${base}`);
console.log(
  'Live OAuth, PDF/Workers AI and device persistence still require an authenticated acceptance test.',
);
