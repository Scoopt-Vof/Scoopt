import Link from "next/link";
import { notFound } from "next/navigation";
import { fetchProduct } from "@/lib/api";
import PriceLane from "@/components/PriceLane";
import PriceSignal from "@/components/PriceSignal";
import ForYou from "@/components/ForYou";
import TrackView from "@/components/TrackView";
import AddToBasket from "@/components/AddToBasket";

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

      <h1 className="page-title">{product.name}</h1>
      <p className="page-blurb">
        {product.brand} · {product.unit}
      </p>

      <ForYou product={product} />

      <p className="note">Price per store, cheapest first · sample data</p>
      <PriceLane offers={offers} />
      <PriceSignal productId={product.id} />
      <AddToBasket productId={product.id} category={product.category} />
    </>
  );
}
