import { describe, it, expect } from 'vitest';
import { isValidEan13, normaliseEan, eanCheckDigit } from '../src/lib/ean';

describe('EAN-13 validation', () => {
  it('accepts real EANs', () => {
    expect(isValidEan13('4006381333931')).toBe(true); // Staedtler pen, textbook example
    expect(isValidEan13('5901234123457')).toBe(true);
  });

  it('rejects a wrong check digit', () => {
    expect(isValidEan13('4006381333932')).toBe(false);
  });

  it('rejects the junk that actually shows up in feed EAN columns', () => {
    for (const junk of ['', 'N/A', 'null', '000', 'ABC1234567890', '0000000000000', '   ']) {
      expect(isValidEan13(junk), `should reject ${JSON.stringify(junk)}`).toBe(false);
    }
    expect(isValidEan13(null)).toBe(false);
    expect(isValidEan13(undefined)).toBe(false);
  });

  it('upgrades UPC-A to EAN-13 with a leading zero', () => {
    expect(normaliseEan('012345678905')).toBe('0012345678905');
    expect(isValidEan13('012345678905')).toBe(true);
  });

  it('tolerates spaces and hyphens', () => {
    expect(isValidEan13('4006381 333931')).toBe(true);
    expect(isValidEan13('4006381-333931')).toBe(true);
  });

  it('computes check digits', () => {
    expect(eanCheckDigit('400638133393')).toBe(1);
  });
});
