"use client";
// ============================================================================
//  AUTH CALLBACK  — where the confirmation-email link lands.
// ----------------------------------------------------------------------------
//  Supabase sends the confirmation email with emailRedirectTo pointing here.
//  When the user clicks the link they arrive with one of a few possible URL
//  shapes depending on the project's email template / flow:
//
//    • implicit flow    →  #access_token=...&refresh_token=...   (hash)
//    • PKCE flow        →  ?code=...
//    • verifyOtp flow   →  ?token_hash=...&type=signup
//
//  This page finalises whichever one it gets, confirms a real session exists,
//  then sends the user on to their profile (or the questionnaire if they have
//  no profile yet). Getting all of this in one place is what makes email
//  confirmation reliably log the user in — the rest of the app just reads the
//  session that lands here.
//
//  IMPORTANT (Supabase dashboard): this page's URL must be listed under
//  Authentication → URL Configuration → "Redirect URLs" for every domain you
//  use, e.g. https://scoopt.nl/auth/callback and your *.vercel.app previews,
//  plus http://localhost:3000/auth/callback for local dev. If it isn't,
//  Supabase silently redirects to the Site URL instead and the tokens never
//  reach this page — which looks exactly like "it didn't log me in".
// ============================================================================

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { loadProfileAsync } from "@/lib/profile";

export default function AuthCallbackPage() {
  const router = useRouter();
  const [failed, setFailed] = useState(false);
  const [message, setMessage] = useState(
    "We couldn't confirm your account automatically."
  );

  useEffect(() => {
    let cancelled = false;

    async function finalize() {
      try {
        const url = new URL(window.location.href);
        const q = url.searchParams;
        const hash = new URLSearchParams(url.hash.replace(/^#/, ""));

        // Supabase may append an explicit error (e.g. expired link).
        const errDesc = q.get("error_description") || hash.get("error_description");
        if (errDesc) throw new Error(errDesc);

        const tokenHash = q.get("token_hash");
        // verifyOtp accepts these email OTP types; typed locally to avoid depending
        // on the exact named export across supabase-js versions.
        const type = q.get("type") as
          | "signup" | "invite" | "magiclink" | "recovery" | "email_change" | "email"
          | null;
        const code = q.get("code");

        if (tokenHash && type) {
          // Newer, cross-browser-safe template: verify the one-time token.
          const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
          if (error) throw error;
        } else if (code) {
          // PKCE: exchange the code for a session (needs this browser's verifier).
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
        }
        // else: implicit hash tokens — detectSessionInUrl handles them; we just
        // wait for the session to appear below.

        // Confirm a session really exists. detectSessionInUrl is async, so poll
        // briefly rather than assuming it has finished by now.
        let session = null;
        for (let i = 0; i < 25 && !session; i++) {
          const { data } = await supabase.auth.getSession();
          session = data.session;
          if (!session) await new Promise((r) => setTimeout(r, 150));
        }
        if (!session) throw new Error("no-session");
        if (cancelled) return;

        // Strip the tokens from the address bar so a refresh or bookmark of
        // this page is harmless.
        window.history.replaceState({}, "", "/auth/callback");

        const profile = await loadProfileAsync();
        if (cancelled) return;
        router.replace(profile ? "/profile" : "/signup");
      } catch (e) {
        if (cancelled) return;
        if (e instanceof Error && e.message && e.message !== "no-session") {
          setMessage(e.message);
        }
        setFailed(true);
      }
    }

    finalize();
    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        {!failed ? (
          <>
            <h1 className="auth-title">Confirming your account…</h1>
            <p className="auth-sub">
              One moment while we sign you in. This only takes a second.
            </p>
          </>
        ) : (
          <>
            <h1 className="auth-title">Almost there</h1>
            <p className="auth-sub">{message}</p>
            <p className="auth-sub">
              Your email may already be confirmed. Try signing in with the email
              and password you chose.
            </p>
            <Link href="/account" className="btn-cta auth-submit" style={{ display: "inline-block", textAlign: "center" }}>
              Go to sign in
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
