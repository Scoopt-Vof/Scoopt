import { fetchJson, type RateLimit } from './http';

/**
 * OAuth2 client-credentials token cache.
 *
 * Written once here because eBay, Kroger and (later) bol.com all use the exact
 * same grant, and because caching is a REQUIREMENT rather than an optimisation:
 * bol's tokens live 299 seconds and they monitor callers who re-mint on every
 * request. eBay's live 7,200. Kroger's 1,800. Getting a fresh token per call is
 * the fastest way to get your credentials suspended.
 *
 * The 60-second safety margin exists because a token that expires mid-flight
 * produces a 401 that looks like a credentials bug and wastes an afternoon.
 */

interface CachedToken {
  accessToken: string;
  expiresAt: number; // epoch ms
}

const cache = new Map<string, CachedToken>();

export interface ClientCredentialsConfig {
  /** Cache key — use the retailer slug. */
  key: string;
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  /** Sent as the `scope` form field. Omit where the API doesn't use scopes. */
  scope?: string;
  rateLimit: RateLimit;
}

export async function getAccessToken(cfg: ClientCredentialsConfig): Promise<string> {
  const hit = cache.get(cfg.key);
  if (hit && hit.expiresAt > Date.now()) return hit.accessToken;

  const basic = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64');
  const form = new URLSearchParams({ grant_type: 'client_credentials' });
  if (cfg.scope) form.set('scope', cfg.scope);

  const { data } = await fetchJson<{ access_token: string; expires_in: number }>(
    cfg.tokenUrl,
    {
      method: 'POST',
      body: form.toString(),
      headers: {
        authorization: `Basic ${basic}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      rateKey: `${cfg.key}:token`,
      rateLimit: cfg.rateLimit,
    }
  );

  if (!data.access_token) throw new Error(`${cfg.key}: token response had no access_token`);

  const ttlMs = (Number(data.expires_in) || 300) * 1000;
  cache.set(cfg.key, {
    accessToken: data.access_token,
    expiresAt: Date.now() + Math.max(0, ttlMs - 60_000), // 60s safety margin
  });

  return data.access_token;
}

/** Test helper — forget everything, so a test can assert a re-mint happens. */
export function clearTokenCache(): void {
  cache.clear();
}
