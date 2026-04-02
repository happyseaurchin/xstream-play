/**
 * auth.ts — thin auth wrapper for play.onen.ai.
 *
 * No registration here. Registration goes through Stripe first,
 * then a webhook creates the user. This module only handles:
 * - Check if a session exists
 * - Sign in (email + password)
 * - Sign out
 * - Get user profile (paid status, display name)
 */

import { getSupabase } from './supabase'
import type { User, Session } from '@supabase/supabase-js'

export interface UserProfile {
  id: string
  display_name: string
  paid: boolean
}

export async function getSession(): Promise<{ user: User; session: Session } | null> {
  const sb = getSupabase()
  if (!sb) return null
  const { data: { session } } = await sb.auth.getSession()
  if (!session?.user) return null
  return { user: session.user, session }
}

export async function signIn(email: string, password: string): Promise<{ user: User } | { error: string }> {
  const sb = getSupabase()
  if (!sb) return { error: 'Supabase not configured' }
  const { data, error } = await sb.auth.signInWithPassword({ email, password })
  if (error) return { error: error.message }
  if (!data.user) return { error: 'Sign in failed' }
  return { user: data.user }
}

export async function signOut(): Promise<void> {
  const sb = getSupabase()
  if (!sb) return
  await sb.auth.signOut()
}

export async function getUserProfile(userId: string): Promise<UserProfile | null> {
  const sb = getSupabase()
  if (!sb) return null
  const { data } = await sb
    .from('users')
    .select('id, display_name, paid')
    .eq('id', userId)
    .single()
  return data as UserProfile | null
}

export function onAuthChange(callback: (user: User | null) => void): () => void {
  const sb = getSupabase()
  if (!sb) return () => {}
  const { data: { subscription } } = sb.auth.onAuthStateChange((_event, session) => {
    callback(session?.user ?? null)
  })
  return () => subscription.unsubscribe()
}
