"use client";
// Shows what Scoopt has learned about the shopper, plus their top personalised
// picks. Client component because the profile lives in the browser for now.

import { useEffect, useState } from "react";
import Link from "next/link";
import { loadProfile, clearProfile, personalise } from "@/lib/profile";
import { getObservedSignals, recentlyViewed, clearEvents } from "@/lib/track";
import { currentAccount, signOut } from "@/lib/auth";
import { searchProducts } from "@/lib/api";
import type { ShopperProfile, PersonalisedProduct, Product, Account } from "@/contract/types";

const eur = new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" });

// The four progressive-insight areas. Each shows what Scoopt CAN tell the
// shopper once they add it — turning profile-building into a value exchange.
const INSIGHT_AREAS = [
  { key: "rightSizing", label: "Sizing & space", unlocks: "We'll warn you when something won't fit your size or your room." },
  { key: "timing", label: "Timing", unlocks: "We'll tell you when to wait for a price drop or when to replace." },
  { key: "values", label: "What you value", unlocks: "We'll rank by durability or sustainability, not just price." },
  { key: "lifeContext", label: "Life context", unlocks: "We'll show family-sized or rental-friendly picks that fit your life." },
] as const;

export default function ProfilePage() {
  const [profile, setProfile] = useState<ShopperProfile | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [picks, setPicks] = useState<PersonalisedProduct[]>([]);
  const [viewed, setViewed] = useState<Product[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const p = loadProfile();
    setProfile(p);
    setAccount(currentAccount());
    const signals = getObservedSignals();
    searchProducts("").then((all) => {
      if (p) {
        const relevant = all.filter((x) => p.categories.includes(x.category));
        setPicks(personalise(relevant.length ? relevant : all, p, signals).slice(0, 4));
      }
      const recentIds = recentlyViewed(6);
      setViewed(
        recentIds
          .map((id) => all.find((x) => x.id === id))
          .filter((x): x is Product => Boolean(x))
      );
      setReady(true);
    });
  }, []);

  if (!ready) return <p className="note">Loading…</p>;

  if (!profile) {
    return (
      <>
        <div className="quiz-card" style={{ textAlign: "center" }}>
          <h1>No profile yet</h1>
          <p className="quiz-sub">Answer a few short questions and we’ll tailor Scoopt to you.</p>
          <Link href="/signup" className="btn-cta" style={{ display: "inline-block", marginTop: 12 }}>
            Create profile →
          </Link>
        </div>

        {viewed.length > 0 && (
          <>
            <h2 className="section-h" style={{ marginTop: 30 }}>Recently viewed</h2>
            <p className="note" style={{ marginTop: -8 }}>
              Even without a profile, Scoopt remembers what you viewed.
            </p>
            <div className="prod-grid">
              {viewed.map((product) => (
                <Link key={product.id} href={`/product/${product.id}`} className="prod-card">
                  <span className="prod-brand">{product.brand}</span>
                  <span className="prod-name">{product.name}</span>
                  <span className="prod-unit">{product.unit}</span>
                </Link>
              ))}
            </div>
          </>
        )}
      </>
    );
  }

  return (
    <>
      <div className="crumb"><Link href="/">Home</Link> › <b>My profile</b></div>

      {account && (
        <div className="account-bar">
          <div className="account-id">
            <span className="account-avatar" aria-hidden>
              {(account.name || account.email)[0].toUpperCase()}
            </span>
            <div>
              <div className="account-name">{account.name || "Signed in"}</div>
              <div className="account-email">{account.email} · via {account.provider}</div>
            </div>
          </div>
          <button className="btn-ghost account-signout" onClick={() => { signOut(); location.href = "/"; }}>
            Sign out
          </button>
        </div>
      )}

      <h1 className="page-title">{profile.name ? `Hi ${profile.name}` : "My profile"}</h1>
      <p className="page-blurb">This is what Scoopt knows about you — the more you shop, the better it gets.</p>

      <div className="chips">
        <span className="chip">Priority: {labelPriority(profile.priority)}</span>
        {profile.categories.map((c) => (
          <span key={c} className="chip">
            {c}{profile.budget[c] ? ` · ${profile.budget[c]}` : ""}
          </span>
        ))}
        {profile.detail.hardlopen?.niveau && (
          <span className="chip">Running: {profile.detail.hardlopen.niveau}</span>
        )}
        {profile.detail.hardlopen?.afstand && (
          <span className="chip">{profile.detail.hardlopen.afstand}/week</span>
        )}
      </div>

      <h2 className="section-h">Get better advice — complete your profile</h2>
      <p className="note" style={{ marginTop: -8 }}>
        Add a little more and Scoopt can give you sharper, more honest buying help.
      </p>
      <div className="insight-grid">
        {INSIGHT_AREAS.map((area) => {
          const done = Boolean(
            profile[area.key] &&
            (Array.isArray(profile[area.key])
              ? (profile[area.key] as string[]).length > 0
              : Object.keys(profile[area.key] as object).length > 0)
          );
          return (
            <div key={area.key} className={`insight-card ${done ? "done" : ""}`}>
              <div className="insight-top">
                <span className="insight-label">{area.label}</span>
                {done
                  ? <span className="insight-badge on">Added ✓</span>
                  : <span className="insight-badge">Add</span>}
              </div>
              <p className="insight-unlocks">{area.unlocks}</p>
            </div>
          );
        })}
      </div>

      <h2 className="section-h" style={{ marginTop: 30 }}>Picked for you</h2>
      <div className="prod-grid">
        {picks.map(({ product, reasons, matchScore }) => (
          <Link key={product.id} href={`/product/${product.id}`} className="prod-card">
            <span className="prod-brand">{product.brand}</span>
            <span className="prod-name">{product.name}</span>
            <span className="prod-unit">{product.unit}</span>
            <div className="match">
              <span className="match-score">{matchScore}% match</span>
            </div>
            {reasons.length > 0 && (
              <ul className="reasons">
                {reasons.map((r) => <li key={r}>{r}</li>)}
              </ul>
            )}
          </Link>
        ))}
      </div>

      {viewed.length > 0 && (
        <>
          <h2 className="section-h" style={{ marginTop: 30 }}>Recently viewed</h2>
          <p className="note" style={{ marginTop: -8 }}>
            Scoopt learns from what you view too — not just your answers.
          </p>
          <div className="prod-grid">
            {viewed.map((product) => (
              <Link key={product.id} href={`/product/${product.id}`} className="prod-card">
                <span className="prod-brand">{product.brand}</span>
                <span className="prod-name">{product.name}</span>
                <span className="prod-unit">{product.unit}</span>
              </Link>
            ))}
          </div>
        </>
      )}

      <button className="btn-ghost" style={{ marginTop: 24 }}
        onClick={() => { clearProfile(); clearEvents(); location.href = "/signup"; }}>
        Clear profile and start over
      </button>
    </>
  );
}

function labelPriority(p: string) {
  return p === "price" ? "lowest price" : p === "quality" ? "best quality" : "newest";
}
