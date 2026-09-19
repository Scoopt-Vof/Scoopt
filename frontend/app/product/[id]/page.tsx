import Link from "next/link";
import { notFound } from "next/navigation";
import { fetchProduct } from "@/lib/api";
import PriceLane from "@/components/PriceLane";
import PriceSignal from "@/components/PriceSignal";
import ForYou from "@/components/ForYou";
import ProductSpecs from "@/components/ProductSpecs";
import TrackView from "@/components/TrackView";
import AddToBasket from "@/components/AddToBasket";

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

export default async function ProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await fetchProduct(id);
  if (!data) notFound();

  const { product, offers } = data;

  return (
    <>
      <TrackView productId={product.id} category={product.category} />
      <div className="crumb">
        <Link href="/">Home</Link> ›{" "}
        <Link href={`/category/${product.category}`}>{product.category}</Link> ›{" "}
        <b>{product.name}</b>
      </div>

      {/* Two columns on wide screens: image on the left, everything about the
          product on the right (name, why it fits you, specs, add to basket).
          The price comparison sits full width below. Stacks on mobile. */}
      <div className="product-top">
        <div className="product-media">
          {product.image ? (
            <img src={product.image} alt={product.name} className="product-image" />
          ) : (
            <div className="product-image product-image-empty" aria-hidden="true" />
          )}
        </div>

        <div className="product-info">
          <h1 className="page-title">{product.name}</h1>
          <p className="page-blurb">
            {product.brand} · {product.unit}
          </p>

          {product.description && (
            <p className="product-description">{product.description}</p>
          )}

          <ForYou product={product} />

          <ProductSpecs specs={product.specs} />

          <AddToBasket productId={product.id} category={product.category} />
        </div>
      </div>

      <div className="product-prices">
        <p className="note">Price per store, cheapest first</p>
        <PriceLane offers={offers} />
        <PriceSignal productId={product.id} />
      </div>
    </>
  );
}
