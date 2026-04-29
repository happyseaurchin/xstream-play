/**
 * SetupScreen.tsx — beach-mode activation.
 *
 * Five inputs: API key, agent_id, secret, starting beach, starting address (optional).
 * On activate: read the agent's shell from bsp-mcp commons; bootstrap a default
 * shell with 4 CADO faces if absent; cache secret in sessionStorage; hand off
 * to App via onActivate.
 *
 * No game-code flow. No scene picker. The beach is the world.
 */

import { useState } from 'react'
import { readShell, bootstrapShell, type AgentShell } from '../lib/bsp-client'

export interface ActivationContext {
  apiKey: string
  agentId: string
  secret: string
  beach: string
  address: string
  shell: AgentShell
  bootstrapped: boolean
}

interface SetupScreenProps {
  onActivate: (ctx: ActivationContext) => void
}

const AGENT_ID_KEY = 'xstream:agent_id'
const BEACH_KEY = 'xstream:starting_beach'
const ADDRESS_KEY = 'xstream:starting_address'
const SECRET_SESSION_KEY = 'xstream:secret'
const API_KEY_KEY = 'xstream-api-key'

export default function SetupScreen({ onActivate }: SetupScreenProps) {
  const [apiKey, setApiKey] = useState(() => localStorage.getItem(API_KEY_KEY) ?? '')
  const [agentId, setAgentId] = useState(() => localStorage.getItem(AGENT_ID_KEY) ?? '')
  const [secret, setSecret] = useState(() => sessionStorage.getItem(SECRET_SESSION_KEY) ?? '')
  const [beach, setBeach] = useState(() => localStorage.getItem(BEACH_KEY) ?? '')
  const [address, setAddress] = useState(() => localStorage.getItem(ADDRESS_KEY) ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')

  function validate(): boolean {
    const k = apiKey.trim()
    if (!k) { setError('Anthropic API key required.'); return false }
    if (!k.startsWith('sk-ant-')) { setError("That doesn't look like an Anthropic API key."); return false }
    if (!agentId.trim()) { setError('agent_id required.'); return false }
    if (!secret.trim()) { setError('secret required.'); return false }
    if (!beach.trim()) { setError('starting beach required.'); return false }
    return true
  }

  async function handleActivate() {
    setError('')
    setInfo('')
    if (!validate()) return
    setBusy(true)
    try {
      const a = agentId.trim()
      const b = beach.trim()
      const ad = address.trim()
      // Cache before activation
      localStorage.setItem(API_KEY_KEY, apiKey.trim())
      localStorage.setItem(AGENT_ID_KEY, a)
      localStorage.setItem(BEACH_KEY, b)
      localStorage.setItem(ADDRESS_KEY, ad)
      sessionStorage.setItem(SECRET_SESSION_KEY, secret.trim())

      // Read or bootstrap shell
      let shell = await readShell(a)
      let bootstrapped = false
      if (!shell) {
        setInfo('No shell found — bootstrapping default with four CADO faces…')
        const boot = await bootstrapShell({ agent_id: a, starting_beach: b })
        if (!boot.ok) {
          setError(`Shell bootstrap failed: ${boot.error ?? 'unknown'}`)
          setBusy(false)
          return
        }
        bootstrapped = boot.bootstrapped
        shell = await readShell(a)
        if (!shell) {
          setError('Shell write succeeded but readback returned null.')
          setBusy(false)
          return
        }
      }

      onActivate({
        apiKey: apiKey.trim(),
        agentId: a,
        secret: secret.trim(),
        beach: b,
        address: ad,
        shell,
        bootstrapped,
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(`Activation failed: ${msg}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={containerStyle}>
      <h1 style={{ fontSize: '1.5rem', marginBottom: '0.25rem', color: '#fff' }}>xstream</h1>
      <p style={{ fontSize: '0.85rem', color: '#888', marginBottom: '2rem' }}>
        bsp-mcp native — beach-resident
      </p>

      <div style={{ width: '100%', maxWidth: 400, display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
        <div>
          <label style={labelStyle}>Anthropic API key</label>
          <input
            type="password"
            placeholder="sk-ant-…"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            style={inputStyle}
          />
        </div>

        <div>
          <label style={labelStyle}>agent_id</label>
          <input
            type="text"
            placeholder="happyseaurchin"
            value={agentId}
            onChange={e => setAgentId(e.target.value)}
            style={inputStyle}
          />
        </div>

        <div>
          <label style={labelStyle}>secret <span style={hintStyle}>(write-lock for your shell — kept in sessionStorage)</span></label>
          <input
            type="password"
            placeholder="…"
            value={secret}
            onChange={e => setSecret(e.target.value)}
            style={inputStyle}
          />
        </div>

        <div>
          <label style={labelStyle}>starting beach <span style={hintStyle}>(beach name on the commons; URLs will route once Stage 3 ships)</span></label>
          <input
            type="text"
            placeholder="happyseaurchin.com"
            value={beach}
            onChange={e => setBeach(e.target.value)}
            style={inputStyle}
          />
        </div>

        <div>
          <label style={labelStyle}>starting address <span style={hintStyle}>(optional pscale coordinate; leave blank for root)</span></label>
          <input
            type="text"
            placeholder=""
            value={address}
            onChange={e => setAddress(e.target.value)}
            style={inputStyle}
          />
        </div>

        {info && <p style={{ color: '#7af', fontSize: '0.8rem', margin: 0 }}>{info}</p>}
        {error && <p style={{ color: '#e55', fontSize: '0.8rem', margin: 0 }}>{error}</p>}

        <button onClick={handleActivate} disabled={busy} style={{ ...buttonStyle, opacity: busy ? 0.5 : 1 }}>
          {busy ? 'activating…' : 'Activate'}
        </button>

        <p style={{ fontSize: '0.7rem', color: '#666', textAlign: 'center', marginTop: '0.5rem' }}>
          API key stays in your browser. Secret stays in sessionStorage (cleared on tab close).
          <br />
          Shell auto-bootstraps on first activation.
        </p>
      </div>
    </div>
  )
}

const containerStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', alignItems: 'center',
  justifyContent: 'center', minHeight: '100vh',
  fontFamily: 'system-ui, sans-serif', background: '#1a1a1a',
  color: '#e0e0e0', padding: '2rem',
}

const inputStyle: React.CSSProperties = {
  padding: '0.65rem', borderRadius: 6, border: '1px solid #333',
  background: '#252525', color: '#e0e0e0', fontSize: '0.9rem', outline: 'none',
  width: '100%', boxSizing: 'border-box',
}

const buttonStyle: React.CSSProperties = {
  padding: '0.75rem', borderRadius: 6, border: 'none',
  background: '#7c3aed', color: '#fff', fontSize: '0.9rem',
  cursor: 'pointer', fontWeight: 600,
}

const labelStyle: React.CSSProperties = {
  fontSize: '0.75rem', color: '#888', display: 'block', marginBottom: '0.25rem',
}

const hintStyle: React.CSSProperties = {
  fontSize: '0.65rem', color: '#666', fontWeight: 'normal', marginLeft: '0.4rem',
}
