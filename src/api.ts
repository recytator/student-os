export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

type ErrorBody = { error?: { message?: string; code?: string; details?: unknown } } | null;

const failure = (status: number, data: ErrorBody) =>
  new ApiError(
    status,
    data?.error?.code ?? 'HTTP_ERROR',
    data?.error?.message ?? `Błąd serwera (${status}).`,
    data?.error?.details,
  );

export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    ...options,
    headers: {
      ...(options?.body ? { 'Content-Type': 'application/json' } : {}),
      ...options?.headers,
    },
  });
  const data = (await response.json().catch(() => null)) as ErrorBody;
  if (!response.ok) throw failure(response.status, data);
  return data as T;
}

/** POST that may answer with server-sent events (heartbeats, then one result event). */
export async function apiStream<T>(path: string): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { Accept: 'text/event-stream, application/json' },
  });
  const text = await response.text();
  if (!response.headers.get('content-type')?.includes('text/event-stream')) {
    let data: ErrorBody = null;
    try {
      data = JSON.parse(text) as ErrorBody;
    } catch {
      // Not JSON: reported as a plain HTTP error below.
    }
    if (!response.ok) throw failure(response.status, data);
    return data as T;
  }
  const events = text.split(/\n\n/).filter((block) => /^(event|data):/m.test(block));
  const last = events.at(-1);
  if (!last) throw new TypeError('Połączenie zostało przerwane przed odpowiedzią serwera.');
  const data = JSON.parse(
    last
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n'),
  ) as T & ErrorBody;
  if (/^event: error$/m.test(last)) throw failure(500, data);
  return data;
}

export const json = (value: unknown): string => JSON.stringify(value);
