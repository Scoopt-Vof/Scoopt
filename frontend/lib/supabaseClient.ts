// ============================================================================
//  SUPABASE CLIENT (frontend)
// ----------------------------------------------------------------------------
//  Talks to Supabase Auth directly using the public anon key — this is
//  Supabase's normal, secure client pattern: the anon key is safe to expose,
//  and actual credential checking happens on Supabase's servers, never in
//  this code. Row Level Security (see backend/db/003_rls.sql) is what keeps
//  the rest of the database locked down from this same key.
//
//  IMPORTANT: importing this module must NEVER crash the app. Previously it
//  threw the moment it loaded if the two env vars were missing — and because
//  it is imported (via lib/auth.ts -> AccountNav) by the root layout, that
//  took down every page, not just sign-in. Now, when the keys are absent, we
//  fall back to a harmless stand-in client: the site (home, search, product,
//  category, basket) renders normally as a logged-out guest, and only the
//  account screens show a clear "accounts temporarily unavailable" message.
//  Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in
//  frontend/.env.local for dev, and in the Vercel project's Environment
//  Variables for production (see frontend/.env.example).
// ============================================================================
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// The rest of the app can read this to decide whether to offer sign-in at all.
export const isSupabaseConfigured = Boolean(url && anonKey);

// A stand-in used only when the keys are missing. It implements the small slice
// of the Supabase client surface the frontend actually touches, so every call
// site keeps working: auth methods resolve to "no session" (the app treats the
// visitor as a guest) and the account actions return a clear error instead of
// throwing at import time.
function makeUnconfiguredClient(): SupabaseClient {
  const unavailable = () => ({
    data: { user: null, session: null },
    error: new Error(
      "Accounts are temporarily unavailable. Please try again in a little while."
    ),
  });

  // A tiny chainable query stub for the `shopper_profile` reads/writes in
  // lib/profile.ts (from(...).upsert(...) and from(...).select(...).eq(...).maybeSingle()).
  const query: Record<string, unknown> = {
    select: () => query,
    eq: () => query,
    upsert: () => Promise.resolve({ data: null, error: null }),
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
  };

  const stub = {
    auth: {
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe: () => {} } },
      }),
      getUser: async () => ({ data: { user: null }, error: null }),
      getSession: async () => ({ data: { session: null }, error: null }),
      signUp: async () => unavailable(),
      signInWithPassword: async () => unavailable(),
      signInWithOAuth: async () => unavailable(),
      signOut: async () => ({ error: null }),
      verifyOtp: async () => unavailable(),
      exchangeCodeForSession: async () => unavailable(),
    },
    from: () => query,
  };

  return stub as unknown as SupabaseClient;
}

export const supabase: SupabaseClient = isSupabaseConfigured
  ? createClient(url!, anonKey!, {
      auth: {
        // Persist the session in localStorage and keep it fresh so a returning
        // user stays signed in across page loads and tabs.
        persistSession: true,
        autoRefreshToken: true,
        // Parse the tokens Supabase appends to the confirmation-email redirect
        // (implicit-flow #access_token=...) automatically on load. This is what
        // turns a click on the confirmation link into a real session.
        detectSessionInUrl: true,
        // Implicit flow keeps confirmation links usable in whatever browser opens
        // the email (no per-browser code_verifier needed). The /auth/callback page
        // also handles ?code= and ?token_hash= as fallbacks.
        flowType: "implicit",
      },
    })
  : makeUnconfiguredClient();

if (!isSupabaseConfigured && typeof window !== "undefined") {
  // One quiet console note for developers; never a thrown error.
  console.warn(
    "Supabase keys are not set — sign-in is disabled. Set NEXT_PUBLIC_SUPABASE_URL " +
    "and NEXT_PUBLIC_SUPABASE_ANON_KEY (see frontend/.env.example)."
  );
}
