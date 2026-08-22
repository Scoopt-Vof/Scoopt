"use client";
// Sign-in / sign-up screen. Email + password, plus Google/Apple buttons (shown
// now, wired to real OAuth by Larry later). New sign-ups go straight into the
// quick questionnaire. This is the FRONTEND experience; real auth is backend.

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { signInWithEmail, signUpWithEmail, signInWithProvider } from "@/lib/auth";
import { hasProfile } from "@/lib/profile";

export default function AccountPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function afterAuth(isNew: boolean) {
    // New shoppers (or anyone without a profile yet) go build their profile.
    if (isNew || !hasProfile()) router.push("/signup");
    else router.push("/profile");
  }

  async function onEmailSubmit() {
    setError("");
    if (!email.trim() || !password) { setError("Enter your email and a password."); return; }
    setBusy(true);
    try {
      if (mode === "signup") {
        await signUpWithEmail(email.trim(), password, name.trim() || undefined);
        await afterAuth(true);
      } else {
        await signInWithEmail(email.trim(), password);
        await afterAuth(false);
      }
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function onProvider(p: "google" | "apple") {
    setBusy(true);
    try {
      await signInWithProvider(p);
      await afterAuth(mode === "signup");
    } finally {
      setBusy(false);
    }
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

        {error && <p className="auth-error">{error}</p>}

        <button className="btn-cta auth-submit" onClick={onEmailSubmit} disabled={busy}>
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
