/**
 * IdentityPopover — handle + passphrase + API key.
 *
 * Replaces the destination setup screen. Anonymous user lands directly on
 * the V/L/S surface; this popover progressively unlocks functionality:
 *   handle alone        → can be seen as a name (no writes — passphrase needed)
 *   handle + passphrase → registered user; presence + marks + frame writes
 *   + api key           → Tier 2 (soft-LLM in vapour, medium on commit)
 *
 * Save persists handle to localStorage, passphrase + API key to sessionStorage
 * (cleared on tab close). The popover stays mounted; clicking outside closes
 * it without saving.
 */

import { useEffect, useState } from 'react'

const HANDLE_KEY = 'xstream:handle'
const SECRET_SESSION_KEY = 'xstream:secret'
const API_KEY_KEY = 'xstream:api-key'

export interface IdentityValues {
  handle: string
  secret: string
  apiKey: string
}

export function loadIdentity(): IdentityValues {
  return {
    handle: localStorage.getItem(HANDLE_KEY) ?? '',
    secret: sessionStorage.getItem(SECRET_SESSION_KEY) ?? '',
    apiKey: sessionStorage.getItem(API_KEY_KEY) ?? localStorage.getItem('xstream-api-key') ?? '',
  }
}

interface Props {
  open: boolean
  onClose: () => void
  onSave: (v: IdentityValues) => void
  initial: IdentityValues
}

export function IdentityPopover({ open, onClose, onSave, initial }: Props) {
  const [handle, setHandle] = useState(initial.handle)
  const [secret, setSecret] = useState(initial.secret)
  const [apiKey, setApiKey] = useState(initial.apiKey)

  useEffect(() => {
    if (open) {
      setHandle(initial.handle)
      setSecret(initial.secret)
      setApiKey(initial.apiKey)
    }
  }, [open, initial.handle, initial.secret, initial.apiKey])

  if (!open) return null

  function save() {
    const h = handle.trim()
    const s = secret.trim()
    const k = apiKey.trim()
    if (h) localStorage.setItem(HANDLE_KEY, h); else localStorage.removeItem(HANDLE_KEY)
    if (s) sessionStorage.setItem(SECRET_SESSION_KEY, s); else sessionStorage.removeItem(SECRET_SESSION_KEY)
    if (k) sessionStorage.setItem(API_KEY_KEY, k); else sessionStorage.removeItem(API_KEY_KEY)
    onSave({ handle: h, secret: s, apiKey: k })
    onClose()
  }

  function clear() {
    localStorage.removeItem(HANDLE_KEY)
    sessionStorage.removeItem(SECRET_SESSION_KEY)
    sessionStorage.removeItem(API_KEY_KEY)
    setHandle(''); setSecret(''); setApiKey('')
    onSave({ handle: '', secret: '', apiKey: '' })
    onClose()
  }

  return (
    <div onClick={onClose} className="fixed inset-0 bg-black/40 z-50 flex items-start justify-end pt-12 pr-4">
      <div onClick={e => e.stopPropagation()} className="bg-background border border-border/50 rounded-lg shadow-xl p-4 w-80 text-foreground">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold">Identity</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-sm" aria-label="close">✕</button>
        </div>

        <div className="space-y-3">
          <Field label="handle" hint="your agent_id (public)" value={handle} onChange={setHandle} placeholder="e.g. happyseaurchin" />
          <Field label="passphrase" hint="write-lock for your blocks (sessionStorage)" value={secret} onChange={setSecret} placeholder="…" type="password" />
          <Field label="API key" hint="optional — Tier 2 unlocks soft & medium" value={apiKey} onChange={setApiKey} placeholder="sk-ant-…" type="password" />
        </div>

        <div className="flex gap-2 mt-4 justify-between">
          <button onClick={clear} className="text-xs px-2 py-1 text-muted-foreground hover:text-destructive" title="forget identity in this browser">forget</button>
          <button onClick={save} className="text-xs px-3 py-1 rounded bg-primary text-primary-foreground font-medium">save</button>
        </div>

        <p className="text-[11px] text-muted-foreground mt-3 leading-snug">
          Handle is public. Passphrase + API key live in sessionStorage and clear on tab close. Nothing leaves your browser except substrate writes (federated beach) and Anthropic API calls.
        </p>
      </div>
    </div>
  )
}

function Field({ label, hint, value, onChange, placeholder, type = 'text' }: {
  label: string; hint?: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: 'text' | 'password'
}) {
  return (
    <label className="block">
      <div className="flex items-baseline gap-2 mb-1">
        <span className="text-xs font-medium text-foreground">{label}</span>
        {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
      </div>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-2 py-1.5 text-sm rounded border border-border/50 bg-background text-foreground outline-none focus:border-primary/60"
      />
    </label>
  )
}
