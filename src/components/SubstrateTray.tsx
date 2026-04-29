/**
 * SubstrateTray.tsx — five buttons for Level-2/3 relational acts.
 *
 * Each button opens a focused dialog for one substrate primitive:
 *   grain_reach    — propose a bilateral grain
 *   register       — register in a sed: collective
 *   key_publish    — publish ed25519/x25519 keys to passport
 *   verify_rider   — verify a rider's signature chain
 *   create_collective — create a new sed: collective
 *
 * v0.1: dialogs capture inputs and emit a request. Wiring to bsp-mcp tools is
 * a follow-up — for now the handler is a placeholder that surfaces the captured
 * payload to the kernel log so the user can see what would be sent.
 */

import { useState } from 'react'

export type SubstrateAct =
  | { kind: 'grain_reach'; partner: string; purpose: string }
  | { kind: 'register'; collective: string; declaration: string }
  | { kind: 'key_publish' }
  | { kind: 'verify_rider'; rider_id: string }
  | { kind: 'create_collective'; name: string; description: string }

interface SubstrateTrayProps {
  agentId: string
  onAct: (act: SubstrateAct) => void
}

type Tool = 'grain_reach' | 'register' | 'key_publish' | 'verify_rider' | 'create_collective' | null

const ICONS: Record<Exclude<Tool, null>, string> = {
  grain_reach: '🤝',
  register: '📝',
  key_publish: '🔑',
  verify_rider: '✓',
  create_collective: '🌐',
}

const LABELS: Record<Exclude<Tool, null>, string> = {
  grain_reach: 'Reach',
  register: 'Register',
  key_publish: 'Publish keys',
  verify_rider: 'Verify rider',
  create_collective: 'Create collective',
}

export function SubstrateTray({ agentId, onAct }: SubstrateTrayProps) {
  const [open, setOpen] = useState<Tool>(null)
  return (
    <>
      <div className="flex items-center gap-1 border border-border/50 rounded overflow-hidden">
        {(Object.keys(ICONS) as Array<Exclude<Tool, null>>).map(t => (
          <button
            key={t}
            onClick={() => setOpen(t)}
            title={LABELS[t]}
            className="text-xs px-2 py-0.5"
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--muted-foreground, #888)' }}
          >
            {ICONS[t]}
          </button>
        ))}
      </div>
      {open && (
        <Dialog
          tool={open}
          agentId={agentId}
          onClose={() => setOpen(null)}
          onSubmit={act => { onAct(act); setOpen(null) }}
        />
      )}
    </>
  )
}

interface DialogProps {
  tool: Exclude<Tool, null>
  agentId: string
  onClose: () => void
  onSubmit: (act: SubstrateAct) => void
}

function Dialog({ tool, agentId, onClose, onSubmit }: DialogProps) {
  const [a, setA] = useState('')
  const [b, setB] = useState('')

  function submit() {
    if (tool === 'grain_reach') {
      if (!a.trim()) return
      onSubmit({ kind: 'grain_reach', partner: a.trim(), purpose: b.trim() })
    } else if (tool === 'register') {
      if (!a.trim()) return
      onSubmit({ kind: 'register', collective: a.trim(), declaration: b.trim() })
    } else if (tool === 'key_publish') {
      onSubmit({ kind: 'key_publish' })
    } else if (tool === 'verify_rider') {
      if (!a.trim()) return
      onSubmit({ kind: 'verify_rider', rider_id: a.trim() })
    } else if (tool === 'create_collective') {
      if (!a.trim()) return
      onSubmit({ kind: 'create_collective', name: a.trim(), description: b.trim() })
    }
  }

  return (
    <div onClick={onClose} style={overlayStyle}>
      <div onClick={e => e.stopPropagation()} style={modalStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
          <span style={{ fontSize: '1.2rem' }}>{ICONS[tool]}</span>
          <h3 style={{ margin: 0, fontSize: '0.95rem' }}>{LABELS[tool]}</h3>
        </div>
        <p style={{ fontSize: '0.7rem', color: '#888', marginBottom: '1rem' }}>as <code>{agentId}</code></p>
        {tool === 'grain_reach' && (
          <>
            <Field label="partner agent_id" value={a} onChange={setA} placeholder="weft" />
            <Field label="purpose (optional)" value={b} onChange={setB} placeholder="why you want to grain" multiline />
          </>
        )}
        {tool === 'register' && (
          <>
            <Field label="collective" value={a} onChange={setA} placeholder="sed:designers" />
            <Field label="declaration" value={b} onChange={setB} placeholder="what you bring" multiline />
          </>
        )}
        {tool === 'key_publish' && (
          <p style={{ fontSize: '0.8rem', color: '#aaa', margin: '0 0 1rem 0' }}>
            Generate ed25519 + x25519 keypairs and publish to your passport at position 9. Secret stays in sessionStorage.
          </p>
        )}
        {tool === 'verify_rider' && (
          <Field label="rider id" value={a} onChange={setA} placeholder="rider:abc123…" />
        )}
        {tool === 'create_collective' && (
          <>
            <Field label="collective name" value={a} onChange={setA} placeholder="my-collective" />
            <Field label="description" value={b} onChange={setB} placeholder="purpose, registration shape" multiline />
          </>
        )}
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
          <button onClick={onClose} style={cancelStyle}>cancel</button>
          <button onClick={submit} style={submitStyle}>submit</button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, value, onChange, placeholder, multiline }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; multiline?: boolean }) {
  return (
    <div style={{ marginBottom: '0.65rem' }}>
      <label style={{ fontSize: '0.7rem', color: '#888', display: 'block', marginBottom: '0.2rem' }}>{label}</label>
      {multiline ? (
        <textarea value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} rows={3} style={{ ...inputStyle, resize: 'vertical' }} />
      ) : (
        <input type="text" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} style={inputStyle} />
      )}
    </div>
  )
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
}

const modalStyle: React.CSSProperties = {
  background: '#1f1f1f', border: '1px solid #333', borderRadius: 8,
  padding: '1.25rem', minWidth: 320, maxWidth: 480, color: '#e0e0e0',
  fontFamily: 'system-ui, sans-serif',
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '0.5rem', borderRadius: 4, border: '1px solid #333',
  background: '#252525', color: '#e0e0e0', fontSize: '0.85rem', outline: 'none',
  boxSizing: 'border-box', fontFamily: 'inherit',
}

const submitStyle: React.CSSProperties = {
  padding: '0.45rem 0.9rem', borderRadius: 4, border: 'none',
  background: '#7c3aed', color: '#fff', fontSize: '0.8rem', cursor: 'pointer', fontWeight: 600,
}

const cancelStyle: React.CSSProperties = {
  padding: '0.45rem 0.9rem', borderRadius: 4, border: '1px solid #333',
  background: 'transparent', color: '#888', fontSize: '0.8rem', cursor: 'pointer',
}
