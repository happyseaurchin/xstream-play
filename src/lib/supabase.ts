/**
 * supabase.ts — Supabase client for play.onen.ai.
 *
 * Same Supabase project as the relay (piqxyfmzzywxzqkzmpmm).
 * Used for: auth (login/register), cloud saves, user profile.
 * NOT used for: relay (that goes through Vercel API routes).
 *
 * Env vars set in Vercel. For local dev, create .env.local:
 *   VITE_SUPABASE_URL=https://piqxyfmzzywxzqkzmpmm.supabase.co
 *   VITE_SUPABASE_ANON_KEY=sb_publishable_...
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js'

// Vite injects `import.meta.env` in the browser; under tsx/Node it does not.
// Guard the read so this module loads cleanly under both runtimes.
const viteEnv: Record<string, string | undefined> =
  (import.meta as { env?: Record<string, string | undefined> }).env ?? {}

const supabaseUrl = viteEnv.VITE_SUPABASE_URL
const supabaseAnonKey = viteEnv.VITE_SUPABASE_ANON_KEY

let instance: SupabaseClient | null = null

export function getSupabase(): SupabaseClient | null {
  if (instance) return instance
  if (!supabaseUrl || !supabaseAnonKey) return null
  instance = createClient(supabaseUrl, supabaseAnonKey)
  return instance
}

/**
 * Test-only injection hatch. Used by scripts/paywall-harness.ts to prime the
 * client when running outside the browser (where Vite env vars are absent).
 * Underscore prefix and the `_for_test` suffix flag this as not for app code.
 */
export function _setSupabaseForTest(client: SupabaseClient | null): void {
  instance = client
}
