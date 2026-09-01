export default function TermsPage() {
  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "48px 24px", lineHeight: 1.6 }}>
      <h1>Terms &amp; Conditions</h1>
      <p><em>Last updated: {new Date().toISOString().slice(0, 10)}</em></p>

      <p>
        These terms govern your use of Scoopt (scoopt.nl). By creating an account
        or using the site, you agree to them. If you don’t agree, please don’t
        use Scoopt.
      </p>

      <h2>1. What Scoopt is</h2>
      <p>
        Scoopt helps you compare prices for products across multiple retailers,
        and gives you personalised buying advice based on what you tell us and
        how you use the site. Scoopt does not sell products itself — when you
        click through to a retailer, you are buying from that retailer under
        their own terms, not ours.
      </p>

      <h2>2. Accounts</h2>
      <p>
        You need an account to save a personalised profile. You’re responsible
        for keeping your login details secure and for anything that happens
        under your account. Tell us if you think someone else has access to it.
      </p>

      <h2>3. Accuracy of prices and availability</h2>
      <p>
        We source prices and stock information from third-party retailers and
        refresh it regularly, but we can’t guarantee it’s always accurate or
        up to date at the exact moment you view it. Always confirm the final
        price and availability on the retailer’s own site before buying.
      </p>

      <h2>4. Affiliate relationships</h2>
      <p>
        Scoopt may earn a commission when you click through to a retailer and
        make a purchase, through affiliate partnerships. This doesn’t change
        the price you pay, and it doesn’t influence which product we consider
        the better match for you — our ranking is based on your stated
        preferences and how you use the site, not on which link pays us more.
      </p>

      <h2>5. Acceptable use</h2>
      <p>
        Don’t misuse Scoopt — including scraping or automating access beyond
        normal use, attempting to interfere with the service, or using it for
        anything unlawful.
      </p>

      <h2>6. Your data</h2>
      <p>
        How we collect and use your data is covered in our{" "}
        <a href="/privacy">Privacy Policy</a>, which forms part of these terms.
      </p>

      <h2>7. Changes</h2>
      <p>
        We may update these terms as Scoopt evolves. If we make a material
        change, we’ll make a reasonable effort to let you know before it takes
        effect.
      </p>

      <h2>8. Termination</h2>
      <p>
        You can stop using Scoopt and delete your account at any time. We may
        suspend or close an account that breaches these terms.
      </p>

      <h2>9. Liability</h2>
      <p>
        Scoopt is provided as a comparison and advice tool. We’re not liable
        for issues arising from a purchase made with a retailer — that
        relationship, and any dispute about it, is between you and them.
      </p>

      <h2>10. Governing law</h2>
      <p>These terms are governed by the laws of the Netherlands.</p>

      <h2>11. Contact</h2>
      <p>Questions about these terms? Email <a href="mailto:hello@scoopt.nl">hello@scoopt.nl</a>.</p>
    </div>
  );
}
