// ============================================================================
//  AUTH STORE  (frontend) — real Supabase Auth
// ----------------------------------------------------------------------------
//  Email/password sign-up and sign-in now go through Supabase Auth directly.
//  Supabase's servers handle password hashing/verification and confirmation
//  emails — nothing security-sensitive runs in this file. Google/Apple sign-in
//  is still a fake stand-in below (SWAP POINT) until real OAuth apps are
//  configured in the Supabase dashboard.
//
//  This file also keeps a localStorage mirror of the current Account so the
//  rest of the app (built before real auth existed) doesn't need to change —
//  it now stays in sync with the real Supabase session via onAuthStateChange,
//  including the moment a user clicks their confirmation-email link.
// ============================================================================

import type { User } from "@supabase/supabase-js";
import type { Account } from "@/contract/types";
import { supabase } from "@/lib/supabaseClient";

const KEY = "scoopt.account.v1";
type Listener = (a: Account | null) => void;
const listeners = new Set<Listener>();

function read(): Account | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Account) : null;
  } catch {
    return null;
  }
}

function write(a: Account | null): void {
  if (typeof window === "undefined") return;
  if (a) window.localStorage.setItem(KEY, JSON.stringify(a));
  else window.localStorage.removeItem(KEY);
  listeners.forEach((fn) => fn(a));
}

function accountFromUser(user: User): Account {
  return {
    id: user.id,
    email: user.email ?? "",
    name: (user.user_metadata?.name as string | undefined) ?? undefined,
    provider: "email",
    createdAt: user.created_at,
  };
}

// Keep the local mirror in sync with the real Supabase session — this fires
// once on load with whatever session already exists (e.g. after the user
// clicks the confirmation-email link and lands back on /account), and again
// on every sign-in/sign-out.
if (typeof window !== "undefined") {
  supabase.auth.onAuthStateChange((_event, session) => {
    write(session?.user ? accountFromUser(session.user) : null);
  });
}

// The local mirror is the synchronous read the UI needs, but it is only ever
// written from the REAL Supabase session (onAuthStateChange above fires with
// INITIAL_SESSION on load, and writes null when there is no session). With the
// fake OAuth path removed, "signed in" can no longer be a fiction: it always
// reflects a genuine Supabase session.
export function currentAccount(): Account | null {
  return read();
}
export function isSignedIn(): boolean {
  return read() !== null;
}

// Sign up with email. Creates a real Supabase user and, if email confirmation
// is required (Authentication → Sign In / Providers → Email → "Confirm
// email"), sends the confirmation email and returns no session yet.
export async function signUpWithEmail(
  email: string,
  password: string,
  name?: string
): Promise<{ account: Account; needsConfirmation: boolean }> {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: name ? { name } : undefined,
      // Land the confirmation-email click on the dedicated callback page, which
      // finalises the session and then routes the user on. This URL must be in
      // Supabase's "Redirect URLs" allow list (Authentication -> URL
      // Configuration) for every domain, or Supabase ignores it.
      emailRedirectTo:
        typeof window !== "undefined" ? `${window.location.origin}/auth/callback` : undefined,
    },
  });
  if (error) throw error;
  if (!data.user) throw new Error("Sign-up did not return a user.");

  const account = accountFromUser(data.user);
  const needsConfirmation = !data.session;
  if (!needsConfirmation) write(account); // real session already active

  return { account, needsConfirmation };
}

// Sign in with email. Fails with a real Supabase error (e.g. "Email not
// confirmed", "Invalid login credentials") until the account is confirmed.
export async function signInWithEmail(email: string, password: string): Promise<Account> {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  if (!data.user) throw new Error("Sign-in did not return a user.");
  const account = accountFromUser(data.user);
  write(account);
  return account;
}

// OAuth (Google/Apple) is intentionally NOT implemented here. The previous
// version faked it — it wrote a made-up account (shopper@gmail.com with a
// random id) straight into localStorage without ever talking to Supabase, so
// "signed in" could be a fiction one stray call away from being wired up. It
// has been removed. When real OAuth is wanted, configure the provider's app in
// the Supabase dashboard (Authentication → Sign In / Providers) and call
// supabase.auth.signInWithOAuth({ provider }) here — that returns a real
// session, which onAuthStateChange above turns into the local mirror, exactly
// like email sign-in does.

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
  // Clear ALL Scoopt local data, not just the account record. Otherwise the
  // next person on a shared computer would still see the previous user's
  // profile, basket and "recently viewed" (all stored under scoopt.* keys).
  // Note: this clears the LOCAL copy only. Deleting the shopper's row in
  // Supabase when they ask to remove their data is a backend concern (G3) —
  // there is no delete endpoint or RLS delete policy yet.
  if (typeof window !== "undefined") {
    try {
      const scooptKeys: string[] = [];
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (k && k.startsWith("scoopt.")) scooptKeys.push(k);
      }
      scooptKeys.forEach((k) => window.localStorage.removeItem(k));
    } catch {
      /* storage blocked/full — nothing more we can do */
    }
  }
  write(null);
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
