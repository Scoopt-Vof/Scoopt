/**
 * EAN-13 validation.
 *
 * This is small and boring and it is the single highest-leverage function in
 * the ingestion pipeline. Retailer feeds routinely put internal SKUs, ISBNs,
 * empty strings and the literal text "N/A" in the EAN column. Matching two
 * products because they share a junk EAN produces a confidently wrong price,
 * which is the one failure mode a comparison site cannot survive.
 */

/** Strips spaces/hyphens and pads UPC-A (12 digits) up to EAN-13 with a leading 0. */
export function normaliseEan(input: string | null | undefined): string | null {
  if (!input) return null;
  const digits = String(input).replace(/[\s-]/g, '');
  if (!/^[0-9]+$/.test(digits)) return null;
  if (digits.length === 12) return '0' + digits; // UPC-A → EAN-13
  if (digits.length === 13) return digits;
  return null; // EAN-8 and anything else is not enough to match on
}

export function eanCheckDigit(first12: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  }
  return (10 - (sum % 10)) % 10;
}

export function isValidEan13(input: string | null | undefined): boolean {
  const ean = normaliseEan(input);
  if (!ean) return false;
  // All-same-digit strings ('0000000000000') pass the checksum but are junk.
  if (/^(\d)\1{12}$/.test(ean)) return false;
  return eanCheckDigit(ean.slice(0, 12)) === Number(ean[12]);
}
