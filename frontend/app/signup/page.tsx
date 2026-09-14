"use client";
// The sign-up questionnaire — Scoopt's USP entry point.
// A client component because it holds step state and reads/writes localStorage.
// Multi-step to reduce drop-off: one decision per screen, progress shown.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveProfile } from "@/lib/profile";
import type {
  Category, BudgetBand, Priority, ShopperProfile, CategoryDetail,
} from "@/contract/types";
import { CATEGORIES } from "@/lib/categories";

const CATS: { id: Category; label: string }[] = CATEGORIES.map(
  ({ id, label }) => ({ id, label })
);
const BUDGETS: { id: BudgetBand; label: string; hint: string }[] = [
  { id: "value", label: "Value", hint: "Best price matters most" },
  { id: "mid", label: "Mid-range", hint: "Price and quality" },
  { id: "premium", label: "Premium", hint: "The best; price matters less" },
];
const PRIORITIES: { id: Priority; label: string; hint: string }[] = [
  { id: "price", label: "The lowest price", hint: "I mainly want to save" },
  { id: "quality", label: "The best quality", hint: "Lasts a long time" },
  { id: "newest", label: "The newest", hint: "I want the latest model" },
];

export default function SignupPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);

  const [name, setName] = useState("");
  const [categories, setCategories] = useState<Category[]>([]);
  const [budget, setBudget] = useState<Partial<Record<Category, BudgetBand>>>({});
  const [priority, setPriority] = useState<Priority | null>(null);
  const [runDistance, setRunDistance] = useState("");
  const [runLevel, setRunLevel] = useState("");

  const shopsSport = categories.includes("sport");
  // Steps: 0 name, 1 categories, 2 budget(per cat), 3 priority, 4 sport detail (if sport), 5 done
  const totalSteps = shopsSport ? 5 : 4;

  function toggleCat(c: Category) {
    setCategories((prev) =>
      prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]
    );
  }

  function finish() {
    const detail: Record<string, CategoryDetail> = {};
    // Write under the canonical English subcategory id "running" (the id the
    // backend sends and the ranking engine looks up), with the SAME field ids
    // and option values the subcategory intake form uses ("afstand"/"niveau",
    // niveau: "beginner"|"gevorderd"). Previously this wrote "hardlopen" with
    // niveau "advanced", so the answers were never found by scoreProduct and
    // disagreed with the intake form.
    if (shopsSport && (runDistance || runLevel)) {
      detail["running"] = {};
      if (runDistance) detail["running"].afstand = runDistance;
      if (runLevel) detail["running"].niveau = runLevel;
    }
    const profile: ShopperProfile = {
      name: name.trim() || undefined,
      categories,
      budget,
      priority: priority ?? "price",
      detail,
      completedAt: new Date().toISOString(),
    };
    saveProfile(profile);
    router.push("/profile");
  }

  const canNext =
    (step === 0) ||
    (step === 1 && categories.length > 0) ||
    (step === 2) ||
    (step === 3 && priority !== null) ||
    (step === 4);

  return (
    <div className="quiz">
      <div className="quiz-progress">
        <div className="quiz-bar" style={{ width: `${(step / totalSteps) * 100}%` }} />
      </div>
      <p className="quiz-step">Step {step + 1} of {totalSteps + 1}</p>

      {step === 0 && (
        <section className="quiz-card">
          <h1>Welcome to Scoopt</h1>
          <p className="quiz-sub">We’ll ask a few short questions so we can give you tailored buying advice. What may we call you?</p>
          <input className="quiz-input" placeholder="Your first name (optional)"
            value={name} onChange={(e) => setName(e.target.value)} />
        </section>
      )}

      {step === 1 && (
        <section className="quiz-card">
          <h1>What do you shop for?</h1>
          <p className="quiz-sub">Choose everything that applies.</p>
          <div className="opt-grid">
            {CATS.map((c) => (
              <button key={c.id} type="button"
                className={`opt ${categories.includes(c.id) ? "on" : ""}`}
                onClick={() => toggleCat(c.id)}>
                {c.label}
              </button>
            ))}
          </div>
        </section>
      )}

      {step === 2 && (
        <section className="quiz-card">
          <h1>What’s your budget?</h1>
          <p className="quiz-sub">Per category you chose — this steers our recommendations.</p>
          {categories.map((c) => (
            <div key={c} className="budget-block">
              <div className="budget-cat">{CATS.find((x) => x.id === c)?.label}</div>
              <div className="opt-grid">
                {BUDGETS.map((b) => (
                  <button key={b.id} type="button"
                    className={`opt ${budget[c] === b.id ? "on" : ""}`}
                    onClick={() => setBudget((prev) => ({ ...prev, [c]: b.id }))}>
                    <span className="opt-title">{b.label}</span>
                    <span className="opt-hint">{b.hint}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </section>
      )}

      {step === 3 && (
        <section className="quiz-card">
          <h1>What matters most to you?</h1>
          <p className="quiz-sub">Your biggest driver when buying.</p>
          <div className="opt-list">
            {PRIORITIES.map((p) => (
              <button key={p.id} type="button"
                className={`opt wide ${priority === p.id ? "on" : ""}`}
                onClick={() => setPriority(p.id)}>
                <span className="opt-title">{p.label}</span>
                <span className="opt-hint">{p.hint}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {step === 4 && shopsSport && (
        <section className="quiz-card">
          <h1>A little more about running</h1>
          <p className="quiz-sub">So we can tailor shoes and watches to you.</p>
          <label className="q-label">What are you training for?</label>
          <div className="opt-grid">
            {[
              ["5-10km", "5–10 km"],
              ["10-25km", "10–25 km"],
              ["marathon", "Marathon or beyond"],
              ["general", "Just staying fit"],
            ].map(([v, l]) => (
              <button key={v} type="button"
                className={`opt ${runDistance === v ? "on" : ""}`}
                onClick={() => setRunDistance(v)}>{l}</button>
            ))}
          </div>
          <label className="q-label" style={{ marginTop: 16 }}>Your level?</label>
          <div className="opt-grid">
            {[["beginner", "Beginner"], ["gevorderd", "Advanced"]].map(([v, l]) => (
              <button key={v} type="button"
                className={`opt ${runLevel === v ? "on" : ""}`}
                onClick={() => setRunLevel(v)}>{l}</button>
            ))}
          </div>
        </section>
      )}

      <div className="quiz-actions">
        {step > 0 && (
          <button className="btn-ghost" onClick={() => setStep((s) => s - 1)}>← Back</button>
        )}
        {step < totalSteps ? (
          <button className="btn-cta" disabled={!canNext}
            onClick={() => setStep((s) => s + 1)}>Next →</button>
        ) : (
          <button className="btn-cta" onClick={finish}>Done — see my profile</button>
        )}
      </div>
    </div>
  );
}
