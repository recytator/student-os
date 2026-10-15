export interface Env {
  DB: D1Database;
  AI: Ai;
  ASSETS: Fetcher;
  AI_MODEL?: string;
  DEV_AUTH?: string;
  APP_ORIGIN?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  GITHUB_OWNER_ID?: string;
  MAX_ANALYSES_PER_DAY?: string;
}

export interface User {
  id: string;
  github_id: string;
  github_login: string;
  name: string;
  avatar_url: string | null;
  created_at: string;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function readJson(request: Request): Promise<unknown> {
  if (!request.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    throw new HttpError(415, 'CONTENT_TYPE', 'Wymagany format application/json.');
  }
  const maxBytes = 1_500_000;
  const claimed = request.headers.get('content-length');
  if (claimed && Number(claimed) > maxBytes)
    throw new HttpError(413, 'TOO_LARGE', 'Żądanie jest zbyt duże.');
  if (!request.body) throw new HttpError(400, 'INVALID_JSON', 'Brak danych JSON.');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new HttpError(413, 'TOO_LARGE', 'Żądanie jest zbyt duże.');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new HttpError(400, 'INVALID_JSON', 'Nieprawidłowy dokument JSON.');
  }
}

export async function rateLimit(
  env: Env,
  key: string,
  limit: number,
  windowSeconds = 60,
): Promise<void> {
  const windowStart = Math.floor(Date.now() / 1000 / windowSeconds) * windowSeconds;
  const row = await env.DB.prepare(
    `INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1)
    ON CONFLICT(key) DO UPDATE SET count = CASE WHEN rate_limits.window_start = excluded.window_start THEN rate_limits.count + 1 ELSE 1 END,
    window_start = excluded.window_start RETURNING count`,
  )
    .bind(key, windowStart)
    .first<{ count: number }>();
  if (!row || row.count > limit)
    throw new HttpError(429, 'RATE_LIMIT', 'Zbyt wiele żądań. Spróbuj ponownie za chwilę.');
}
