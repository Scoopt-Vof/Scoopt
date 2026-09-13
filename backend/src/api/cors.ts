/**
 * CORS policy for the API.
 *
 * The site's production path is browser → Next.js /api route → this back end,
 * which is server-to-server and needs no CORS at all. CORS only matters when a
 * browser calls the back end directly (local development today). So the
 * default allows the local Next.js dev server and nothing else.
 *
 *   CORS_ORIGINS=https://scoopt.nl,https://www.scoopt.nl   allow these origins
 *   CORS_ORIGINS=*                                          allow any origin
 *
 * It used to be `*` unconditionally.
 */
const DEFAULT_ORIGINS = ['http://localhost:3000'];

function allowedOrigins(): string[] {
  const raw = process.env.CORS_ORIGINS;
  if (!raw) return DEFAULT_ORIGINS;
  return raw.split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean);
}

/** Headers to add to a response for a request from `origin` (null = no Origin header). */
export function corsHeaders(origin: string | null): Record<string, string> {
  const allowed = allowedOrigins();
  const base: Record<string, string> = {
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    vary: 'Origin',
  };
  if (allowed.includes('*')) return { ...base, 'access-control-allow-origin': '*' };
  if (origin && allowed.includes(origin)) return { ...base, 'access-control-allow-origin': origin };
  return base; // no allow-origin header: the browser blocks the cross-origin read
}

export function corsPreflight(origin: string | null): Response {
  // 204 is a null-body status: passing a body here throws a TypeError, which
  // the server would turn into a 500, so every preflight would fail.
  return new Response(null, {
    status: 204,
    headers: { ...corsHeaders(origin), 'access-control-max-age': '86400' },
  });
}
