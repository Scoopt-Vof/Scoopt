/**
 * Money is integer cents, everywhere, always.
 *
 * The moment a price becomes a float you get 34.99 stored as 34.989999999999995,
 * and comparison sites are judged entirely on whether their numbers are right.
 * Formatting to euros happens once, at the very edge, in the UI.
 */

export function centsFromEuroString(input: string | number): number {
  if (typeof input === 'number') return Math.round(input * 100);
  const cleaned = input.trim().replace(/[€\s]/g, '').replace(',', '.');
  const value = Number(cleaned);
  if (!Number.isFinite(value)) throw new Error(`not a price: ${input}`);
  return Math.round(value * 100);
}

/** For logs and tests only — never for storage. */
export function formatEuro(cents: number): string {
  return new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })
    .format(cents / 100);
}

/** Prices outside this band are almost certainly a parsing bug, not a bargain. */
export const MIN_SANE_CENTS = 50;          // €0.50
export const MAX_SANE_CENTS = 5_000_000;   // €50,000

export function isSanePrice(cents: number): boolean {
  return Number.isInteger(cents) && cents >= MIN_SANE_CENTS && cents <= MAX_SANE_CENTS;
}
