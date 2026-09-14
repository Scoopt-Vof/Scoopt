"use client";
// Editable profile sections (items 5 and 6):
//   - "What you value"  → a set of values, click to change.
//   - "Life context"    → household, home, who you shop for, pets. The "who you
//     shop for" answer is what powers "buy something for my son" style journeys.
//   - "Delivery details"→ address + contact, shown only when signed in. Stored
//     separately from the profile (lib/delivery.ts). Does NOT auto-fill a
//     retailer's checkout — see that file for why.

import { useEffect, useState } from "react";
import { loadProfile, saveProfile } from "@/lib/profile";
import { loadDelivery, saveDelivery, hasDelivery, type DeliveryDetails } from "@/lib/delivery";
import type { ShopperProfile } from "@/contract/types";

const VALUE_OPTIONS: { value: string; label: string }[] = [
  { value: "sustainable", label: "Sustainable" },
  { value: "buy-it-for-life", label: "Buy it for life" },
  { value: "local", label: "Dutch / local brands" },
  { value: "best-value", label: "Best value" },
  { value: "premium", label: "Premium quality" },
  { value: "ethical", label: "Ethical / fair trade" },
];
const VALUE_LABEL = Object.fromEntries(VALUE_OPTIONS.map((v) => [v.value, v.label]));

const HOUSEHOLD = [
  { value: "single", label: "Just me" },
  { value: "couple", label: "A couple" },
  { value: "family", label: "A family" },
  { value: "sharing", label: "Sharing / flatmates" },
];
const HOME = [
  { value: "own", label: "I own my home" },
  { value: "rent", label: "I rent" },
];

