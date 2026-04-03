/**
 * SaveModal.tsx — save to file or cloud.
 *
 * Cloud save requires auth (Supabase) + paid status.
 * If not signed in, shows inline login.
 * If signed in but not paid, shows "complete membership" link to Stripe.
 * If signed in + paid, saves to cloud.
 */

import { useState, useEffect } from 'react'
import { getSupabase } from '../lib/supabase'
import { signIn, signOut, getUserProfile, type UserProfile } from '../lib/auth'
import { cloudSave } from '../kernel/persistence'
import { listBlocks, getBlock } from '../kernel/block-store'
import type { Block } from '../kernel/types'
import type { User } from '@supabase/supabase-js'

interface SaveModalProps {
  gameCode: string
  block: Block
  onClose: () => void
  onFileSave: () => void // existing download-to-file behavior
}

export function SaveModal({ gameCode, block, onClose, onFileSave }: SaveModalProps) {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  // Login form
  const [showLogin, setShowLogin] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loginLoading, setLoginLoading] = useState(false)

  // Check session on mount
  useEffect(() => {
    const sb = getSupabase()
    if (!sb) { setLoading(false); return }
    sb.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setUser(session.user)
        getUserProfile(session.user.id).then(p => {
          setProfile(p)
          setLoading(false)
        })
      } else {
        setLoading(false)
      }
    })
  }, [])

  async function handleLogin() {
    setLoginLoading(true)
    setError('')
    const result = await signIn(email, password)
    if ('error' in result) {
      setError(result.error)
      setLoginLoading(false)
      return
    }
    setUser(result.user)
    const p = await getUserProfile(result.user.id)
    setProfile(p)
    setLoginLoading(false)
    setShowLogin(false)
  }

  async function handleCloudSave() {
    setSaving(true)
    setError('')
    const allBlocks: Record<string, unknown> = {}
    for (const n of listBlocks()) { const b = getBlock(n); if (b) allBlocks[n] = b }
    const result = await cloudSave(gameCode, block, allBlocks)
    if (!result.ok) {
      setError(result.error ?? 'Save failed')
    } else {
      setSaved(true)
    }
    setSaving(false)
  }

  async function handleSignOut() {
    await signOut()
    setUser(null)
    setProfile(null)
  }

  if (loading) {
    return <Overlay onClose={onClose}><p style={{ color: '#888' }}>...</p></Overlay>
  }

  return (
    <Overlay onClose={onClose}>
      <h2 style={{ fontSize: '1.1rem', color: '#fff', marginBottom: '1.5rem' }}>Save Game</h2>

      {/* Option 1: File download — always available */}
      <button onClick={() => { onFileSave(); onClose() }} style={optionStyle}>
        <span style={{ fontSize: '1.2rem' }}>Download file</span>
        <span style={{ fontSize: '0.75rem', color: '#888' }}>JSON save to your device</span>
      </button>

      {/* Option 2: Cloud save */}
      {!user ? (
        // Not signed in
        <>
          <button onClick={() => setShowLogin(!showLogin)} style={{ ...optionStyle, opacity: 0.7 }}>
            <span style={{ fontSize: '1.2rem' }}>Save to cloud</span>
            <span style={{ fontSize: '0.75rem', color: '#888' }}>Sign in required</span>
          </button>

          {showLogin && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.5rem' }}>
              <input
                type="email" placeholder="Email" value={email}
                onChange={e => setEmail(e.target.value)}
                style={inputStyle} autoFocus
              />
              <input
                type="password" placeholder="Password" value={password}
                onChange={e => setPassword(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleLogin()}
                style={inputStyle}
              />
              <button onClick={handleLogin} disabled={loginLoading}
                style={{ ...btnStyle, opacity: loginLoading ? 0.5 : 1 }}>
                {loginLoading ? 'Signing in...' : 'Sign in'}
              </button>
              <p style={{ fontSize: '0.7rem', color: '#666', textAlign: 'center' }}>
                No account? <a href={stripeCheckoutUrl()} target="_blank" rel="noopener"
                  style={{ color: '#7c3aed' }}>Register ($10)</a>
              </p>
            </div>
          )}
        </>
      ) : !profile?.paid ? (
        // Signed in but not paid
        <>
          <div style={{ ...optionStyle, opacity: 0.7, cursor: 'default' }}>
            <span style={{ fontSize: '1.2rem' }}>Save to cloud</span>
            <span style={{ fontSize: '0.75rem', color: '#e55' }}>Membership required</span>
          </div>
          <p style={{ fontSize: '0.8rem', color: '#888', textAlign: 'center', margin: '0.5rem 0' }}>
            <a href={stripeCheckoutUrl()} target="_blank" rel="noopener"
              style={{ color: '#7c3aed' }}>Complete your membership ($10)</a>
            {' '} to enable cloud saves.
          </p>
          <button onClick={handleSignOut} style={{ ...btnStyle, background: 'transparent', color: '#666', border: '1px solid #333' }}>
            Sign out
          </button>
        </>
      ) : (
        // Signed in + paid
        <>
          <button onClick={handleCloudSave} disabled={saving || saved}
            style={{ ...optionStyle, borderColor: saved ? '#4a4' : '#7c3aed' }}>
            <span style={{ fontSize: '1.2rem' }}>
              {saved ? 'Saved to cloud' : saving ? 'Saving...' : 'Save to cloud'}
            </span>
            <span style={{ fontSize: '0.75rem', color: '#888' }}>
              {profile.display_name} ({user.email})
            </span>
          </button>
          <button onClick={handleSignOut} style={{ ...btnStyle, background: 'transparent', color: '#666', border: '1px solid #333', marginTop: '0.25rem' }}>
            Sign out
          </button>
        </>
      )}

      {error && <p style={{ color: '#e55', fontSize: '0.8rem', marginTop: '0.5rem' }}>{error}</p>}
    </Overlay>
  )
}

// ── Stripe checkout URL (placeholder — will be set by Edge Function) ──

function stripeCheckoutUrl(): string {
  // This will redirect to Stripe Checkout. For now, placeholder.
  // The Edge Function at /functions/v1/create-checkout will generate the real URL.
  const base = import.meta.env.VITE_SUPABASE_URL
  return base ? `${base}/functions/v1/create-checkout` : '#'
}

// ── Overlay wrapper ──

function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.7)',
    }} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{
        background: '#1a1a1a', border: '1px solid #333', borderRadius: 12,
        padding: '1.5rem', width: '100%', maxWidth: 360,
        display: 'flex', flexDirection: 'column', gap: '0.75rem',
      }}>
        {children}
      </div>
    </div>
  )
}

// ── Styles ──

const optionStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: '0.25rem',
  padding: '1rem', borderRadius: 8, border: '1px solid #333',
  background: '#252525', color: '#e0e0e0', cursor: 'pointer',
  textAlign: 'left', width: '100%',
}

const inputStyle: React.CSSProperties = {
  padding: '0.6rem', borderRadius: 6, border: '1px solid #333',
  background: '#252525', color: '#e0e0e0', fontSize: '0.85rem', outline: 'none',
}

const btnStyle: React.CSSProperties = {
  padding: '0.6rem', borderRadius: 6, border: 'none',
  background: '#7c3aed', color: '#fff', fontSize: '0.85rem',
  cursor: 'pointer', fontWeight: 600,
}
