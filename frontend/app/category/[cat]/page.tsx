import Link from "next/link";
import { notFound } from "next/navigation";
import { fetchCategory, fetchCategoryProducts } from "@/lib/api";
import CategoryBrowse from "@/components/CategoryBrowse";

// Cache the rendered page. Cleared as soon as the ingest job finishes; 3600
// seconds (1 h) is only the backstop. Keep in sync with CATALOG_REVALIDATE in
// lib/catalogCache.ts (Next.js needs a literal number here).
export const revalidate = 3600;

// No pages are built ahead of time; each one is rendered on its first visit and
// then served from cache. Without this, Next.js treats the route as fully
// dynamic and renders it again on every request.
export async function generateStaticParams() {
  return [];
}

// A Server Component that fetches data on the server before rendering.
// `params` is a Promise in the current Next.js App Router — we await it.
export default async function CategoryPage({
  params,
}: {
  params: Promise<{ cat: string }>;
}) {
  const { cat } = await params;

  // The category and its products are fetched at the same time rather than one
  // after the other, so the page waits for the slower of the two, not the sum.
  // Products come straight from the database. This used to be
  // searchProducts("") filtered in JavaScript, which only ever saw the 200
  // oldest products in the whole catalogue and so lost whole categories as
  // the catalogue grew.
  const [page, productPage] = await Promise.all([
    fetchCategory(cat),
    fetchCategoryProducts(cat, { limit: 48 }),
  ]);
  if (!page) notFound();
  const products = productPage?.products ?? [];

  return (
    <>
      <div className="crumb">
        <Link href="/">Home</Link> › <b>{page.name}</b>
      </div>
      <h1 className="page-title">{page.name}</h1>
      <p className="page-blurb">{page.blurb}</p>

      <div className="sub-grid">
        {page.subcategories.map((s) => (
          <Link key={s.id} href={`/category/${cat}/${s.id}`} className="sub-card">
            <h4>{s.name}</h4>
            <div className="sub-tags">
              {s.essentials.slice(0, 3).map((e) => (
                <span key={e} className="sub-tag">{e}</span>
              ))}
            </div>
          </Link>
        ))}
      </div>

      {products.length > 0 && (
        <>
          <h2 className="section-h" style={{ marginTop: 26 }}>
            Products in {page.name.toLowerCase()}
            {productPage && productPage.total > products.length
              ? ` (showing ${products.length} of ${productPage.total})`
              : ""}
          </h2>
          <p className="note" style={{ marginTop: -8, marginBottom: 14 }}>
            Sign in and answer a few questions for picks tailored to you, or just filter by brand and type below —
            no account needed.
          </p>
          <CategoryBrowse
            category={page.category}
            products={products}
            subcategoryNames={Object.fromEntries(page.subcategories.map((s) => [s.id, s.name]))}
          />
        </>
      )}
    </>
  );
}
