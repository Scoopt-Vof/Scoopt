import Link from "next/link";
import { notFound } from "next/navigation";
import { fetchCategory, fetchCategoryProducts } from "@/lib/api";
import CategoryBrowse from "@/components/CategoryBrowse";

// A Server Component that fetches data on the server before rendering.
// `params` is a Promise in the current Next.js App Router — we await it.
export default async function CategoryPage({
  params,
}: {
  params: Promise<{ cat: string }>;
}) {
  const { cat } = await params;
  const page = await fetchCategory(cat);
  if (!page) notFound();

  // Products in this category and everything below it, straight from the
  // database. This used to be searchProducts("") filtered in JavaScript, which
  // only ever saw the 200 oldest products in the whole catalogue and so lost
  // whole categories as the catalogue grew.
  const productPage = await fetchCategoryProducts(cat, { limit: 48 });
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
