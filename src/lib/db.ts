import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env";

let admin: SupabaseClient | null = null;

// Server-only Supabase client using the service role key. Never import this
// from client components.
export function db(): SupabaseClient {
  if (!admin) {
    admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return admin;
}
