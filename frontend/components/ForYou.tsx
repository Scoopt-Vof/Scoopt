"use client";
// Shows the "voor jou" (for you) personalisation line for a single product.
// Client component: it reads the browser-stored profile and computes the fit.
// If there's no profile yet, it invites the shopper to create one — turning an
// empty state into an on-ramp to the USP.

import { useEffect, useState } from "react";
import Link from "next/link";
import { loadProfile, personalise, SHOW_MATCH_PERCENT } from "@/lib/profile";
import { getObservedSignals } from "@/lib/track";
import type { Product, PersonalisedProduct } from "@/contract/types";

export default function ForYou({ product }: { product: Product }) {
  const [result, setResult] = useState<PersonalisedProduct | null>(null);
  const [hasProfile, setHasProfile] = useState<boolean | null>(null);

  useEffect(() => {
    const profile = loadProfile();
    setHasProfile(profile !== null);
    if (profile) setResult(personalise([product], profile, getObservedSignals())[0]);
  }, [product]);

  if (hasProfile === null) return null; // still checking (avoids flof content)

  if (!hasProfile) {
    return (
      <div className="foryou invite">
        <span className="foryou-eyebrow">For you</span>
        <p>
          <Link href="/signup" className="foryou-link">Create a profile</Link>{" "}
          and Scoopt tells you if this fits you.
        </p>
      </div>
    );
  }

  if (!result) return null;

  return (
    <div className="foryou">
      <div className="foryou-head">
        <span className="foryou-eyebrow">For you</span>
        {SHOW_MATCH_PERCENT && (
          <span className="foryou-score">{result.matchScore}% match</span>
        )}
      </div>
      {result.reasons.length > 0 ? (
        <ul className="reasons">
          {result.reasons.map((r) => <li key={r}>{r}</li>)}
        </ul>
      ) : (
        <p className="foryou-neutral">Neutral match for your profile.</p>
      )}
    </div>
  );
}
