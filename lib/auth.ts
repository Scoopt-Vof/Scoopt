// ============================================================================
//  AUTH STORE  (frontend) — sign-in / sign-up experience, fake for now
// ----------------------------------------------------------------------------
//  IMPORTANT SPLIT:
//    FRONTEND (you):  the sign-in / sign-up SCREENS and this Account state.
//    BACKEND (Larry): real credential checking, sessions, Google/Apple OAuth.
//
//  Real auth is security-sensitive and must NOT live in the browser. So today
//  this file fakes a signed-in Account in localStorage — enough to build and
//  demo the whole experience — with clearly-marked SWAP POINTs where each
//  function later calls Larry's real endpoints instead. Passwords are NEVER
//  stored on the frontend, not even in the fake version.
// ============================================================================

import type { Account, AuthProvider } from "@/contract/types";

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

export function currentAccount(): Account | null {
  return read();
}
export function isSignedIn(): boolean {
  return read() !== null;
}

function fakeId(): string {
  return "u_" + Math.random().toString(36).slice(2, 10);
}

// Sign up with email. Real version: POST /api/auth/signup → backend hashes the
// password, creates the user, returns the Account + a session cookie/token.
export async function signUpWithEmail(email: string, _password: string, name?: string): Promise<Account> {
  // ===== SWAP POINT — replace with a real API call. Never send the password
  //       anywhere except Larry's HTTPS endpoint; never store it locally. =====
  const account: Account = {
    id: fakeId(), email, name, provider: "email", createdAt: new Date().toISOString(),
  };
  write(account);
  return account;
}

// Sign in with email. Real version: POST /api/auth/login → verifies, returns Account.
export async function signInWithEmail(email: string, _password: string): Promise<Account> {
  // ===== SWAP POINT — real credential check happens on the backend. =====
  const account: Account = {
    id: fakeId(), email, provider: "email", createdAt: new Date().toISOString(),
  };
  write(account);
  return account;
}

// OAuth buttons. Real version: redirect to Google/Apple, backend completes the
// exchange and returns an Account. Today it just fakes a signed-in account.
export async function signInWithProvider(provider: AuthProvider): Promise<Account> {
  // ===== SWAP POINT — start the real OAuth redirect flow here. =====
  const account: Account = {
    id: fakeId(),
    email: provider === "google" ? "shopper@gmail.com" : "shopper@icloud.com",
    provider, createdAt: new Date().toISOString(),
  };
  write(account);
  return account;
}

export function signOut(): void {
  // Real version also tells the backend to invalidate the session.
  write(null);
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
