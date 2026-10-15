import { HttpError, json, rateLimit, type Env, type User } from './types';

const SESSION_COOKIE = 'studentos_session';
const STATE_COOKIE = 'studentos_oauth_state';
const localHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
const isLocal = (request: Request): boolean => localHosts.has(new URL(request.url).hostname);
const isDev = (request: Request, env: Env): boolean => env.DEV_AUTH === 'true' && isLocal(request);

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}
function token(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}
async function hash(value: string): Promise<string> {
  return base64url(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))),
  );
}
function cookie(request: Request, name: string, value: string, age: number): string {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secure}`;
}
function cookieValue(request: Request, name: string): string | null {
  const value = request.headers
    .get('Cookie')
    ?.split(';')
    .map((v) => v.trim())
    .find((v) => v.startsWith(`${name}=`))
    ?.slice(name.length + 1);
  try {
    return value ? decodeURIComponent(value) : null;
  } catch {
    return null;
  }
}
function origin(request: Request, env: Env): string {
  if (!env.APP_ORIGIN)
    throw new HttpError(503, 'AUTH_CONFIGURATION', 'Logowanie wymaga ustawienia APP_ORIGIN.');
  let configured: URL;
  try {
    configured = new URL(env.APP_ORIGIN);
  } catch {
    throw new HttpError(503, 'AUTH_CONFIGURATION', 'Nieprawidłowy APP_ORIGIN.');
  }
  if (
    configured.origin !== new URL(request.url).origin ||
    (!isLocal(request) && configured.protocol !== 'https:')
  ) {
    throw new HttpError(403, 'ORIGIN', 'Nieprawidłowy adres aplikacji.');
  }
  return configured.origin;
}
function requireOAuthConfig(request: Request, env: Env): string {
  if (
    !env.GITHUB_CLIENT_ID ||
    !env.GITHUB_CLIENT_SECRET ||
    !env.GITHUB_OWNER_ID ||
    !/^\d+$/.test(env.GITHUB_OWNER_ID)
  ) {
    throw new HttpError(
      503,
      'AUTH_CONFIGURATION',
      'Logowanie GitHub nie zostało jeszcze skonfigurowane przez właściciela.',
    );
  }
  return origin(request, env);
}

export async function currentUser(request: Request, env: Env): Promise<User | null> {
  if (isDev(request, env)) {
    await env.DB.prepare(
      `INSERT INTO users(id, github_id, github_login, name, avatar_url) VALUES ('local-developer','0','local','Lokalny użytkownik','') ON CONFLICT(id) DO NOTHING`,
    ).run();
    return env.DB.prepare('SELECT * FROM users WHERE id = ?').bind('local-developer').first<User>();
  }
  // A removed owner allowlist invalidates all previously issued sessions immediately.
  if (!env.GITHUB_OWNER_ID || !/^\d+$/.test(env.GITHUB_OWNER_ID)) return null;
  const session = cookieValue(request, SESSION_COOKIE);
  if (!session || session.length > 100) return null;
  return env.DB.prepare(
    `SELECT users.* FROM users JOIN sessions ON sessions.user_id = users.id
    WHERE sessions.id = ? AND sessions.expires_at > ? AND users.github_id = ?`,
  )
    .bind(await hash(session), Math.floor(Date.now() / 1000), env.GITHUB_OWNER_ID)
    .first<User>();
}

export function checkCsrf(request: Request, env: Env): void {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return;
  // Wrangler keeps its own :8787 URL behind Vite. This exception exists only in
  // explicit loopback development mode; production always requires exact origin.
  if (isDev(request, env)) {
    const source = request.headers.get('Origin');
    if (
      source === new URL(request.url).origin ||
      ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://[::1]:5173'].includes(source || '')
    )
      return;
  }
  const expected = env.APP_ORIGIN ? new URL(env.APP_ORIGIN).origin : new URL(request.url).origin;
  if (request.headers.get('Origin') !== expected || new URL(request.url).origin !== expected) {
    throw new HttpError(403, 'CSRF', 'Nieprawidłowe źródło żądania. Odśwież aplikację.');
  }
}

export async function handleAuth(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/auth/')) return null;
  if (url.pathname === '/api/auth/me' && request.method === 'GET') {
    const user = await currentUser(request, env);
    if (!user)
      throw new HttpError(401, 'UNAUTHENTICATED', 'Zaloguj się, aby korzystać z StudentOS.');
    return json({ user, development: isDev(request, env) });
  }
  if (url.pathname === '/api/auth/logout' && request.method === 'POST') {
    checkCsrf(request, env);
    const session = cookieValue(request, SESSION_COOKIE);
    if (session)
      await env.DB.prepare('DELETE FROM sessions WHERE id = ?')
        .bind(await hash(session))
        .run();
    return new Response(JSON.stringify({ ok: true }), {
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': cookie(request, SESSION_COOKIE, '', 0),
        'Cache-Control': 'no-store',
      },
    });
  }
  if (url.pathname === '/api/auth/login' && request.method === 'GET') {
    const appOrigin = requireOAuthConfig(request, env);
    await rateLimit(env, `auth:${request.headers.get('CF-Connecting-IP') || 'local'}`, 10);
    const state = token();
    const verifier = token();
    await env.DB.batch([
      env.DB.prepare('DELETE FROM oauth_states WHERE expires_at < ?').bind(
        Math.floor(Date.now() / 1000),
      ),
      env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(
        Math.floor(Date.now() / 1000),
      ),
      env.DB.prepare('INSERT INTO oauth_states(id, verifier, expires_at) VALUES (?, ?, ?)').bind(
        await hash(state),
        await hash(verifier),
        Math.floor(Date.now() / 1000) + 600,
      ),
    ]);
    const redirect = new URL('https://github.com/login/oauth/authorize');
    redirect.search = new URLSearchParams({
      client_id: env.GITHUB_CLIENT_ID!,
      redirect_uri: `${appOrigin}/api/auth/callback`,
      state,
      code_challenge: await hash(verifier),
      code_challenge_method: 'S256',
      scope: 'read:user',
    }).toString();
    return new Response(null, {
      status: 302,
      headers: {
        Location: redirect.toString(),
        'Set-Cookie': cookie(request, STATE_COOKIE, `${state}.${verifier}`, 600),
        'Cache-Control': 'no-store',
      },
    });
  }
  if (url.pathname === '/api/auth/callback' && request.method === 'GET') {
    const appOrigin = requireOAuthConfig(request, env);
    const state = url.searchParams.get('state');
    const code = url.searchParams.get('code');
    const [cookieState, verifier] = (cookieValue(request, STATE_COOKIE) || '').split('.');
    if (
      !state ||
      state.length > 100 ||
      state !== cookieState ||
      !verifier ||
      verifier.length !== 43 ||
      !code ||
      code.length > 200
    )
      throw new HttpError(400, 'OAUTH_STATE', 'Nieprawidłowa lub wygasła sesja logowania.');
    const saved = await env.DB.prepare(
      'DELETE FROM oauth_states WHERE id = ? AND expires_at > ? RETURNING verifier',
    )
      .bind(await hash(state), Math.floor(Date.now() / 1000))
      .first<{ verifier: string }>();
    if (!saved || saved.verifier !== (await hash(verifier)))
      throw new HttpError(400, 'OAUTH_STATE', 'Sesja logowania wygasła. Rozpocznij ponownie.');
    const exchange = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: env.GITHUB_CLIENT_ID,
        client_secret: env.GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: `${appOrigin}/api/auth/callback`,
        code_verifier: verifier,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const credentials = (await exchange.json()) as { access_token?: string };
    if (!exchange.ok || !credentials.access_token)
      throw new HttpError(
        502,
        'OAUTH_EXCHANGE',
        'GitHub nie potwierdził logowania. Spróbuj ponownie.',
      );
    const profileResponse = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${credentials.access_token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'StudentOS',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: AbortSignal.timeout(15_000),
    });
    const profile = (await profileResponse.json()) as {
      id?: number;
      login?: string;
      name?: string;
      avatar_url?: string;
    };
    if (!profileResponse.ok || !profile.id || !profile.login)
      throw new HttpError(502, 'OAUTH_PROFILE', 'Nie można zweryfikować konta GitHub.');
    if (String(profile.id) !== env.GITHUB_OWNER_ID)
      throw new HttpError(
        403,
        'OWNER_ONLY',
        'To prywatna instancja StudentOS. Konto nie ma dostępu.',
      );
    const id = `github:${profile.id}`;
    await env.DB.prepare(
      `INSERT INTO users(id,github_id,github_login,name,avatar_url) VALUES(?,?,?,?,?) ON CONFLICT(github_id) DO UPDATE SET github_login=excluded.github_login,name=excluded.name,avatar_url=excluded.avatar_url`,
    )
      .bind(
        id,
        String(profile.id),
        profile.login,
        profile.name || profile.login,
        profile.avatar_url || '',
      )
      .run();
    const user = await env.DB.prepare('SELECT id FROM users WHERE github_id=?')
      .bind(String(profile.id))
      .first<{ id: string }>();
    if (!user) throw new HttpError(500, 'SESSION', 'Nie można utworzyć sesji.');
    const session = token();
    await env.DB.prepare('INSERT INTO sessions(id,user_id,expires_at) VALUES(?,?,?)')
      .bind(await hash(session), user.id, Math.floor(Date.now() / 1000) + 7 * 86400)
      .run();
    const headers = new Headers({ Location: appOrigin, 'Cache-Control': 'no-store' });
    headers.append('Set-Cookie', cookie(request, SESSION_COOKIE, session, 7 * 86400));
    headers.append('Set-Cookie', cookie(request, STATE_COOKIE, '', 0));
    return new Response(null, { status: 302, headers });
  }
  throw new HttpError(404, 'NOT_FOUND', 'Nie znaleziono endpointu logowania.');
}
