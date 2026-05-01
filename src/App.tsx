/**
 * App.tsx — xstream beach client (multi-column orchestrator).
 *
 * Global state: identity (active handle/secret/apiKey), identities registry,
 * theme, shell (per-handle), inbox acks (per-handle).
 *
 * Per-column state (face/beach/address/frame/pool/vapor/marks/...) lives in
 * the Column component; each column has its own kernel poll loop and
 * realtime channel. The floating ConstructionButton is global and targets
 * whichever column was last focused.
 *
 * Layout: flex-row with `overflow-x: auto`; each column flex:1 1 0 with
 * min-width 320px. Equal-split at any screen width; columns scroll
 * horizontally when their min-widths exceed the viewport (e.g. on phones).
 */

import { useState, useCallback, useEffect } from 'react'
import { ConstructionButton } from './components/xstream/ConstructionButton'
import { Column, type ColumnInputs } from './components/Column'
import { readShell, bootstrapShell, type AgentShell } from './lib/bsp-client'
import type { Theme, Face } from './types/xstream'
import './App.css'

const ACTIVE_HANDLE_KEY = 'xstream:active-handle'
const HANDLES_LIST_KEY = 'xstream:handles'
// Legacy single-handle keys, kept for one-time migration into the per-handle scheme.
const LEGACY_HANDLE_KEY = 'xstream:handle'
const LEGACY_SECRET_KEY = 'xstream:secret'
const LEGACY_API_KEY = 'xstream:api-key'
const LEGACY_API_KEY_DASH = 'xstream-api-key'
const BEACH_KEY = 'xstream:current-beach'
const DEFAULT_BEACH = 'https://happyseaurchin.com'

// Per-handle storage keys.
const secretKey = (h: string) => `xstream:secret:${h}`
const apiKeyKey = (h: string) => `xstream:api-key:${h}`
const faceStateKey = (h: string) => `xstream:face-state:${h || '_anon'}`

function loadHandles(): string[] {
  try {
    const raw = localStorage.getItem(HANDLES_LIST_KEY)
    if (raw) {
      const arr = JSON.parse(raw)
      if (Array.isArray(arr)) return arr.filter(x => typeof x === 'string')
    }
  } catch { /* corrupt */ }
  return []
}
function saveHandles(list: string[]) {
  try { localStorage.setItem(HANDLES_LIST_KEY, JSON.stringify(list)) } catch { /* quota */ }
}

function migrateLegacyIdentity() {
  if (localStorage.getItem(ACTIVE_HANDLE_KEY)) return
  const handle = localStorage.getItem(LEGACY_HANDLE_KEY)
  if (!handle) return
  const secret = sessionStorage.getItem(LEGACY_SECRET_KEY)
  const apiKey = sessionStorage.getItem(LEGACY_API_KEY) ?? localStorage.getItem(LEGACY_API_KEY_DASH)
  if (secret) sessionStorage.setItem(secretKey(handle), secret)
  if (apiKey) sessionStorage.setItem(apiKeyKey(handle), apiKey)
  const list = loadHandles()
  if (!list.includes(handle)) { list.push(handle); saveHandles(list) }
  localStorage.setItem(ACTIVE_HANDLE_KEY, handle)
}

function loadIdentity() {
  migrateLegacyIdentity()
  const handle = localStorage.getItem(ACTIVE_HANDLE_KEY) ?? ''
  return {
    handle,
    secret: handle ? (sessionStorage.getItem(secretKey(handle)) ?? '') : '',
    apiKey: handle ? (sessionStorage.getItem(apiKeyKey(handle)) ?? '') : '',
  }
}

let columnIdSeq = 0
const newColumnId = () => `col-${Date.now()}-${columnIdSeq++}`

interface ColumnDescriptor {
  id: string
  initialBeach: string
  initialFace: Face
  initialAddress: string
}

