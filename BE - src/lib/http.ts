/**
 * Shared HTTP client for every retailer adapter.
 *
 * Three things every adapter needs and none should reimplement:
 *   1. An honest User-Agent with a contact address. Several of these APIs
 *      (Open Food Facts especially) require it, and every one of them will
 *      treat you better for it. Anonymous traffic gets rate-limited first.
 *   2. Rate limiting. bol is 10 req/s, eBay is 5,000/day, Open Food Facts is
 *      15 req/min. Breaching these gets you blocked, not warned.
 *   3. Retry with backoff, honouring Retry-After. Transient 429/503 is normal;
 *      treating it as fatal means a nightly job that fails once a week.
 */

const UA =
  process.env.HTTP_USER_AGENT ??
  'Scoopt/0.1 (price comparison; +https://scoopt.nl; contact@scoopt.nl)';

export interface RateLimit {
  /** Minimum milliseconds between the START of consecutive requests. */
  minIntervalMs: number;
}

/** Serialises requests per key so concurrent callers can't burst past a limit. */
const lastCallAt = new Map<string, number>();
const queues = new Map<string, Promise<unknown>>();

async function throttle(key: string, limit: RateLimit): Promise<void> {
  const prev = lastCallAt.get(key) ?? 0;
  const wait = prev + limit.minIntervalMs - Date.now();
  if (wait > 0) await sleep(wait);
  lastCallAt.set(key, Date.now());
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface FetchJsonOptions {
  headers?: Record<string, string>;
  method?: string;
  body?: string;
  /** Key that shares a rate-limit bucket. Usually the retailer slug. */
  rateKey: string;
  rateLimit: RateLimit;
  maxRetries?: number;
  /** Returned verbatim alongside the parsed body, for raw archiving. */
  keepRaw?: boolean;
}

export interface JsonResult<T> {
  data: T;
  raw: string;
  status: number;
}

export async function fetchJson<T = unknown>(
  url: string,
  opts: FetchJsonOptions
): Promise<JsonResult<T>> {
  const maxRetries = opts.maxRetries ?? 4;

  // Chain onto the queue for this bucket so parallel callers stay in line.
  const run = (queues.get(opts.rateKey) ?? Promise.resolve()).then(async () => {
    let lastErr: unknown;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      await throttle(opts.rateKey, opts.rateLimit);

      try {
        const res = await fetch(url, {
          method: opts.method ?? 'GET',
          body: opts.body,
          headers: {
            accept: 'application/json',
            'user-agent': UA,
            ...opts.headers,
          },
        });

        if (res.status === 429 || res.status >= 500) {
          const retryAfter = Number(res.headers.get('retry-after'));
          const backoff = Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : Math.min(30_000, 2 ** attempt * 1000);
          lastErr = new Error(`HTTP ${res.status} from ${hostOf(url)}`);
          if (attempt < maxRetries) {
            console.warn(`  ${res.status} — retrying in ${backoff}ms (attempt ${attempt + 1})`);
            await sleep(backoff);
            continue;
          }
        }

        const raw = await res.text();
        if (!res.ok) {
          throw new Error(`HTTP ${res.status} from ${hostOf(url)}: ${raw.slice(0, 400)}`);
        }

        return { data: JSON.parse(raw) as T, raw, status: res.status };
      } catch (err) {
        lastErr = err;
        // A JSON parse failure or hard network error is worth one more try.
        if (attempt < maxRetries) {
          await sleep(Math.min(30_000, 2 ** attempt * 1000));
          continue;
        }
      }
    }

    throw lastErr ?? new Error(`request failed: ${url}`);
  });

  queues.set(opts.rateKey, run.catch(() => {}));
  return run as Promise<JsonResult<T>>;
}

function hostOf(url: string): string {
  try { return new URL(url).host; } catch { return url; }
}

/** Requires an env var, with an error that says how to fix it. */
export function requireEnv(name: string, hint: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set.\n  → ${hint}`);
  return value;
}
