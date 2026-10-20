import { ZodError } from 'zod';
import { currentUser, handleAuth, checkCsrf } from './auth';
import { handleApi } from './api';
import { handleOrchestrator } from './orchestrator';
import { handleNotes } from './notes';
import { HttpError, json, rateLimit, type Env } from './types';

function secure(response: Response, request: Request): Response {
  const headers = new Headers(response.headers);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  headers.set(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://avatars.githubusercontent.com; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  );
  if (new URL(request.url).protocol === 'https:')
    headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  if (
    new URL(request.url).pathname.startsWith('/api/') &&
    !headers.get('Cache-Control')?.includes('no-store')
  )
    headers.set('Cache-Control', 'no-store');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (!url.pathname.startsWith('/api/'))
        return secure(await env.ASSETS.fetch(request), request);
      if (url.pathname === '/api/health' && request.method === 'GET')
        return secure(json({ ok: true, service: 'StudentOS' }), request);
      const auth = await handleAuth(request, env);
      if (auth) return secure(auth, request);
      const user = await currentUser(request, env);
      if (!user)
        throw new HttpError(401, 'UNAUTHENTICATED', 'Zaloguj się, aby korzystać z StudentOS.');
      checkCsrf(request, env);
      await rateLimit(
        env,
        `api:${request.method === 'GET' ? 'read' : 'write'}:${user.id}`,
        request.method === 'GET' ? 180 : 60,
      );
      const response =
        (await handleApi(request, env, user)) ??
        (await handleNotes(request, env, user, ctx)) ??
        (await handleOrchestrator(request, env, user));
      if (!response) throw new HttpError(404, 'NOT_FOUND', 'Nie znaleziono endpointu.');
      return secure(response, request);
    } catch (error) {
      if (error instanceof ZodError)
        return secure(
          json(
            {
              error: {
                code: 'VALIDATION',
                message: 'Nieprawidłowe dane.',
                details: error.issues.map((issue) => ({
                  path: issue.path,
                  message: issue.message,
                })),
              },
            },
            400,
          ),
          request,
        );
      if (error instanceof HttpError)
        return secure(
          json(
            {
              error: {
                code: error.code,
                message: error.message,
                ...(error.details === undefined ? {} : { details: error.details }),
              },
            },
            error.status,
          ),
          request,
        );
      // Operational metadata only: no tokens, raw PDF contents, or model reasoning.
      console.error(
        JSON.stringify({
          event: 'request_failed',
          path: url.pathname,
          method: request.method,
          type: error instanceof Error ? error.name : 'unknown',
        }),
      );
      return secure(
        json(
          {
            error: {
              code: 'INTERNAL_ERROR',
              message:
                'Nie udało się wykonać operacji. Twoje zapisane dane są bezpieczne. Spróbuj ponownie.',
            },
          },
          500,
        ),
        request,
      );
    }
  },
} satisfies ExportedHandler<Env>;
