import Link from "next/link";
import { notFound } from "next/navigation";
import { fetchCategory, searchProducts } from "@/lib/api";
import PersonalisedGrid from "@/components/PersonalisedGrid";

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

  // Show a few example products from this category too (fake data for now).
  const all = await searchProducts("");
  const products = all.filter((p) => p.category === page.category);

  return (
    <>
      <div className="crumb">
        <Link href="/">Home</Link> › <b>{page.name}</b>
      </div>
      <h1 className="page-title">{page.name}</h1>
      <p className="page-blurb">{page.blurb}</p>

      <div className="sub-grid">
        {page.subcategories.map((s) => (
          <div key={s.id} className="sub-card">
            <h4>{s.name}</h4>
            <div className="sub-tags">
              {s.essentials.slice(0, 3).map((e) => (
                <span key={e} className="sub-tag">{e}</span>
              ))}
            </div>
          </div>
        ))}
      </div>

      {products.length > 0 && (
        <>
          <h2 className="section-h" style={{ marginTop: 26 }}>
            Products in {page.name.toLowerCase()}
          </h2>
          <PersonalisedGrid products={products} />
        </>
      )}
    </>
  );
}
