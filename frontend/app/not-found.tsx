import Link from "next/link";

export default function NotFound() {
  return (
    <div style={{ padding: "60px 0", textAlign: "center" }}>
      <h1 className="page-title">Not found</h1>
      <p className="page-blurb" style={{ margin: "0 auto 18px" }}>
        This page doesn’t exist, or the product isn’t in our catalogue yet.
      </p>
      <Link href="/" style={{ color: "var(--brand)", fontWeight: 600 }}>
        ← Back to home
      </Link>
    </div>
  );
}
