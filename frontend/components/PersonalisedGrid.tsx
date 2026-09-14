"use client";
// Takes a plain product list (from the server) and, if the shopper has a
// profile, re-ranks it and shows a short "why it fits" line on each card.
// Without a profile it just shows the products in the given order — so the page
// works fine logged-out, and gets better once a profile exists.

import { useEffect, useState } from "react";
import Link from "next/link";
import { loadProfile, personalise, SHOW_MATCH_PERCENT } from "@/lib/profile";
import { getObservedSignals } from "@/lib/track";
import type { Product, PersonalisedProduct } from "@/contract/types";

export default function PersonalisedGrid({ products }: { products: Product[] }) {
  const [items, setItems] = useState<PersonalisedProduct[]>(
    products.map((product) => ({ product, matchScore: 50, reasons: [] }))
  );
  const [personalised, setPersonalised] = useState(false);

  useEffect(() => {
    const profile = loadProfile();
    if (profile) {
      setItems(personalise(products, profile, getObservedSignals()));
      setPersonalised(true);
    }
  }, [products]);

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
