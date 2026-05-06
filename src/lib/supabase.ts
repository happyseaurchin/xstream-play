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

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

let instance: SupabaseClient | null = null

export function getSupabase(): SupabaseClient | null {
  if (!supabaseUrl || !supabaseAnonKey) return null
  if (!instance) {
    instance = createClient(supabaseUrl, supabaseAnonKey)
  }
  return instance
}
