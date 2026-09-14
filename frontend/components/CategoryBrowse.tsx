"use client";
// Anonymous-friendly browsing for the three main category pages: filter the
// raw product grid by brand and by type (subcategory), no sign-in and no
// questionnaire required. This sits alongside the personalisation the rest
// of the site does — day-to-day, not-signed-in visitors get this instead.
//
// "Type" also lets a shopper add their OWN label (e.g. "Winter gear") when
// the built-in subcategories don't capture how they think about it. There is
// no backend tagging system behind this: a custom type is a saved keyword
// that matches against the product's name, brand, unit, specs and
// description — a personal, browser-local way to slice the grid, not a real
// taxonomy change. It's saved per category (localStorage) so it's there
// again next visit, and any shopper can remove one they added.

import { useEffect, useMemo, useState } from "react";
import PersonalisedGrid from "@/components/PersonalisedGrid";
import type { Category, Product } from "@/contract/types";

const ALL = "__all__";

function customTypesKey(category: Category): string {
  return `scoopt.customTypes.${category}.v1`;
}

function loadCustomTypes(category: Category): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(customTypesKey(category));
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function saveCustomTypes(category: Category, types: string[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(customTypesKey(category), JSON.stringify(types));
  } catch {
    /* storage blocked/full — best effort */
  }
}

function humanize(id: string): string {
  return id.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// Keyword match for a custom type — the only real signal we have without a
// proper tagging system. Checks the readable text a product actually carries.
function matchesKeyword(product: Product, keyword: string): boolean {
  const needle = keyword.trim().toLowerCase();
  if (!needle) return false;
  const haystacks = [
    product.name,
    product.brand,
    product.unit,
    product.subcategory,
    product.description ?? "",
    ...Object.entries(product.specs ?? {}).flat(),
  ];
  return haystacks.some((h) => h.toLowerCase().includes(needle));
}

export default function CategoryBrowse({
  category,
  products,
  subcategoryNames,
}: {
  category: Category;
  products: Product[];
  subcategoryNames: Record<string, string>;
}) {
  const [brand, setBrand] = useState(ALL);
  const [type, setType] = useState(ALL);
  const [customTypes, setCustomTypes] = useState<string[]>([]);
  const [addingType, setAddingType] = useState(false);
  const [newType, setNewType] = useState("");

  useEffect(() => {
    setCustomTypes(loadCustomTypes(category));
  }, [category]);

  const brands = useMemo(
    () => Array.from(new Set(products.map((p) => p.brand))).filter(Boolean).sort(),
    [products]
  );

  const builtInTypes = useMemo(() => {
    const ids = Array.from(new Set(products.map((p) => p.subcategory))).filter(Boolean);
    return ids.map((id) => ({ id, name: subcategoryNames[id] ?? humanize(id) }));
  }, [products, subcategoryNames]);

  function addCustomType() {
    const label = newType.trim();
    if (!label) return;
    const existing = customTypes.find((t) => t.toLowerCase() === label.toLowerCase());
    if (!existing) {
      const next = [...customTypes, label];
      setCustomTypes(next);
      saveCustomTypes(category, next);
    }
    setType(existing ?? label);
    setAddingType(false);
    setNewType("");
  }

  function removeCustomType(label: string) {
    const next = customTypes.filter((t) => t !== label);
    setCustomTypes(next);
    saveCustomTypes(category, next);
    if (type === label) setType(ALL);
  }

  const filtered = useMemo(() => {
    return products.filter((p) => {
      if (brand !== ALL && p.brand !== brand) return false;
      if (type !== ALL) {
        const isBuiltIn = builtInTypes.some((t) => t.id === type);
        if (isBuiltIn ? p.subcategory !== type : !matchesKeyword(p, type)) return false;
      }
      return true;
    });
  }, [products, brand, type, builtInTypes]);

  const hasFilters = brand !== ALL || type !== ALL;

  return (
    <>
      <div className="cat-filters">
        <label className="cat-filter">
          <span className="q-label">Brand</span>
          <select className="quiz-input" value={brand} onChange={(e) => setBrand(e.target.value)}>
            <option value={ALL}>All brands</option>
            {brands.map((b) => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>
        </label>

        <div className="cat-filter cat-filter-type">
          <span className="q-label">Type</span>
          <div className="cat-type-chips">
            <button
              type="button"
              className={`cat-type-chip${type === ALL ? " active" : ""}`}
              onClick={() => setType(ALL)}
            >
              All types
            </button>
            {builtInTypes.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`cat-type-chip${type === t.id ? " active" : ""}`}
                onClick={() => setType(t.id)}
              >
                {t.name}
              </button>
            ))}
            {customTypes.map((t) => (
              <span key={t} className={`cat-type-chip cat-type-custom${type === t ? " active" : ""}`}>
                <button type="button" onClick={() => setType(t)}>
                  {t}
                </button>
                <button type="button" className="cat-type-remove" aria-label={`Remove ${t}`} onClick={() => removeCustomType(t)}>
                  ×
                </button>
              </span>
            ))}
            {addingType ? (
              <span className="cat-type-add-form">
                <input
                  className="cat-type-add-input"
                  value={newType}
                  onChange={(e) => setNewType(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); addCustomType(); }
                    if (e.key === "Escape") { setAddingType(false); setNewType(""); }
                  }}
                  placeholder="e.g. Winter gear"
                  autoFocus
                />
                <button type="button" className="btn-ghost" onClick={addCustomType}>
                  Add
                </button>
              </span>
            ) : (
              <button type="button" className="cat-type-chip cat-type-add" onClick={() => setAddingType(true)}>
                + Add your own
              </button>
            )}
          </div>
        </div>

        {hasFilters && (
          <button type="button" className="btn-ghost cat-filter-clear" onClick={() => { setBrand(ALL); setType(ALL); }}>
            Clear filters
          </button>
        )}
      </div>

      <p className="note" style={{ marginTop: -2 }}>
        {filtered.length === products.length ? `${products.length} products` : `${filtered.length} of ${products.length} products`}
      </p>

      {filtered.length > 0 ? (
        <PersonalisedGrid products={filtered} />
      ) : (
        <p className="note">No products match these filters right now.</p>
      )}
    </>
  );
}
