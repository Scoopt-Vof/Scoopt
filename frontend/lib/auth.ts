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
import type { Account, AuthProvider } from "@/contract/types";
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

// OAuth buttons. Real version: supabase.auth.signInWithOAuth({ provider }) —
// requires the provider's OAuth app to be configured in the Supabase
// dashboard first (Authentication → Sign In / Providers → Google/Apple).
export async function signInWithProvider(provider: AuthProvider): Promise<Account> {
  // ===== SWAP POINT — still fake until Google/Apple OAuth apps are set up. =====
  const account: Account = {
    id: "u_" + Math.random().toString(36).slice(2, 10),
    email: provider === "google" ? "shopper@gmail.com" : "shopper@icloud.com",
    provider,
    createdAt: new Date().toISOString(),
  };
  write(account);
  return account;
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
  write(null);
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
