// Cookie notice. Plain page, no interactivity, so it stays a server component.
//
// IMPORTANT: fill in the bracketed placeholders before real users see this, and
// keep the table honest. If you add an analytics or advertising tool later, it
// must be listed here BEFORE it starts running.

export const metadata = {
  title: "Cookie notice · Scoopt",
  description: "The cookies Scoopt uses and how to control them.",
};

export default function CookiesPage() {
  return (
    <div className="legal">
      <h1 className="page-title">Cookie notice</h1>
      <p className="legal-updated">Last updated: [DATE]</p>

      <p>
        Cookies are small files stored on your device. This page explains which
        ones Scoopt uses and how you can control them. For everything else about
        your data, see our <a href="/privacy">privacy notice</a>.
      </p>

      <h2>Essential cookies</h2>
      <p>
        These are needed for the site to work, so they are always on. Without them
        you could not stay signed in or keep a basket between pages.
      </p>
      <ul>
        <li>
          <strong>Sign-in session.</strong> Keeps you signed in as you move around
          the site. Set by our authentication provider.
        </li>
        <li>
          <strong>Your preferences.</strong> Remembers your basket and your
          questionnaire answers so the site works as you expect.
        </li>
        <li>
          <strong>Security.</strong> Helps protect against fraudulent requests.
        </li>
      </ul>

      <h2>Analytics cookies</h2>
      <p>
        These help us understand which parts of the site are useful, so we can
        improve them. They are only set if you agree, and you can change your mind
        at any time.
      </p>
      <ul>
        <li>
          <strong>Usage measurement.</strong> Counts visits and shows us which
          pages and features people actually use. We look at this in aggregate, not
          to identify individuals.
        </li>
      </ul>

      <h2>Affiliate tracking</h2>
      <p>
        When you click through to a retailer, that retailer or their affiliate
        network may set a cookie so they can tell the visit came from Scoopt. This
        is how we earn a commission, at no extra cost to you. Those cookies are set
        by the retailer, on their own site, and are governed by their privacy
        policy rather than ours.
      </p>
      <p>
        We do not use tracking that follows you around other websites for
        advertising purposes.
      </p>

      <h2>What we do not do</h2>
      <p>
        We do not use advertising cookies, we do not build profiles of you for
        third parties, and we do not sell your data. The shopper is our customer,
        never our product.
      </p>

      <h2>Controlling cookies</h2>
      <p>
        You can change your choice at any time using the cookie settings on this
        site. You can also block or delete cookies through your browser settings,
        though blocking essential cookies will stop parts of the site working.
      </p>

      <h2>Questions</h2>
      <p>
        If anything here is unclear, email us at [CONTACT EMAIL] and we will
        explain it properly.
      </p>
    </div>
  );
}
