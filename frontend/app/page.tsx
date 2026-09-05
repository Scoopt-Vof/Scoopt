import Link from "next/link";

// The home page is a Server Component (the default in Next's App Router).
// It renders on the server, which is exactly what we want for SEO.
const CATEGORIES = [
  { id: "home", name: "Home & furniture", blurb: "Furnish every room and compare the same sofa or bed frame across every store." },
  { id: "sport", name: "Sport", blurb: "Find the right gear for the sport you actually do, from your first running shoes to a home gym." },
  { id: "tech", name: "Technology", blurb: "See what a laptop or phone really costs across every major store." },
];

const TOOLS = [
  {
    title: "Personalised recommendations",
    body: "A short questionnaire matches products to you, with a plain reason for every pick, like “fits your budget” or “right for a beginner”.",
  },
  {
    title: "Honest price signals",
    body: "We tell you when something is genuinely cheap, such as its lowest price in 30 days, instead of a fake discount.",
  },
  {
    title: "Smart basket splitting",
    body: "Buying from several stores can save money, but not always. We compare the full basket and tell you honestly which way wins.",
  },
  {
    title: "Real product photos and specs",
    body: "Manufacturer images and details in place of generic placeholders, so you know exactly what you're buying.",
  },
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
          place, so shopping smart is also the easiest way to shop.
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

      <section className="vision-section">
        <h2 className="section-h">Advice first. Price last.</h2>
        <p>
          The internet made shopping cheaper and faster, but it took something away:
          the person on the shop floor who actually knew the products, asked what you
          were trying to do, and steered you to the right choice. Scoopt puts that
          person back, for everyone, online.
        </p>
        <p>
          We start by understanding what you're trying to do, then advise you
          honestly on the right handful of options, and help you decide with
          confidence. Only then do we show you where to buy it for the best price.
          The price comparison is the last step of a longer journey, not the whole
          product.
        </p>
        <p>
          Our advice always serves you, never the highest bidder. We earn a
          commission when you buy through us, at no extra cost to you, and it never
          changes what we recommend or how we rank offers.
        </p>
      </section>

      <section className="tools-section">
        <h2 className="section-h">Tools we're building for you</h2>
        <p className="tools-intro">Small pieces of the shop assistant you can already use today.</p>
        <div className="tools-grid">
          {TOOLS.map((tool) => (
            <div key={tool.title} className="tool-card">
              <h4>{tool.title}</h4>
              <p>{tool.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="contact-section">
        <h2 className="section-h">Get in touch</h2>
        <p>
          Questions, feedback, or a partnership idea? Email us at{" "}
          <a href="mailto:hello@scoopt.com">hello@scoopt.com</a> and we'll get back
          to you.
        </p>
      </section>
    </>
  );
}
