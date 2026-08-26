import Link from "next/link";

// The home page is a Server Component (the default in Next's App Router).
// It renders on the server, which is exactly what we want for SEO.
const CATEGORIES = [
  { id: "home", name: "Home & furniture", blurb: "Furnish every room and compare the same sofa or bed frame across every store." },
  { id: "sport", name: "Sport", blurb: "Find the right gear for the sport you actually do — from your first running shoes to a home gym." },
  { id: "tech", name: "Technology", blurb: "See what a laptop or phone really costs across every major store." },
];

export default function HomePage() {
  return (
    <>
      <section className="hero">
        <h1>
          Reward the shopper who <span>does their homework.</span>
        </h1>
        <p>
          Scoopt brings the price, the buying advice and the checkout together in one
          place — so shopping smart is also the easiest way to shop.
        </p>
        <Link href="/signup" className="btn-cta hero-cta">
          Personalise Scoopt for you →
        </Link>
        <p className="hero-sub">1 minute · tailored advice based on what matters to you</p>
      </section>

      <div className="cat-cards">
        {CATEGORIES.map((c) => (
          <Link key={c.id} href={`/category/${c.id}`} className="cat-card">
            <h3>{c.name}</h3>
            <p>{c.blurb}</p>
          </Link>
        ))}
      </div>
    </>
  );
}
