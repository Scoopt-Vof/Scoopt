// Privacy notice. Plain page, no interactivity, so it stays a server component.
//
// "Who we are" is deliberately generic: Scoopt is not yet registered with the
// KvK (see /people or ask Josh/Larry for the latest), so this notice does NOT
// claim a formal entity, a KvK number or a registered office it doesn't have.
// Once registration completes, update this section with the real details —
// don't just paste in a KvK number without updating the surrounding wording.

export const metadata = {
  title: "Privacy notice · Scoopt",
  description: "How Scoopt collects, uses and protects your personal data.",
};

export default function PrivacyPage() {
  return (
    <div className="legal">
      <h1 className="page-title">Privacy notice</h1>
      <p className="legal-updated">Last updated: {new Date().toISOString().slice(0, 10)}</p>

      <p>
        This notice explains what personal data Scoopt collects, why we collect it,
        and what rights you have. We have tried to write it plainly rather than in
        legal language.
      </p>

      <h2>Who we are</h2>
      <p>
        Scoopt is a shopping platform covering three categories &mdash; Sport, Home
        &amp; Furniture, and Technology &mdash; run by its founders from Amsterdam,
        the Netherlands. We are the controller of the personal data described in
        this notice, and you can reach us at{" "}
        <a href="mailto:hello@scoopt.nl">hello@scoopt.nl</a>. Scoopt is not yet
        registered with the Dutch Chamber of Commerce (KvK); we will update this
        section with our registration details once that is complete.
      </p>

      <h2>What we collect</h2>
      <p>
        <strong>Account details.</strong> If you create an account, we store your
        email address and, if you give it, your first name. Your password is
        handled by our authentication provider and stored only as an encrypted
        hash. We never see or store your password itself.
      </p>
      <p>
        <strong>Your shopping profile.</strong> The answers you give in our
        questionnaire, such as the categories you shop in, your budget range and
        what matters most to you when buying. You choose what to tell us, and you
        can change or remove it at any time.
      </p>
      <p>
        <strong>How you use the site.</strong> Which products you view, which
        offers you click through to, and what you add to your basket. We use this
        to improve the advice we give you and to understand which parts of the
        site are useful.
      </p>
      <p>
        <strong>Technical data.</strong> Standard information your browser sends,
        such as your approximate location, device type and pages visited, collected
        through our hosting and analytics providers.
      </p>

      <h2>Why we use it, and our legal basis</h2>
      <ul>
        <li>
          <strong>To run your account and give you personalised advice.</strong>{" "}
          This is necessary to provide the service you asked for (performance of a
          contract).
        </li>
        <li>
          <strong>To improve the site and understand what shoppers need.</strong>{" "}
          We have a legitimate interest in making Scoopt more useful, balanced
          against your privacy.
        </li>
        <li>
          <strong>To send you emails about your account,</strong> such as
          confirming your address or resetting your password. Necessary to provide
          the service.
        </li>
        <li>
          <strong>Non-essential cookies and analytics.</strong> Only with your
          consent, which you can withdraw at any time.
        </li>
      </ul>

      <h2>How we make money, and what that means for your data</h2>
      <p>
        When you click through to a retailer and buy something, we may earn a
        commission at no extra cost to you. Retailers may be told that a purchase
        came from Scoopt, but we do not sell your personal data, and we do not
        share your identity or your shopping profile with them.
      </p>
      <p>
        Commission never affects what we recommend or how we rank offers. The best
        option for you is always the one we show first.
      </p>

      <h2>Who we share it with</h2>
      <p>
        We use a small number of service providers who process data on our behalf,
        under written agreements: our database and authentication provider, our
        hosting provider, and our analytics provider. We do not sell your personal
        data to anyone.
      </p>
      <p>
        Where a provider processes data outside the European Economic Area, that
        transfer is covered by the safeguards required under the GDPR.
      </p>

      <h2>How long we keep it</h2>
      <p>
        We keep your account and profile data for as long as your account is open.
        If you delete your account, we delete your personal data within 30 days,
        except where we are required to keep records for tax or legal reasons.
        Usage data is kept in aggregated form that no longer identifies you.
      </p>

      <h2>Your rights</h2>
      <p>You have the right to:</p>
      <ul>
        <li>ask for a copy of the personal data we hold about you;</li>
        <li>have inaccurate data corrected;</li>
        <li>have your data deleted;</li>
        <li>object to, or ask us to restrict, certain uses of your data;</li>
        <li>withdraw consent where we rely on it;</li>
        <li>ask us to transfer your data to another service.</li>
      </ul>
      <p>
        To exercise any of these, email us at{" "}
        <a href="mailto:hello@scoopt.nl">hello@scoopt.nl</a>. If you are not happy
        with how we handle your request, you can complain to the Dutch data
        protection authority, the Autoriteit Persoonsgegevens.
      </p>

      <h2>Cookies</h2>
      <p>
        We explain the cookies we use in our <a href="/cookies">cookie notice</a>.
      </p>

      <h2>Changes to this notice</h2>
      <p>
        If we change this notice materially, we will say so on the site and update
        the date at the top.
      </p>
    </div>
  );
}
