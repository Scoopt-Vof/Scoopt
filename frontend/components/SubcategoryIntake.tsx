"use client";
// The subcategory page body (e.g. Home & furniture -> Living room).
//
// Behaviour (item 2 on the action list):
//  - If the shopper already has a profile, we DON'T force the questionnaire
//    again. We show products ranked to their profile straight away, with their
//    saved preferences summarised and an "Edit" link to change them.
//  - "Shopping for someone else?" lets them answer fresh for this visit only.
//    Those answers rank the grid but are NEVER saved to their own profile.
//  - A shopper with no profile yet still sees the questions, and answering them
//    creates/updates their profile as before.

import { useEffect, useState } from "react";
import Link from "next/link";
import { loadProfile, saveProfile } from "@/lib/profile";
import { fetchCategoryProducts } from "@/lib/api";
import PersonalisedGrid from "@/components/PersonalisedGrid";
import type { Category, Product, ShopperProfile } from "@/contract/types";
import { getSubcategoryConfig, type SubcategoryConfig } from "@/lib/subcategoryQuestions";

type Phase = "loading" | "form" | "results";

function formatAnswers(config: SubcategoryConfig, answers: Record<string, string>): string[] {
  return Object.entries(answers)
    .map(([fieldId, value]) => {
      const field = config.fields.find((f) => f.id === fieldId);
      if (!field) return null;
      const optionLabel = field.options?.find((o) => o.value === value)?.label;
      return `${field.label}: ${optionLabel ?? value}`;
    })
    .filter((x): x is string => x !== null);
}

export default function SubcategoryIntake({
  category,
  subcategoryId,
  subcategoryName,
  essentials,
}: {
  category: Category;
  subcategoryId: string;
  subcategoryName: string;
  essentials: string[];
}) {
  const config = getSubcategoryConfig(subcategoryId);

  const [phase, setPhase] = useState<Phase>("loading");
  const [forSomeoneElse, setForSomeoneElse] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [savedAnswers, setSavedAnswers] = useState<Record<string, string> | null>(null);
  const [hasProfile, setHasProfile] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [tempProfile, setTempProfile] = useState<ShopperProfile | null>(null);

  useEffect(() => {
    const profile = loadProfile();
    const saved = profile?.detail?.[subcategoryId] ?? null;
    setHasProfile(profile !== null);
    setSavedAnswers(saved && Object.keys(saved).length ? saved : null);
    // Already have a profile? Skip straight to results. No profile yet? Ask.
    setPhase(profile ? "results" : "form");

    let cancelled = false;
    fetchCategoryProducts(`${category}/${subcategoryId}`, { limit: 48 })
      .then((page) => { if (!cancelled) setProducts(page?.products ?? []); })
      .catch(() => { if (!cancelled) setProducts([]); })
      .finally(() => { if (!cancelled) setLoadingProducts(false); });
    return () => { cancelled = true; };
  }, [category, subcategoryId]);

  function setField(id: string, value: string) {
    setAnswers((prev) => ({ ...prev, [id]: value }));
  }

  function startEdit() {
    setForSomeoneElse(false);
    setAnswers(savedAnswers ?? {});
    setPhase("form");
  }
  function startForSomeoneElse() {
    setForSomeoneElse(true);
    setAnswers({});
    setPhase("form");
  }
  function backToMyPicks() {
    setForSomeoneElse(false);
    setTempProfile(null);
    setPhase("results");
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (forSomeoneElse) {
      // One-off ranking for this visit. Do NOT touch the saved profile.
      setTempProfile({
        categories: [category],
        budget: {},
        priority: "price",
        detail: { [subcategoryId]: answers },
      });
      setPhase("results");
      return;
    }

    // Save/merge into the real profile.
    const existing = loadProfile();
    const profile: ShopperProfile =
      existing ?? { categories: [], budget: {}, priority: "price", detail: {} };
    if (!profile.categories.includes(category)) {
      profile.categories = [...profile.categories, category];
    }
    profile.detail = { ...profile.detail, [subcategoryId]: answers };
    saveProfile(profile);

    setSavedAnswers(answers);
    setHasProfile(true);
    setTempProfile(null);
    setPhase("results");
  }

  // ── FORM ────────────────────────────────────────────────────────────────
  if (phase === "form") {
    return (
      <div className="intake-layout">
        <form className="intake-form" onSubmit={handleSubmit}>
          <p className="intake-intro">
            {forSomeoneElse
              ? "Answer for whoever you're buying for. This won't change your own saved preferences."
              : config.intro}
          </p>

          {config.fields.map((field) => (
            <label key={field.id} className="intake-field">
              <span className="q-label">{field.label}</span>
              {field.type === "select" ? (
                <select
                  className="quiz-input"
                  value={answers[field.id] ?? ""}
                  onChange={(e) => setField(field.id, e.target.value)}
                  required
                >
                  <option value="" disabled>Choose one</option>
                  {field.options?.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              ) : (
                <input
                  className="quiz-input"
                  type={field.type === "number" ? "number" : "text"}
                  placeholder={field.placeholder}
                  value={answers[field.id] ?? ""}
                  onChange={(e) => setField(field.id, e.target.value)}
                  required
                />
              )}
            </label>
          ))}

          <div className="intake-actions">
            <button type="submit" className="btn-cta">
              {forSomeoneElse ? "Show me options" : "Show me what fits"}
            </button>
            {hasProfile && (
              <button type="button" className="btn-ghost" onClick={backToMyPicks}>
                Cancel
              </button>
            )}
          </div>
        </form>

        {essentials.length > 0 && (
          <div className="intake-essentials">
            <h4>What you'll typically need</h4>
            <ul className="reasons">
              {essentials.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </div>
        )}
      </div>
    );
  }

  // ── RESULTS ─────────────────────────────────────────────────────────────
  const summary = savedAnswers ? formatAnswers(config, savedAnswers) : [];

  return (
    <div>
      {forSomeoneElse ? (
        <div className="intake-banner">
          <p className="note">Showing options for someone else. These aren&apos;t saved to your profile.</p>
          <div className="intake-actions">
            <button className="btn-ghost" onClick={backToMyPicks}>← Back to my picks</button>
          </div>
        </div>
      ) : (
        <div className="intake-banner">
          {summary.length > 0 ? (
            <>
              <p className="note">Using your saved preferences:</p>
              <div className="chips">
                {summary.map((s) => <span key={s} className="chip">{s}</span>)}
              </div>
            </>
          ) : (
            <p className="note">Ranked to your profile. Add a few details to sharpen it.</p>
          )}
          <div className="intake-actions">
            <button className="btn-ghost" onClick={startEdit}>
              {summary.length > 0 ? "Edit preferences" : `Set up ${subcategoryName.toLowerCase()}`}
            </button>
            <button className="btn-ghost" onClick={startForSomeoneElse}>
              Shopping for someone else?
            </button>
          </div>
        </div>
      )}

      {loadingProducts ? (
        <p className="note">Loading…</p>
      ) : products.length > 0 ? (
        <PersonalisedGrid
          products={products}
          profileOverride={forSomeoneElse ? tempProfile : undefined}
        />
      ) : (
        <div className="foryou invite">
          <p>
            We don&apos;t have {subcategoryName.toLowerCase()} products just yet, but your
            preferences are saved so recommendations improve as soon as we add them.
          </p>
          <p style={{ marginTop: 8 }}>
            <Link href={`/category/${category}`} className="foryou-link">
              Browse everything in this category
            </Link>
          </p>
        </div>
      )}
    </div>
  );
}
