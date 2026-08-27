import { describe, it, expect } from 'vitest';
import { corsPreflight } from '../src/api/contract-handlers';

/**
 * 204 is a null-body status: building a Response with a body and status 204
 * throws a TypeError, which contract-server.ts turns into a 500. That makes
 * every cross-origin POST fail at the preflight, so it is worth its own test.
 */
describe('CORS preflight', () => {
  it('returns 204 without throwing', () => {
    const res = corsPreflight();
    expect(res.status).toBe(204);
  });

  it('carries the headers a browser preflight needs', () => {
    const h = corsPreflight().headers;
    expect(h.get('access-control-allow-origin')).toBe('*');
    expect(h.get('access-control-allow-methods')).toContain('POST');
    expect(h.get('access-control-allow-headers')).toContain('content-type');
  });
});
