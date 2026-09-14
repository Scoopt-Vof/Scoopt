import Link from "next/link";
import { CATEGORIES } from "@/lib/categories";
import type { Category } from "@/contract/types";

// Server component (renders on the server, good for SEO). All imagery here is
// inline SVG so there are no external assets to manage; real photos can drop in
// later. Item 1 on the action list: friendlier visuals, info tiles that don't
// look like buttons, and warmer, shorter copy.

const svg = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

const CATEGORY_ICON: Record<Category, React.ReactNode> = {
  home: (<svg {...svg} width="30" height="30"><path d="M3 11l9-8 9 8" /><path d="M5 10v10h14V10" /></svg>),
  sport: (<svg {...svg} width="30" height="30"><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></svg>),
  tech: (<svg {...svg} width="30" height="30"><rect x="3" y="5" width="18" height="12" rx="1" /><path d="M2 21h20" /></svg>),
};

const TOOLS: { title: string; body: string; tint: string; icon: React.ReactNode }[] = [
  {
    title: "Advice that knows you",
    body: "A few quick questions, and every product comes with a plain reason it suits you, like “fits your budget” or “great for a beginner”.",
    tint: "tint-blue",
    icon: (<svg {...svg} width="24" height="24"><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /></svg>),
  },
  {
    title: "Honest price signals",
    body: "We only call something a good deal when it truly is, like its lowest price in 30 days. No invented discounts.",
    tint: "tint-green",
    icon: (<svg {...svg} width="24" height="24"><path d="M3 3h7l11 11-7 7L3 10z" /><circle cx="7.5" cy="7.5" r="1.4" /></svg>),
  },
  {
    title: "Smarter baskets",
    body: "Sometimes splitting an order across shops saves money, sometimes it doesn’t. We do the maths, delivery included, and tell you which wins.",
    tint: "tint-orange",
    icon: (<svg {...svg} width="24" height="24"><path d="M5 7h15l-1.5 9h-12z" /><circle cx="9" cy="20" r="1.2" /><circle cx="17" cy="20" r="1.2" /></svg>),
  },
  {
    title: "Real photos and specs",
    body: "Proper manufacturer images and the details you actually want to read, in place of generic placeholders.",
    tint: "tint-purple",
    icon: (<svg {...svg} width="24" height="24"><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8.5" cy="9.5" r="1.5" /><path d="M21 16l-5-5-6 6" /></svg>),
  },
];

export default function HomePage() {
  return (
    <>
      <section className="hero">
        <h1>
          Know what to buy. <span>Then buy it for less.</span>
        </h1>
        <p>
          Scoopt is the shop assistant the internet forgot. Tell us what you’re after,
          get honest advice on what’s actually right for you, then the best price to buy it.
        </p>
        <Link href="/signup" className="btn-cta hero-cta">
          Build my profile →
        </Link>
        <p className="hero-sub">About a minute · advice tuned to what matters to you</p>
      </section>

      <div className="cat-cards">
        {CATEGORIES.map((c) => (
          <Link key={c.id} href={`/category/${c.id}`} className="cat-card">
            <span className="cat-icon" aria-hidden>{CATEGORY_ICON[c.id]}</span>
            <h3>{c.label}</h3>
            <p>{c.blurb}</p>
            <span className="cat-go">Explore →</span>
          </Link>
        ))}
      </div>

      <section className="vision-section">
        <h2 className="section-h">Advice first. Price last.</h2>
        <p>
          The internet made shopping cheap and fast, but it lost the person on the shop
          floor who actually knew the products and helped you choose. Scoopt brings that
          person back, online, for everyone.
        </p>
        <p>
          We start with what you’re trying to do, narrow the wall of options down to the
          right few, and help you decide. Only then do we find you the best price. The
          price check is the last step, not the whole thing.
        </p>
        <p>
          Our advice always serves you, never the highest bidder. We earn a small
          commission when you buy through us, at no extra cost, and it never changes what
          we recommend.
        </p>
      </section>

      <section className="tools-section">
        <h2 className="section-h">Your shop assistant, piece by piece</h2>
        <p className="tools-intro">Small parts of it are already working today.</p>
        <div className="tools-grid">
          {TOOLS.map((tool) => (
            <div key={tool.title} className={`tool-card ${tool.tint}`}>
              <span className="tool-icon" aria-hidden>{tool.icon}</span>
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
          <a href="mailto:hello@scoopt.nl">hello@scoopt.nl</a> and we’ll get back to you.
        </p>
      </section>
    </>
  );
}
