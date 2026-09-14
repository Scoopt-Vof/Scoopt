"use client";
// Global error boundary for the App Router. Any error thrown while rendering a
// route segment (e.g. the backend being unreachable during a server render, or
// BACKEND_URL not being set) lands here instead of Next.js's raw error screen.
// It keeps the shopper on a friendly page with a way to retry.

import { useEffect } from "react";
import Link from "next/link";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface it for debugging; never show the raw message to the shopper.
    console.error(error);
  }, [error]);

  return (
    <div style={{ padding: "60px 0", textAlign: "center" }}>
      <h1 className="page-title">Something went wrong</h1>
      <p className="page-blurb" style={{ margin: "0 auto 18px" }}>
        We couldn&apos;t load this page just now. This is usually temporary —
        please try again in a moment.
      </p>
      <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
        <button className="btn-cta" onClick={() => reset()}>
          Try again
        </button>
        <Link href="/" className="btn-ghost">
          Back to home
        </Link>
      </div>
    </div>
  );
}
