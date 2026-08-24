import { describe, it, expect } from 'vitest';
import { centsFromEuroString, isSanePrice, formatEuro } from '../src/lib/money';

describe('money', () => {
  it('parses the price formats feeds actually use', () => {
    expect(centsFromEuroString('34,99')).toBe(3499);   // Dutch decimal comma
    expect(centsFromEuroString('34.99')).toBe(3499);
    expect(centsFromEuroString('€ 34,99')).toBe(3499);
    expect(centsFromEuroString(34.99)).toBe(3499);
  });

  it('never produces a float artefact', () => {
    // The bug this whole module exists to prevent.
    expect(centsFromEuroString('34.99')).toBe(3499);
    expect(Number.isInteger(centsFromEuroString('1234.56'))).toBe(true);
  });

  it('flags prices that mean a parsing bug, not a bargain', () => {
    expect(isSanePrice(0)).toBe(false);
    expect(isSanePrice(-100)).toBe(false);
    expect(isSanePrice(10)).toBe(false);          // €0.10
    expect(isSanePrice(9_000_000)).toBe(false);   // €90,000
    expect(isSanePrice(3499)).toBe(true);
    expect(isSanePrice(34.99)).toBe(false);       // not an integer → someone passed euros
  });

  it('formats for humans', () => {
    expect(formatEuro(3499)).toContain('34,99');
  });
});
