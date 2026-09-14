// ============================================================================
//  FORMATTING HELPERS
// ----------------------------------------------------------------------------
//  One place for money formatting so every page shows a price the SAME way.
//  Previously components mixed Intl locales (nl-NL in PriceLane, en-IE in the
//  basket and price signal), so the same €1.234,56 could render as €1,234.56
//  on another part of the page. Scoopt's market is the Netherlands, so we use
//  the Dutch euro format everywhere.
// ============================================================================

const euro = new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" });

export function formatEuro(n: number): string {
  return euro.format(n);
}

// A short, human "freshness" label for an offer's lastChecked timestamp, so the
// shopper can see how current a price is.
export function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  const days = Math.round(hrs / 24);
  return `${days} d ago`;
}
