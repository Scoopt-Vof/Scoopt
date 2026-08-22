"use client";
// Header search box. Calls GET /api/search?q= (debounced) and shows a live
// dropdown of matches. The endpoint returns fake results today; when Larry
// swaps in real matching behind it, this UI is unchanged — it only depends on
// the Product[] shape.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { searchProducts } from "@/lib/api";
import type { Product } from "@/contract/types";

export default function SearchBox() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Product[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(-1); // keyboard-highlighted row
  const boxRef = useRef<HTMLDivElement>(null);

  // Debounce: wait 250ms after the last keystroke before querying, so we don't
  // fire a request on every character.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const t = setTimeout(() => {
      searchProducts(term)
        .then((r) => {
          setResults(r.slice(0, 6));
          setActive(-1);
        })
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  // Close the dropdown when clicking outside.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  function go(productId: string) {
    setOpen(false);
    setQ("");
    router.push(`/product/${productId}`);
  }

  function submit() {
    const term = q.trim();
    if (!term) return;
    setOpen(false);
    router.push(`/search?q=${encodeURIComponent(term)}`);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, -1)); }
    else if (e.key === "Enter") {
      if (active >= 0 && results[active]) go(results[active].id);
      else submit();
    } else if (e.key === "Escape") { setOpen(false); }
  }

  return (
    <div className="search-box" ref={boxRef}>
      <span className="search-icon" aria-hidden>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
        </svg>
      </span>
      <input
        className="search-input"
        placeholder="Search a product or brand…"
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        aria-label="Search"
      />
      {open && q.trim().length >= 2 && (
        <div className="search-drop">
          {loading && <div className="search-msg">Searching…</div>}
          {!loading && results.length === 0 && (
            <div className="search-msg">No matches — try fewer or different words.</div>
          )}
          {!loading &&
            results.map((p, i) => (
              <button
                key={p.id}
                className={`search-hit ${i === active ? "active" : ""}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => go(p.id)}
              >
                <span className="hit-name">{p.name}</span>
                <span className="hit-brand">{p.brand}</span>
              </button>
            ))}
          {!loading && results.length > 0 && (
            <button className="search-all" onClick={submit}>
              See all results for “{q.trim()}” →
            </button>
          )}
        </div>
      )}
    </div>
  );
}
