const base = process.env.APP_URL;
if (!base || !/^https:\/\/[a-z0-9.-]+\.workers\.dev$/.test(base))
  throw new Error('Expected HTTPS workers.dev APP_URL.');
// A newly registered workers.dev route may briefly return 404 while propagating.
// Retry only readiness; authorization assertions below must pass immediately.
let ready = false;
let lastStatus = 'network error';
for (let attempt = 0; attempt < 12; attempt++) {
  try {
    const response = await fetch(base + '/api/health', {
      signal: AbortSignal.timeout(5_000),
    });
    lastStatus = String(response.status);
    if (response.status === 200 && (await response.json()).service === 'StudentOS') {
      ready = true;
      break;
    }
    if (![404, 502, 503, 504].includes(response.status)) break;
  } catch {
    lastStatus = 'network error or invalid health response';
  }
  if (attempt < 11) await new Promise((resolve) => setTimeout(resolve, 3_000));
}
if (!ready) throw new Error(`Production readiness did not pass: ${lastStatus}`);
for (const [path, status] of [
  ['/', 200],
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
