"use client";
// The form a shopper sees after clicking through from a category page into
// one subcategory (e.g. Home & furniture -> Living room). It asks a few
// subcategory-specific questions, saves the answers into the shopper's
// profile (ShopperProfile.detail, keyed by subcategory id -- see
// contract/types.ts), and then shows personalised products for just this
// subcategory using the existing engine in lib/profile.ts.
//
// This is deliberately the same "detail" mechanism the sign-up questionnaire
// already writes to, so a running shoe answer given here and one given during
// sign-up both feed the same ranking rules.

import { useState } from "react";
import Link from "next/link";
import { loadProfile, saveProfile } from "@/lib/profile";
import { searchProducts } from "@/lib/api";
import PersonalisedGrid from "@/components/PersonalisedGrid";
import type { Category, Product } from "@/contract/types";
import { getSubcategoryConfig } from "@/lib/subcategoryQuestions";

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
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const [matches, setMatches] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);

  function setField(id: string, value: string) {
    setAnswers((prev) => ({ ...prev, [id]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    // Load (or start) the shopper's profile, and merge these answers into it.
    const existing = loadProfile();
    const profile = existing ?? {
      categories: [],
      budget: {},
      priority: "price" as const,
      detail: {},
    };
    if (!profile.categories.includes(category)) {
      profile.categories = [...profile.categories, category];
    }
    profile.detail = { ...profile.detail, [subcategoryId]: answers };
    saveProfile(profile);

    // Show what we actually have in this subcategory today.
    const all = await searchProducts("");
    const filtered = all.filter((p) => p.subcategory === subcategoryId);
    setMatches(filtered);
    setSubmitted(true);
    setLoading(false);
  }

  if (submitted) {
    return (
      <div>
        <div className="intake-done">
          <p className="note">Thanks, that's saved to your profile.</p>
        </div>
        {matches.length > 0 ? (
          <PersonalisedGrid products={matches} />
        ) : (
          <div className="foryou invite">
            <p>
              We don't have {subcategoryName.toLowerCase()} products matched to those
              answers just yet, but we've saved your preferences so recommendations
              improve as soon as we do.
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

  return (
    <div className="intake-layout">
      <form className="intake-form" onSubmit={handleSubmit}>
        <p className="intake-intro">{config.intro}</p>

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
                <option value="" disabled>
                  Choose one
                </option>
                {field.options?.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
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

        <button type="submit" className="btn-cta" disabled={loading}>
          {loading ? "One moment..." : "Show me what fits"}
        </button>
      </form>

      {essentials.length > 0 && (
        <div className="intake-essentials">
          <h4>What you'll typically need</h4>
          <ul className="reasons">
            {essentials.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
