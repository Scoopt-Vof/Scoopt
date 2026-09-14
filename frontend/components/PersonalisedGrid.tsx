"use client";
// Takes a plain product list (from the server) and, if the shopper has a
// profile, re-ranks it and shows a short "why it fits" line on each card.
// Without a profile it just shows the products in the given order — so the page
// works fine logged-out, and gets better once a profile exists.

import { useEffect, useState } from "react";
import Link from "next/link";
import { loadProfile, personalise, SHOW_MATCH_PERCENT } from "@/lib/profile";
import { getObservedSignals } from "@/lib/track";
import type { Product, PersonalisedProduct, ShopperProfile } from "@/contract/types";

export default function PersonalisedGrid({
  products,
  // Optional: rank against THIS profile instead of the signed-in shopper's saved
  // one. Used by the "shopping for someone else" path so a one-off set of answers
  // ranks the grid without touching the real profile. `null` means rank as a
  // guest (no personalisation); omit entirely to use the saved profile.
  profileOverride,
}: {
  products: Product[];
  profileOverride?: ShopperProfile | null;
}) {
  const [items, setItems] = useState<PersonalisedProduct[]>(
    products.map((product) => ({ product, matchScore: 50, reasons: [] }))
  );
  const [personalised, setPersonalised] = useState(false);

  useEffect(() => {
    const profile = profileOverride !== undefined ? profileOverride : loadProfile();
    if (profile) {
      setItems(personalise(products, profile, getObservedSignals()));
      setPersonalised(true);
    } else {
      setItems(products.map((product) => ({ product, matchScore: 50, reasons: [] })));
      setPersonalised(false);
    }
  }, [products, profileOverride]);

  return (
    <>
      {personalised && (
        <p className="note">Sorted by what fits you ·{" "}
          <Link href="/profile" className="foryou-link">your profile</Link>
        </p>
      )}
      <div className="prod-grid">
        {items.map(({ product, reasons, matchScore }) => (
          <Link key={product.id} href={`/product/${product.id}`} className="prod-card">
            {product.image ? (
              <img src={product.image} alt="" className="prod-image" loading="lazy" />
            ) : (
              <div className="prod-image prod-image-empty" aria-hidden="true" />
            )}
            <span className="prod-brand">{product.brand}</span>
            <span className="prod-name">{product.name}</span>
            <span className="prod-unit">{product.unit}</span>
            {personalised && (
              <>
                {SHOW_MATCH_PERCENT && (
                  <div className="match"><span className="match-score">{matchScore}% match</span></div>
                )}
                {reasons.length > 0 && (
                  <ul className="reasons">
                    {reasons.map((r) => <li key={r}>{r}</li>)}
                  </ul>
                )}
              </>
            )}
          </Link>
        ))}
      </div>
    </>
  );
}
