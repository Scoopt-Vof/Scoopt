// ============================================================================
//  SUPABASE CLIENT (frontend)
// ----------------------------------------------------------------------------
//  Talks to Supabase Auth directly using the public anon key — this is
//  Supabase's normal, secure client pattern: the anon key is safe to expose,
//  and actual credential checking happens on Supabase's servers, never in
//  this code. Row Level Security (see backend/db/003_rls.sql) is what keeps
//  the rest of the database locked down from this same key.
// ============================================================================
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. " +
    "Set them in frontend/.env.local for dev, and in the Vercel project's " +
    "Environment Variables for production."
  );
}

export const supabase = createClient(url, anonKey);