export default function ProfilePersonalise({ signedIn }: { signedIn: boolean }) {
  const [profile, setProfile] = useState<ShopperProfile | null>(null);
  const [delivery, setDelivery] = useState<DeliveryDetails | null>(null);
  const [editing, setEditing] = useState<null | "values" | "life" | "delivery">(null);

  const [valSel, setValSel] = useState<string[]>([]);
  const [life, setLife] = useState<Record<string, string>>({});
  const [addr, setAddr] = useState<DeliveryDetails>({});

  useEffect(() => {
    setProfile(loadProfile());
    setDelivery(loadDelivery());
  }, []);

  function persistProfile(patch: Partial<ShopperProfile>) {
    const base = loadProfile();
    if (!base) return;
    const next: ShopperProfile = { ...base, ...patch };
    saveProfile(next);
    setProfile(next);
  }

  function toggleValue(v: string) {
    setValSel((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]));
  }
  function saveValues() {
    persistProfile({ values: valSel });
    setEditing(null);
  }
  function saveLife() {
    const cleaned = Object.fromEntries(
      Object.entries(life).filter(([, v]) => v && v.trim())
    ) as Record<string, string>;
    persistProfile({ lifeContext: cleaned });
    setEditing(null);
  }
  function saveAddr() {
    const cleaned = Object.fromEntries(
      Object.entries(addr).filter(([, v]) => v && String(v).trim())
    ) as DeliveryDetails;
    saveDelivery(cleaned);
    setDelivery(cleaned);
    setEditing(null);
  }

  const values = profile?.values ?? [];
  const lifeCtx = profile?.lifeContext ?? {};
  const lifeKeys = Object.keys(lifeCtx);

  return (
    <>
      <h2 className="section-h" style={{ marginTop: 30 }}>Complete your profile</h2>
      <p className="note" style={{ marginTop: -8 }}>
        Add a little more and Scoopt can give you sharper, more honest buying help.
      </p>

      <div className="insight-grid">
        {/* What you value */}
        <div className={`insight-card ${values.length ? "done" : ""}`}>
          <div className="insight-top">
            <span className="insight-label">What you value</span>
            <button className="insight-badge-btn" onClick={() => { setValSel(values); setEditing("values"); }}>
              {values.length ? "Change" : "Add"}
            </button>
          </div>
          {editing === "values" ? (
            <div className="editor">
              <div className="opt-grid">
                {VALUE_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    className={`opt ${valSel.includes(o.value) ? "on" : ""}`}
                    onClick={() => toggleValue(o.value)}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
              <div className="intake-actions">
                <button className="btn-cta" onClick={saveValues}>Save</button>
                <button className="btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
              </div>
            </div>
          ) : values.length ? (
            <div className="chips">
              {values.map((v) => <span key={v} className="chip">{VALUE_LABEL[v] ?? v}</span>)}
            </div>
          ) : (
            <p className="insight-unlocks">We&apos;ll rank by durability or sustainability, not just price.</p>
          )}
        </div>

        {/* Life context */}
        <div className={`insight-card ${lifeKeys.length ? "done" : ""}`}>
          <div className="insight-top">
            <span className="insight-label">Life context</span>
            <button className="insight-badge-btn" onClick={() => { setLife(lifeCtx); setEditing("life"); }}>
              {lifeKeys.length ? "Change" : "Add"}
            </button>
          </div>
          {editing === "life" ? (
            <div className="editor">
              <label className="editor-field">
                <span className="q-label">Your household</span>
                <select className="quiz-input" value={life.household ?? ""} onChange={(e) => setLife({ ...life, household: e.target.value })}>
                  <option value="">No preference</option>
                  {HOUSEHOLD.map((h) => <option key={h.value} value={h.value}>{h.label}</option>)}
                </select>
              </label>
              <label className="editor-field">
                <span className="q-label">Your home</span>
                <select className="quiz-input" value={life.home ?? ""} onChange={(e) => setLife({ ...life, home: e.target.value })}>
                  <option value="">No preference</option>
                  {HOME.map((h) => <option key={h.value} value={h.value}>{h.label}</option>)}
                </select>
              </label>
              <label className="editor-field">
                <span className="q-label">Who do you shop for?</span>
                <input className="quiz-input" placeholder="e.g. myself, my son, the family" value={life.shoppingFor ?? ""} onChange={(e) => setLife({ ...life, shoppingFor: e.target.value })} />
              </label>
              <label className="editor-field">
                <span className="q-label">Any pets?</span>
                <input className="quiz-input" placeholder="e.g. a dog" value={life.pets ?? ""} onChange={(e) => setLife({ ...life, pets: e.target.value })} />
              </label>
              <div className="intake-actions">
                <button className="btn-cta" onClick={saveLife}>Save</button>
                <button className="btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
              </div>
            </div>
          ) : lifeKeys.length ? (
            <div className="chips">
              {lifeCtx.household && <span className="chip">{HOUSEHOLD.find((h) => h.value === lifeCtx.household)?.label ?? lifeCtx.household}</span>}
              {lifeCtx.home && <span className="chip">{HOME.find((h) => h.value === lifeCtx.home)?.label ?? lifeCtx.home}</span>}
              {lifeCtx.shoppingFor && <span className="chip">Shops for: {lifeCtx.shoppingFor}</span>}
              {lifeCtx.pets && <span className="chip">Pets: {lifeCtx.pets}</span>}
            </div>
          ) : (
            <p className="insight-unlocks">We&apos;ll show family-sized or rental-friendly picks, and can help you shop for someone else.</p>
          )}
        </div>
      </div>

      {/* Delivery details — signed-in only */}
      {signedIn && (
        <>
          <h2 className="section-h" style={{ marginTop: 30 }}>Delivery details</h2>
          <p className="note" style={{ marginTop: -8 }}>
            Saved to your profile for a faster checkout later. We never share it with retailers,
            and it does not fill in eBay&apos;s checkout for you yet.
          </p>
          <div className="insight-card" style={{ maxWidth: 520 }}>
            <div className="insight-top">
              <span className="insight-label">Address &amp; contact</span>
              <button className="insight-badge-btn" onClick={() => { setAddr(delivery ?? {}); setEditing("delivery"); }}>
                {hasDelivery(delivery) ? "Change" : "Add"}
              </button>
            </div>
            {editing === "delivery" ? (
              <div className="editor">
                <label className="editor-field"><span className="q-label">Full name</span>
                  <input className="quiz-input" value={addr.fullName ?? ""} onChange={(e) => setAddr({ ...addr, fullName: e.target.value })} /></label>
                <label className="editor-field"><span className="q-label">Address line 1</span>
                  <input className="quiz-input" value={addr.line1 ?? ""} onChange={(e) => setAddr({ ...addr, line1: e.target.value })} /></label>
                <label className="editor-field"><span className="q-label">Address line 2 (optional)</span>
                  <input className="quiz-input" value={addr.line2 ?? ""} onChange={(e) => setAddr({ ...addr, line2: e.target.value })} /></label>
                <div className="editor-row">
                  <label className="editor-field"><span className="q-label">Postcode</span>
                    <input className="quiz-input" value={addr.postcode ?? ""} onChange={(e) => setAddr({ ...addr, postcode: e.target.value })} /></label>
                  <label className="editor-field"><span className="q-label">City</span>
                    <input className="quiz-input" value={addr.city ?? ""} onChange={(e) => setAddr({ ...addr, city: e.target.value })} /></label>
                </div>
                <label className="editor-field"><span className="q-label">Country</span>
                  <input className="quiz-input" value={addr.country ?? ""} onChange={(e) => setAddr({ ...addr, country: e.target.value })} placeholder="Netherlands" /></label>
                <label className="editor-field"><span className="q-label">Phone (optional)</span>
                  <input className="quiz-input" value={addr.phone ?? ""} onChange={(e) => setAddr({ ...addr, phone: e.target.value })} /></label>
                <div className="intake-actions">
                  <button className="btn-cta" onClick={saveAddr}>Save</button>
                  <button className="btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
                </div>
              </div>
            ) : hasDelivery(delivery) ? (
              <address className="delivery-summary">
                {delivery?.fullName && <div>{delivery.fullName}</div>}
                {delivery?.line1 && <div>{delivery.line1}</div>}
                {delivery?.line2 && <div>{delivery.line2}</div>}
                {(delivery?.postcode || delivery?.city) && <div>{[delivery?.postcode, delivery?.city].filter(Boolean).join(" ")}</div>}
                {delivery?.country && <div>{delivery.country}</div>}
                {delivery?.phone && <div>{delivery.phone}</div>}
              </address>
            ) : (
              <p className="insight-unlocks">Add your delivery address so checkout is quicker later.</p>
            )}
          </div>
        </>
      )}
    </>
  );
}
