// Route-level loading UI. Shown automatically while a server component segment
// (product, search, category pages) is fetching, so the shopper sees an honest
// "loading" state instead of a blank screen or a hang.

export default function Loading() {
  return (
    <div style={{ padding: "60px 0", textAlign: "center" }}>
      <p className="note">Loading…</p>
    </div>
  );
}
