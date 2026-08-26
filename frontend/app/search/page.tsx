import Link from "next/link";
import { searchProducts } from "@/lib/api";
import PersonalisedGrid from "@/components/PersonalisedGrid";

// Full search results page. Server Component: it reads the ?q= query param,
// fetches matches from the search endpoint, and hands them to the personalised
// grid (so results are also ranked to the shopper if they have a profile).
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const term = (q ?? "").trim();
  const results = term ? await searchProducts(term) : [];

  return (
    <>
      <div className="crumb">
        <Link href="/">Home</Link> › <b>Search</b>
      </div>

      <h1 className="page-title">
        {term ? `Results for “${term}”` : "Search"}
      </h1>

      {!term && (
        <p className="page-blurb">Type in the search box above to find products across every store.</p>
      )}

      {term && results.length === 0 && (
        <div className="empty-state">
          <p className="page-blurb" style={{ marginBottom: 8 }}>
            No products match “{term}” yet.
          </p>
          <p className="note">
            Try fewer words or a brand name. Our catalogue is deliberately narrow
            at launch — we add products as we can price them accurately.
          </p>
          <Link href="/" className="btn-cta" style={{ display: "inline-block", marginTop: 14 }}>
            Back to home
          </Link>
        </div>
      )}

      {term && results.length > 0 && (
        <>
          <p className="page-blurb">
            {results.length} {results.length === 1 ? "product" : "products"} found.
          </p>
          <PersonalisedGrid products={results} />
        </>
      )}
    </>
  );
}
