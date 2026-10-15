import { describe, expect, it, vi } from 'vitest';
import { checkCsrf, currentUser, handleAuth } from '../../worker/auth';
import { readJson, type Env } from '../../worker/types';

function environment(values: Partial<Env> = {}): Env {
  return { ...values } as Env;
}

describe('autoryzacja i granice żądań', () => {
  it('odrzuca mutacje bez Origin i z obcej domeny', () => {
    const env = environment({ APP_ORIGIN: 'https://studentos.example' });
    for (const origin of [undefined, 'https://evil.example', 'null']) {
      const request = new Request('https://studentos.example/api/tasks', {
        method: 'POST',
        headers: origin ? { Origin: origin } : undefined,
      });
      expect(() => checkCsrf(request, env)).toThrow('Nieprawidłowe źródło');
    }
    expect(() =>
      checkCsrf(
        new Request('https://studentos.example/api/tasks', {
          method: 'POST',
          headers: { Origin: 'https://studentos.example' },
        }),
        env,
      ),
    ).not.toThrow();
  });
  it('wyjątek proxy Vite działa tylko dla jawnego lokalnego DEV_AUTH', () => {
    const proxied = new Request('http://localhost:8787/api/tasks', {
      method: 'POST',
      headers: { Origin: 'http://localhost:5173' },
    });
    expect(() => checkCsrf(proxied, environment({ DEV_AUTH: 'true' }))).not.toThrow();
    expect(() => checkCsrf(proxied, environment({ DEV_AUTH: 'false' }))).toThrow();
    expect(() =>
      checkCsrf(
        new Request('https://studentos.example/api/tasks', {
          method: 'POST',
          headers: { Origin: 'http://localhost:5173' },
        }),
        environment({ DEV_AUTH: 'true' }),
      ),
    ).toThrow();
    expect(() =>
      checkCsrf(
        new Request('http://localhost:8787/api/tasks', {
          method: 'POST',
          headers: { Origin: 'https://evil.example' },
        }),
        environment({ DEV_AUTH: 'true' }),
      ),
    ).toThrow();
    expect(() =>
      checkCsrf(
        new Request('http://localhost:8787/api/tasks', {
          method: 'POST',
          headers: { Origin: 'http://localhost.evil.example:5173' },
        }),
        environment({ DEV_AUTH: 'true' }),
      ),
    ).toThrow();
  });
  it('DEV_AUTH nie daje dostępu na zdalnym hoście; brak allowlisty unieważnia sesję', async () => {
    const request = new Request('https://studentos.example/api/bootstrap', {
      headers: { Cookie: 'studentos_session=untrusted' },
    });
    expect(await currentUser(request, environment({ DEV_AUTH: 'true' }))).toBeNull();
    expect(await currentUser(request, environment({ GITHUB_OWNER_ID: 'username' }))).toBeNull();
    expect(
      await currentUser(new Request('http://localhost:8787/api/bootstrap'), environment()),
    ).toBeNull();
  });
  it('lokalny tryb jest jawny i zapisuje rzeczywistego użytkownika przez DB', async () => {
    const run = vi.fn().mockResolvedValue({ success: true });
    const first = vi.fn().mockResolvedValue({ id: 'local-developer' });
    const statement = { run, first, bind: vi.fn().mockReturnThis() };
    const prepare = vi.fn().mockReturnValue(statement);
    const result = await currentUser(
      new Request('http://127.0.0.1:8787/api/auth/me'),
      environment({ DEV_AUTH: 'true', DB: { prepare } as unknown as D1Database }),
    );
    expect(result?.id).toBe('local-developer');
    expect(run).toHaveBeenCalledOnce();
    expect(prepare.mock.calls[0]?.[0]).not.toContain('NULL');
  });
  it('nie rozpoczyna OAuth bez pełnej konfiguracji', async () => {
    await expect(
      handleAuth(new Request('https://studentos.example/api/auth/login'), environment()),
    ).rejects.toThrow('nie zostało jeszcze skonfigurowane');
  });
  it('OAuth wysyła PKCE S256, cookie HttpOnly Secure i przechowuje tylko hashe', async () => {
    const bindings: unknown[][] = [];
    const statement = {
      bind: (...args: unknown[]) => {
        bindings.push(args);
        return statement;
      },
      first: vi.fn().mockResolvedValue({ count: 1 }),
    };
    const env = environment({
      APP_ORIGIN: 'https://studentos.example',
      GITHUB_CLIENT_ID: 'public-client-id',
      GITHUB_CLIENT_SECRET: 'test-only-secret',
      GITHUB_OWNER_ID: '123',
      DB: {
        prepare: vi.fn().mockReturnValue(statement),
        batch: vi.fn().mockResolvedValue([]),
      } as unknown as D1Database,
    });
    const response = await handleAuth(new Request('https://studentos.example/api/auth/login'), env);
    expect(response?.status).toBe(302);
    const redirect = new URL(response!.headers.get('Location')!);
    expect(redirect.origin).toBe('https://github.com');
    expect(redirect.searchParams.get('code_challenge_method')).toBe('S256');
    expect(redirect.searchParams.get('scope')).toBe('read:user');
    expect(redirect.searchParams.has('client_secret')).toBe(false);
    const cookie = response!.headers.get('Set-Cookie')!;
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Lax');
    const [state, verifier] = decodeURIComponent(cookie.split(';')[0]!.split('=')[1]!).split('.');
    expect(state).toBe(redirect.searchParams.get('state'));
    expect(verifier).toHaveLength(43);
    const persisted = bindings.at(-1)!;
    expect(persisted[0]).not.toBe(state);
    expect(persisted[1]).not.toBe(verifier);
    expect(persisted[1]).toBe(redirect.searchParams.get('code_challenge'));
  });
  it('blokuje callback z obcego kontekstu przeglądarki przed dotknięciem DB', async () => {
    const env = environment({
      APP_ORIGIN: 'https://studentos.example',
      GITHUB_CLIENT_ID: 'client',
      GITHUB_CLIENT_SECRET: 'test-secret',
      GITHUB_OWNER_ID: '123',
    });
    await expect(
      handleAuth(
        new Request('https://studentos.example/api/auth/callback?state=attacker&code=code'),
        env,
      ),
    ).rejects.toThrow('sesja logowania');
  });
  it('odrzuca błędny JSON i zbyt duży stream bez ufania Content-Length', async () => {
    await expect(
      readJson(
        new Request('http://localhost', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{',
        }),
      ),
    ).rejects.toThrow('Nieprawidłowy dokument JSON');
    await expect(
      readJson(
        new Request('http://localhost', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: 'a'.repeat(1_500_001) }),
        }),
      ),
    ).rejects.toThrow('zbyt duże');
  });
});
