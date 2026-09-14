"use client";
// Sign-in / sign-up screen. Email + password via real Supabase Auth. New
// sign-ups must confirm their email before continuing into the questionnaire.
// Returning shoppers on a new device have their saved profile pulled from
// Supabase (see lib/profile.ts) rather than being sent through the quiz again.
//
// Google/Apple sign-in isn't wired up yet — see lib/auth.ts's
// signInWithProvider SWAP POINT for what real OAuth needs before those
// buttons come back.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { signInWithEmail, signUpWithEmail, subscribe } from "@/lib/auth";
import { loadProfileAsync } from "@/lib/profile";
import { isSupabaseConfigured } from "@/lib/supabaseClient";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Keep this in sync with the "Minimum password length" / "Password
// Requirements" setting in the Supabase dashboard (Authentication → Sign In
// / Providers → Email) — the point is to catch a weak password here, before
// the round-trip to Supabase, not to duplicate a different rule than it.
function passwordIssue(pw: string): string | null {
  if (pw.length < 8) return "At least 8 characters";
  if (!/[a-zA-Z]/.test(pw)) return "Include at least one letter";
  if (!/[0-9]/.test(pw)) return "Include at least one number";
  return null;
}

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
        loadProfileAsync().then((profile) => {
          router.push(profile ? "/profile" : "/signup");
        });
      }
    });
  }, [router]);

  async function afterAuth() {
    const profile = await loadProfileAsync();
    router.push(profile ? "/profile" : "/signup");
  }

  const trimmedEmail = email.trim();
  const emailValid = EMAIL_RE.test(trimmedEmail);
  const pwIssue = mode === "signup" ? passwordIssue(password) : null;
  const canSubmit =
    emailValid &&
    (mode === "signup" ? !pwIssue : password.length > 0) &&
    (mode === "signin" || agreedToTerms);

  async function onEmailSubmit() {
    setError("");
    if (!emailValid) { setError("Enter a valid email address."); return; }
    if (!password) { setError("Enter your password."); return; }
    if (mode === "signup" && pwIssue) { setError(pwIssue); return; }
    if (mode === "signup" && !agreedToTerms) {
      setError("Please accept the Terms & Conditions to continue.");
      return;
    }
    setBusy(true);
    try {
      if (mode === "signup") {
        const { needsConfirmation } = await signUpWithEmail(
          trimmedEmail, password, name.trim() || undefined
        );
        if (needsConfirmation) setPendingConfirmation(true);
        else await afterAuth();
      } else {
        await signInWithEmail(trimmedEmail, password);
        await afterAuth();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  // If the Supabase keys aren't configured (see lib/supabaseClient.ts), the rest
  // of the site works but accounts can't. Say so plainly rather than letting the
  // form fail on submit.
  if (!isSupabaseConfigured) {
    return (
      <div className="auth-wrap">
        <div className="auth-card">
          <h1 className="auth-title">Accounts are temporarily unavailable</h1>
          <p className="auth-sub">
            You can still browse products, compare prices and use the smart basket
            as a guest. Signing in will be back shortly.
          </p>
          <p className="auth-guest">
            <Link href="/" className="auth-link">Keep browsing as a guest</Link>
          </p>
        </div>
      </div>
    );
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
          {mode === "signup" && (
            <p className={`auth-hint ${password && !pwIssue ? "auth-hint-ok" : ""}`}>
              {password && !pwIssue ? "✓ Looks good" : "At least 8 characters, including a letter and a number."}
            </p>
          )}
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
          disabled={busy || !canSubmit}
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
        Your data is yours. We use it to give you better buying advice, never sold
        as your identity. You can clear your profile any time from the profile page.
      </p>
    </div>
  );
}
