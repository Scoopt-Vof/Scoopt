/**
 * Shared response helpers for every API handler.
 *
 * CORS is NOT set here. contract-server.ts applies it to EVERY response in one
 * place — including 404s, 413s, 429s and 500s. Before, only successful
 * handler responses carried CORS headers, so a browser calling the API
 * directly saw a CORS failure instead of the real error.
 */

export const json = (body: unknown, status = 200, extraHeaders: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...extraHeaders,
    },
  });

export const fail = (status: number, message: string) => json({ error: message }, status);

/** Thrown by handlers for a client error; the server turns it into a JSON 4xx. */
export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/**
 * Reads an optional non-negative integer query parameter.
 * Absent → undefined. Present but not an integer (e.g. "abc") → 400.
 */
export function intParam(params: URLSearchParams, name: string): number | undefined {
  const raw = params.get(name);
  if (raw === null || raw === '') return undefined;
  if (!/^\d+$/.test(raw)) throw new HttpError(400, `${name} must be a non-negative integer`);
  return Number(raw);
}

/** Largest accepted array in a request body — keeps one request from becoming one huge query. */
export const MAX_BASKET_ITEMS = 50;
export const MAX_PERSONALISE_IDS = 200;

export function stringArray(value: unknown, name: string, max: number): string[] {
  if (!Array.isArray(value)) throw new HttpError(400, `${name} must be an array of strings`);
  if (value.length > max) throw new HttpError(400, `${name} may contain at most ${max} entries`);
  if (!value.every((v) => typeof v === 'string' && v.length > 0 && v.length <= 200)) {
    throw new HttpError(400, `${name} must be an array of non-empty strings`);
  }
  return value;
}

/** Parses a JSON body, or throws a 400. */
export async function readJson(req: Request): Promise<Record<string, unknown>> {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'Body must be a JSON object');
  }
  return body as Record<string, unknown>;
}
