"use client";
// Sign-in / sign-up screen. Email + password (real Supabase Auth), plus
// Google/Apple buttons (still fake — see lib/auth.ts SWAP POINT). New
// sign-ups must confirm their email before continuing into the questionnaire.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  signInWithEmail, signUpWithEmail, signInWithProvider, subscribe,
} from "@/lib/auth";
import { hasProfile } from "@/lib/profile";

export default function AccountPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pendingConfirmation, setPendingConfirmation] = useState(false);

  // If a real session appears while we're on this page (e.g. the user
  // clicked the confirmation-email link, which lands them back here), move
  // them on automatically instead of leaving them stuck on the form.
  useEffect(() => {
    return subscribe((account) => {
      if (account) {
        setPendingConfirmation(false);
        router.push(hasProfile() ? "/profile" : "/signup");
      }
    });
  }, [router]);

  function afterAuth() {
    router.push(hasProfile() ? "/profile" : "/signup");
  }

  async function onEmailSubmit() {
    setError("");
    if (!email.trim() || !password) { setError("Enter your email and a password."); return; }
    if (mode === "signup" && !agreedToTerms) {
      setError("Please accept the Terms & Conditions to continue.");
      return;
    }
    setBusy(true);
    try {
      if (mode === "signup") {
        const { needsConfirmation } = await signUpWithEmail(
          email.trim(), password, name.trim() || undefined
        );
        if (needsConfirmation) setPendingConfirmation(true);
        else afterAuth();
      } else {
        await signInWithEmail(email.trim(), password);
        afterAuth();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function onProvider(p: "google" | "apple") {
    if (mode === "signup" && !agreedToTerms) {
      setError("Please accept the Terms & Conditions to continue.");
      return;
    }
    setBusy(true);
    try {
      await signInWithProvider(p);
      afterAuth();
    } finally {
      setBusy(false);
    }
  }

  if (pendingConfirmation) {
    return (
      <div className="auth-wrap">
        <div className="auth-card">
          <h1 className="auth-title">Check your inbox</h1>
          <p className="auth-sub">
            We’ve sent a confirmation link to <strong>{email}</strong>. Click it to
            activate your account — this page will pick up automatically once
            you do.
          </p>
          <p className="auth-guest">
            <Link href="/" className="auth-link">Keep browsing as a guest</Link>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <h1 className="auth-title">
          {mode === "signup" ? "Create your Scoopt account" : "Welcome back"}
        </h1>
        <p className="auth-sub">
          {mode === "signup"
            ? "Save your profile and get buying advice tailored to you."
            : "Sign in to pick up where you left off."}
        </p>

        <div className="oauth-row">
          <button className="oauth-btn" onClick={() => onProvider("google")} disabled={busy}>
            <span className="oauth-mark" aria-hidden>G</span> Continue with Google
          </button>
          <button className="oauth-btn" onClick={() => onProvider("apple")} disabled={busy}>
            <span className="oauth-mark" aria-hidden></span> Continue with Apple
          </button>
        </div>

        <div className="auth-divider"><span>or</span></div>

        {mode === "signup" && (
          <div className="auth-field">
            <label>Name (optional)</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your first name" />
          </div>
        )}
        <div className="auth-field">
          <label>Email</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" />
        </div>
        <div className="auth-field">
          <label>Password</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
        </div>

        {mode === "signup" && (
          <label className="auth-terms">
            <input
              type="checkbox"
              checked={agreedToTerms}
              onChange={(e) => setAgreedToTerms(e.target.checked)}
            />
            <span>
              I agree to the <Link href="/terms" className="auth-link">Terms &amp; Conditions</Link>{" "}
              and <Link href="/privacy" className="auth-link">Privacy Policy</Link>.
            </span>
          </label>
        )}

        {error && <p className="auth-error">{error}</p>}

        <button
          className="btn-cta auth-submit"
          onClick={onEmailSubmit}
          disabled={busy || (mode === "signup" && !agreedToTerms)}
        >
          {busy ? "Please wait…" : mode === "signup" ? "Create account" : "Sign in"}
        </button>

        <p className="auth-switch">
          {mode === "signup" ? "Already have an account?" : "New to Scoopt?"}{" "}
          <button className="auth-link" onClick={() => setMode(mode === "signup" ? "signin" : "signup")}>
            {mode === "signup" ? "Sign in" : "Create one"}
          </button>
        </p>

        <p className="auth-guest">
          <Link href="/" className="auth-link">Keep browsing as a guest</Link>
        </p>
      </div>

      <p className="auth-privacy">
        Your data is yours. We use it to give you better buying advice — never sold
        as your identity. You can view or delete it any time.
      </p>
    </div>
  );
}
