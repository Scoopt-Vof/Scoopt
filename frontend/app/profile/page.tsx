"use client";
// Shows what Scoopt has learned about the shopper, plus their top personalised
// picks. Client component because the profile lives in the browser for now.

import { useEffect, useState } from "react";
import Link from "next/link";
import { loadProfile, clearProfile, personalise } from "@/lib/profile";
import { getObservedSignals, recentlyViewed, clearEvents } from "@/lib/track";
import { currentAccount, signOut } from "@/lib/auth";
import { searchProducts } from "@/lib/api";
import { getSubcategoryConfig } from "@/lib/subcategoryQuestions";
import type { ShopperProfile, PersonalisedProduct, Product, Account, Category } from "@/contract/types";

// Progressive insight areas — Timing removed (not actionable yet); Sizing is
// now collected per-subcategory via the intake forms rather than as one global field.
const INSIGHT_AREAS = [
  { key: "values", label: "What you value", unlocks: "We'll rank by durability or sustainability, not just price." },
  { key: "lifeContext", label: "Life context", unlocks: "We'll show family-sized or rental-friendly picks that fit your life." },
] as const;

const CAT_LABELS: Record<Category, string> = {
  sport: "Sport",
  home: "Home & furniture",
  tech: "Technology",
};

// Subcategories shown under each category on the profile page. Each links to
// the existing subcategory page where SubcategoryIntake handles the form.
const CATEGORY_SUBCATEGORIES: Record<Category, { id: string; name: string }[]> = {
  sport: [
    { id: "running", name: "Running" },
    { id: "cycling", name: "Cycling" },
    { id: "fitness-gym", name: "Fitness & gym" },
  ],
  home: [
    { id: "furniture", name: "Living room" },
    { id: "bedroom", name: "Bedroom" },
    { id: "kitchen-dining", name: "Kitchen & dining" },
  ],
  tech: [
    { id: "laptops-computers", name: "Laptops & computers" },
    { id: "smartphones", name: "Smartphones" },
  ],
};

// The sign-up questionnaire wrote running answers to "hardlopen" (Dutch); the
// subcategory intake form uses the canonical English id "running". Check both
// so preferences show up regardless of which path the shopper took.
const SUB_ALIASES: Record<string, string> = { running: "hardlopen" };

function getSubDetail(
  profile: ShopperProfile,
  id: string
): Record<string, string> | null {
  return (
    profile.detail?.[id] ??
    profile.detail?.[SUB_ALIASES[id] ?? ""] ??
    null
  );
}

// Convert raw { fieldId: value } answers into human-readable "Label: Option" strings,
// using the same SubcategoryConfig that drove the intake form.
function formatSavedAnswers(
  subcategoryId: string,
  answers: Record<string, string>
): string[] {
  const config = getSubcategoryConfig(subcategoryId);
  return Object.entries(answers)
    .map(([fieldId, value]) => {
      const field = config.fields.find((f) => f.id === fieldId);
      if (!field) return null;
      const optionLabel = field.options?.find((o) => o.value === value)?.label;
      return `${field.label}: ${optionLabel ?? value}`;
    })
    .filter((x): x is string => x !== null);
}

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
          <p className="quiz-sub">Answer a few short questions and we&apos;ll tailor Scoopt to you.</p>
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
            {CAT_LABELS[c]}{profile.budget[c] ? ` · ${profile.budget[c]}` : ""}
          </span>
        ))}
      </div>

      {/* ── Per-category preference section ───────────────────────────────── */}
      <h2 className="section-h" style={{ marginTop: 28 }}>Your preferences by category</h2>
      <p className="note" style={{ marginTop: -8, marginBottom: 14 }}>
        Set once, applied automatically every time you browse that section.
      </p>
      <div className="cat-prefs-grid">
        {(["sport", "home", "tech"] as Category[]).map((cat) => {
          const subcats = CATEGORY_SUBCATEGORIES[cat];
          const isActive = profile.categories.includes(cat);
          return (
            <div key={cat} className={`cat-pref-card${isActive ? "" : " inactive"}`}>
              <div className="cat-pref-header">
                <span className="cat-pref-label">{CAT_LABELS[cat]}</span>
                {!isActive && (
                  <span className="cat-pref-muted">Not in your profile</span>
                )}
              </div>
              <div className="cat-pref-subs">
                {subcats.map(({ id, name }) => {
                  const saved = getSubDetail(profile, id);
                  const hasSaved = Boolean(saved && Object.keys(saved).length > 0);
                  const answers = hasSaved ? formatSavedAnswers(id, saved!) : [];
                  return (
                    <div key={id} className="subcat-pref-row">
                      <div className="subcat-pref-info">
                        <span className="subcat-pref-name">{name}</span>
                        {answers.length > 0 && (
                          <ul className="subcat-pref-answers">
                            {answers.map((a) => (
                              <li key={a}>{a}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                      <Link
                        href={`/category/${cat}/${id}`}
                        className={`subcat-pref-action${hasSaved ? " edit" : ""}`}
                      >
                        {hasSaved ? "Edit" : "Set up"}
                      </Link>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Global insight areas (values + life context) ───────────────────── */}
      <h2 className="section-h" style={{ marginTop: 30 }}>Complete your profile</h2>
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