export default function App() {
  const [identity, setIdentity] = useState(() => loadIdentity())
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem('xstream-theme') as Theme) || 'light')
  const [shell, setShell] = useState<AgentShell | null>(null)
  const [identities, setIdentities] = useState<string[]>(() => loadHandles())

  // Inbox acks — global to the user, shared across columns. A mark dismissed
  // in one column shouldn't haunt the user in another.
  const [inboxAcks, setInboxAcks] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem('xstream:inbox-acks')
      return new Set(raw ? JSON.parse(raw) as string[] : [])
    } catch { return new Set() }
  })
  const ackInbox = useCallback((key: string) => {
    setInboxAcks(prev => {
      const next = new Set(prev); next.add(key)
      try { localStorage.setItem('xstream:inbox-acks', JSON.stringify([...next])) } catch { /* quota */ }
      return next
    })
  }, [])

  // Columns. v0.1: spawn fresh, no persistence across reload. The starting
  // beach for the first column comes from localStorage; subsequent spawns
  // inherit from the active column.
  const [columns, setColumns] = useState<ColumnDescriptor[]>(() => {
    const initialBeach = localStorage.getItem(BEACH_KEY) ?? DEFAULT_BEACH
    const initialFace = (localStorage.getItem('xstream-face') as Face) || 'character'
    return [{ id: newColumnId(), initialBeach, initialFace, initialAddress: '' }]
  })
  const [focusedId, setFocusedId] = useState<string>(() => columns[0].id)
  const [focusedInputs, setFocusedInputs] = useState<ColumnInputs | null>(null)

  // Each column reports its inputs up here when it is focused. We store only
  // the focused column's inputs; defocused columns submit null on unmount.
  const handleColumnInputsChange = useCallback((id: string, inputs: ColumnInputs | null) => {
    setFocusedInputs(prev => {
      // Only accept updates for the currently-focused column.
      if (id !== focusedId) return prev
      return inputs
    })
  }, [focusedId])

  // When focus shifts to a different column, the old focused column's last
  // inputs are still in state — they'll be overwritten by the new focused
  // column's next render.

  // ── Theme persistence ──
  useEffect(() => { localStorage.setItem('xstream-theme', theme) }, [theme])

  // Shell read on identity change — global, per-handle. Bootstrap uses the
  // first column's beach (or DEFAULT_BEACH) as starting_beach.
  useEffect(() => {
    if (!identity.handle) { setShell(null); return }
    let cancelled = false
    ;(async () => {
      let s = await readShell(identity.handle)
      const startingBeach = columns[0]?.initialBeach ?? DEFAULT_BEACH
      if (!s && identity.secret) {
        await bootstrapShell({ agent_id: identity.handle, starting_beach: startingBeach })
        s = await readShell(identity.handle)
      }
      if (!cancelled && s) setShell(s)
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity.handle, identity.secret])

  // Persist identity changes — per-handle keys.
  useEffect(() => {
    if (identity.handle) {
      localStorage.setItem(ACTIVE_HANDLE_KEY, identity.handle)
      if (identity.secret) sessionStorage.setItem(secretKey(identity.handle), identity.secret)
      else sessionStorage.removeItem(secretKey(identity.handle))
      if (identity.apiKey) sessionStorage.setItem(apiKeyKey(identity.handle), identity.apiKey)
      else sessionStorage.removeItem(apiKeyKey(identity.handle))
      setIdentities(prev => {
        if (prev.includes(identity.handle)) return prev
        const next = [...prev, identity.handle]
        saveHandles(next)
        return next
      })
    } else {
      localStorage.removeItem(ACTIVE_HANDLE_KEY)
    }
  }, [identity.handle, identity.secret, identity.apiKey])

  // Switcher actions.
  const switchToHandle = useCallback((h: string) => {
    if (!h || h === identity.handle) return
    const secret = sessionStorage.getItem(secretKey(h)) ?? ''
    const apiKey = sessionStorage.getItem(apiKeyKey(h)) ?? ''
    setIdentity({ handle: h, secret, apiKey })
  }, [identity.handle])
  const forgetHandle = useCallback((h: string) => {
    if (!h) return
    sessionStorage.removeItem(secretKey(h))
    sessionStorage.removeItem(apiKeyKey(h))
    localStorage.removeItem(faceStateKey(h))
    setIdentities(prev => {
      const next = prev.filter(x => x !== h)
      saveHandles(next)
      return next
    })
    if (h === identity.handle) {
      setIdentity({ handle: '', secret: '', apiKey: '' })
    }
  }, [identity.handle])

  // Column management.
  const spawnColumn = useCallback(() => {
    setColumns(prev => {
      // New column inherits the focused column's beach/face/address as a
      // sensible starting point. The user diverges from there.
      const focused = prev.find(c => c.id === focusedId) ?? prev[0]
      const newCol: ColumnDescriptor = {
        id: newColumnId(),
        initialBeach: focused?.initialBeach ?? DEFAULT_BEACH,
        initialFace: focused?.initialFace ?? 'character',
        initialAddress: focused?.initialAddress ?? '',
      }
      const next = [...prev, newCol]
      // Focus the new column.
      setFocusedId(newCol.id)
      return next
    })
  }, [focusedId])

  const closeColumn = useCallback((id: string) => {
    setColumns(prev => {
      if (prev.length <= 1) return prev  // can't close the last column
      const idx = prev.findIndex(c => c.id === id)
      if (idx === -1) return prev
      const next = prev.filter(c => c.id !== id)
      // If we closed the focused one, focus a sibling.
      if (focusedId === id) {
        const fallback = next[Math.max(0, idx - 1)]
        setFocusedId(fallback.id)
      }
      return next
    })
  }, [focusedId])

  return (
    <div className="app relative" data-theme={theme}>
      {/* Multi-column row. flex-row + overflow-x:auto means narrow screens
          scroll horizontally; wide screens tile equally via flex:1 on each. */}
      <div className="flex flex-row h-full w-full overflow-x-auto overflow-y-hidden">
        {columns.map(col => (
          <div
            key={col.id}
            className="column-cell flex-1 basis-0 min-w-[320px] border-r border-border/30 last:border-r-0 h-full"
          >
            <Column
              id={col.id}
              identity={identity}
              shell={shell}
              onShellSaved={setShell}
              inboxAcks={inboxAcks}
              onAckInbox={ackInbox}
              isFocused={col.id === focusedId}
              onFocus={() => setFocusedId(col.id)}
              onClose={columns.length > 1 ? () => closeColumn(col.id) : undefined}
              onInputsChange={handleColumnInputsChange}
              initialBeach={col.initialBeach}
              initialFace={col.initialFace}
              initialAddress={col.initialAddress}
            />
          </div>
        ))}

        {/* Spawn-column affordance — anchored to the right edge of the row. */}
        <button
          onClick={spawnColumn}
          className="shrink-0 self-stretch w-8 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent/20 border-l border-border/30 transition-colors"
          title="Open another column — same identity, your own face/address"
        >
          +
        </button>
      </div>

      {/* Floating button — global. Targets the focused column's input via
          focusedInputs, which the focused Column reports up via callback. */}
      <ConstructionButton
        onThemeChange={setTheme}
        currentTheme={theme}
        value={focusedInputs?.value ?? ''}
        onChange={focusedInputs?.onChange ?? (() => {})}
        onSubmit={focusedInputs?.onSubmit ?? (() => {})}
        onQuery={focusedInputs?.onQuery ?? (() => {})}
        isQuerying={focusedInputs?.isQuerying ?? false}
        placeholder={focusedInputs?.placeholder ?? 'open a column to start typing'}
        identity={{
          handle: identity.handle,
          secret: identity.secret,
          apiKey: identity.apiKey,
          onIdentityChange: setIdentity,
          identities,
          onSwitchHandle: switchToHandle,
          onForgetHandle: forgetHandle,
        }}
      />
    </div>
  )
}
