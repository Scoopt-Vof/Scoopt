import { fetchJson, requireEnv } from '../lib/http';

/**
 * Icecat product-content lookup, by GTIN/EAN.
 *
 * Icecat is NOT a RetailerSource (see ./types.ts / ./registry.ts) — it has
 * no price, stock or store to attribute an offer to. It enriches product
 * rows that a retailer feed (eBay etc.) already created with the
 * manufacturer's own image, description and specs. See
 * ../ingest/enrich-icecat.ts for the pass that calls this.
 *
 * Auth: header-based dynamic tokens, the method Icecat's own docs mark
 * "recommended" over the legacy static app_key. Generate both at
 * MyIcecat -> Access details -> Manage Access Tokens:
 *   - ICECAT_USERNAME       your MyIcecat account username (e.g. "Scoopt")
 *   - ICECAT_API_TOKEN      "Add API Access Token"
 *   - ICECAT_CONTENT_TOKEN  "Add Content Access Token"
 *
 * Coverage note: this account is on the free "Open Icecat Data" tier, which
 * only covers brands sponsoring Open Icecat, not the full Icecat catalogue.
 * A miss for a real, well-known GTIN usually means that brand/SKU isn't in
 * the Open tier, not that the request is malformed — see README-ICECAT.md.
 *
 * Unverified: the exact FeaturesGroups shape below is transcribed from
 * Icecat's published manuals, not from a live response (this account had
 * no data yet when this was written). Confirm against a real product once
 * the tokens above are set, and adjust the field paths if they differ.
 */

const ICECAT_BASE = 'https://live.icecat.biz/api';

export interface IcecatProduct {
    title: string | null;
    imageUrl: string | null;
    imageUrlHigh: string | null;
    description: string | null;
    specs: Record<string, string>;
}

interface IcecatFeature {
    Feature?: { Name?: { Value?: string } };
    PresentationValue?: string;
    Value?: string;
}

interface IcecatApiResponse {
    msg?: string;
    data?: {
      GeneralInfo?: { Title?: string; ProductName?: string };
      Image?: { HighPic?: string; Pic500x500?: string; LowPic?: string; ThumbPic?: string };
      Description?: { LongDesc?: string; MiddleDesc?: string };
      FeaturesGroups?: { Features?: IcecatFeature[] }[];
    };
}

/** Looks up one product by GTIN/EAN. Returns null if Icecat has no data sheet for it. */
export async function fetchIcecatProduct(gtin: string): Promise<IcecatProduct | null> {
    const username = requireEnv(
          'ICECAT_USERNAME',
          'Your MyIcecat account username (MyIcecat -> My profile).'
        );
    const apiToken = requireEnv(
          'ICECAT_API_TOKEN',
          'Generate one at MyIcecat -> Access details -> Manage Access Tokens -> Add API Access Token.'
        );
    const contentToken = requireEnv(
          'ICECAT_CONTENT_TOKEN',
          'Generate one at MyIcecat -> Access details -> Manage Access Tokens -> Add Content Access Token.'
        );

  const url =
        `${ICECAT_BASE}?lang=en&shopname=${encodeURIComponent(username)}` +
        `&GTIN=${encodeURIComponent(gtin)}&content=essentialinfo,description,gallery,featuregroups`;

  let result;
    try {
          result = await fetchJson<IcecatApiResponse>(url, {
                  headers: { 'api-token': apiToken, 'content-token': contentToken },
                  rateKey: 'icecat',
                  // Icecat's fair-use ceiling is ~100 req/s/IP; a cron enriching a
                  // modest catalogue has no reason to go anywhere near that.
                  rateLimit: { minIntervalMs: 400 },
                  maxRetries: 3,
          });
    } catch (err) {
          // fetchJson already retried 429/5xx internally. A 4xx that survives
      // means "no data sheet for this GTIN under your subscription" far more
      // often than a broken request — see the coverage note above.
      if (String(err).includes('HTTP 4')) return null;
          throw err;
    }

  const data = result.data?.data;
    if (!data || result.data?.msg?.toUpperCase() !== 'OK') return null;

  const image = data.Image ?? {};
    const specs: Record<string, string> = {};
    for (const group of data.FeaturesGroups ?? []) {
          for (const feature of group.Features ?? []) {
                  const name = feature.Feature?.Name?.Value;
                  const value = feature.PresentationValue ?? feature.Value;
                  if (name && value) specs[name] = value;
          }
    }

  return {
        title: data.GeneralInfo?.Title ?? data.GeneralInfo?.ProductName ?? null,
        imageUrl: image.Pic500x500 ?? image.HighPic ?? image.LowPic ?? null,
        imageUrlHigh: image.HighPic ?? null,
        description: data.Description?.LongDesc ?? data.Description?.MiddleDesc ?? null,
        specs,
  };
}
