import { describe, it, expect, afterEach } from 'vitest';
import { corsHeaders, corsPreflight } from '../src/api/cors';

/**
 * 204 is a null-body status: building a Response with a body and status 204
 * throws a TypeError, which the server turns into a 500. That makes every
 * cross-origin POST fail at the preflight, so it is worth its own test.
 */
describe('CORS', () => {
  const original = process.env.CORS_ORIGINS;
  afterEach(() => {
    if (original === undefined) delete process.env.CORS_ORIGINS;
    else process.env.CORS_ORIGINS = original;
  });

  it('preflight returns 204 without throwing', () => {
    const res = corsPreflight('http://localhost:3000');
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-methods')).toContain('POST');
    expect(res.headers.get('access-control-allow-headers')).toContain('content-type');
  });

  it('allows the local Next.js dev server by default', () => {
    delete process.env.CORS_ORIGINS;
    expect(corsHeaders('http://localhost:3000')['access-control-allow-origin']).toBe('http://localhost:3000');
  });

  it('does not allow an unlisted origin', () => {
    delete process.env.CORS_ORIGINS;
    expect(corsHeaders('https://evil.example')).not.toHaveProperty('access-control-allow-origin');
  });

  it('honours CORS_ORIGINS, including *', () => {
    process.env.CORS_ORIGINS = 'https://scoopt.nl, https://www.scoopt.nl/';
    expect(corsHeaders('https://www.scoopt.nl')['access-control-allow-origin']).toBe('https://www.scoopt.nl');
    process.env.CORS_ORIGINS = '*';
    expect(corsHeaders('https://anything.example')['access-control-allow-origin']).toBe('*');
  });
});
