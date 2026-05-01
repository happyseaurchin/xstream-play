/**
 * App.tsx — xstream beach client.
 *
 * Composition: AppHeader (face/address/frame/viewer) + three zones with
 * draggable separators (Solid/Liquid/Vapour) + ConstructionButton (floating
 * home of vapour input + identity + theme).
 *
 * Anonymous landing — no setup gate. Identity lives inside the button.
 *
 * Vapour input flow (per the original design):
 *   ⌘↵ → ask soft-LLM (Tier 2; needs API key)
 *   ⇧↵ → submit to liquid (pending — appears as own liquid card)
 *   Click commit on liquid card → write to substrate (mark or frame liquid)
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import { ConstructionButton } from './components/xstream/ConstructionButton'
import { SolidZone } from './components/xstream/SolidZone'
import { LiquidZone } from './components/xstream/LiquidZone'
import { VapourZone } from './components/xstream/VapourZone'
import { DraggableSeparator } from './components/DraggableSeparator'
import { ViewerDrawer } from './components/ViewerDrawer'
import { InboxDrawer } from './components/InboxDrawer'
import { BeachKernel, type InboxItem } from './kernel/beach-kernel'
import { createBeachSession, type BeachSession, type MarkRow, type FrameView, type PoolView } from './kernel/beach-session'
import { setHiddenRef, beachToRef, resolveRef, readShell, bootstrapShell, bsp, pscaleRegister, pscaleGrainReach, pscaleKeyPublish, type AgentShell, type PresenceMark, type PscaleNode } from './lib/bsp-client'
import { joinVapourChannel, deriveScope, type VapourChannelHandle, type VapourBroadcast } from './lib/realtime'
import { getBlock, injectBlock } from './kernel/block-store'
import { callClaudeWithTools, callClaudeViaMcpConnector, composeContext, buildSoftSystemPrompt } from './kernel/claude-tools'
import type { SolidBlock, LiquidCard, VapourEntry, Theme } from './types/xstream'
import type { Face } from './types/xstream'
import type { SoftLLMResponse } from './types'
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

const MIN_ZONE = 80

// Per-handle storage keys. Secrets stay in sessionStorage (session-scoped by
// design — passphrases are not persisted to disk). The handles list and the
// active handle live in localStorage so the user picks back up where they
// left off across browser restarts.
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
  } catch { /* corrupt — fall through */ }
  return []
}

function saveHandles(list: string[]) {
  try { localStorage.setItem(HANDLES_LIST_KEY, JSON.stringify(list)) } catch { /* quota */ }
}

// One-shot migration: if a single-handle identity exists from before the
// switcher landed, copy its secret/key to per-handle keys and seed the list.
// Idempotent — once active-handle is set, this short-circuits.
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

export default function App() {
  // Identity — lives in localStorage (handle) + sessionStorage (secret, key)
  const [identity, setIdentity] = useState(() => loadIdentity())

  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem('xstream-theme') as Theme) || 'light'
  )
  const [face, setFace] = useState<Face>(
    () => (localStorage.getItem('xstream-face') as Face) || 'character'
  )

  const [beach, setBeach] = useState<string>(() => localStorage.getItem(BEACH_KEY) ?? DEFAULT_BEACH)
  const [currentAddress, setCurrentAddress] = useState('')
  const [frameInput, setFrameInput] = useState('')
  const [shell, setShell] = useState<AgentShell | null>(null)
  const [viewerOpen, setViewerOpen] = useState(false)
  const [inboxOpen, setInboxOpen] = useState(false)

  // Live data from kernel
  const [presence, setPresence] = useState<PresenceMark[]>([])
  const [marks, setMarks] = useState<MarkRow[]>([])
  const [frame, setFrame] = useState<FrameView | null>(null)
  const [pool, setPool] = useState<PoolView | null>(null)
  const [inbox, setInbox] = useState<InboxItem[]>([])
  // Locally-acked inbox keys ("<beach>#<digit>") — dismissed marks won't
  // resurface even if the source beach hasn't tided them out yet.
  // Local-only for now: persistence-across-devices is a Tier-4 nicety.
  const [inboxAcks, setInboxAcks] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem('xstream:inbox-acks')
      return new Set(raw ? JSON.parse(raw) as string[] : [])
    } catch { return new Set() }
  })
  const persistAcks = useCallback((next: Set<string>) => {
    setInboxAcks(next)
    try { localStorage.setItem('xstream:inbox-acks', JSON.stringify([...next])) } catch { /* quota / SSR */ }
  }, [])
  const [, setLogs] = useState<string[]>([])

  // Vapour
  const [vapor, setVapor] = useState('')
  const [softResponse, setSoftResponse] = useState<SoftLLMResponse | null>(null)
  const [softPending, setSoftPending] = useState(false)

  // Live peer vapour — out-of-substrate broadcast per protocol-xstream-frame.md §3.1.
  // Map keyed by peer agent_id so each peer occupies one row that updates in
  // place as they type. Stale entries (no ping for >12s) are pruned in render.
  const [peerVapour, setPeerVapour] = useState<Record<string, VapourBroadcast>>({})
  const vapourChannelRef = useRef<VapourChannelHandle | null>(null)
  const vapourBroadcastDebounceRef = useRef<number | null>(null)

  // Pending liquid card (after ⇧↵, before commit)
  const [pendingLiquid, setPendingLiquid] = useState<string | null>(null)

  // Per-face surface memory — each CADO face remembers where it was last
  // looking and what it was drafting. Modes have memory: a designer
  // adjusting rules at one address shouldn't lose their draft when they
  // flick to character to engage and back. Persisted in localStorage; pure
  // surface state (no substrate). When a face has no memory yet, falls
  // back to that face's default_address from the shell.
  type FaceMemory = { address: string; vapor: string; pendingLiquid: string | null }
  const emptyMemory = (): FaceMemory => ({ address: '', vapor: '', pendingLiquid: null })
  const loadFaceMemory = (handle: string): Record<Face, FaceMemory> => {
    try {
      const raw = localStorage.getItem(faceStateKey(handle))
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<Record<Face, FaceMemory>>
        return {
          character: parsed.character ?? emptyMemory(),
          author: parsed.author ?? emptyMemory(),
          designer: parsed.designer ?? emptyMemory(),
          observer: parsed.observer ?? emptyMemory(),
        }
      }
    } catch { /* corrupt — fall through */ }
    return { character: emptyMemory(), author: emptyMemory(), designer: emptyMemory(), observer: emptyMemory() }
  }
  const [faceState, setFaceState] = useState<Record<Face, FaceMemory>>(() => loadFaceMemory(identity.handle))
  // When the active handle changes (multi-handle switcher), reload that
  // handle's per-face memory.
  useEffect(() => { setFaceState(loadFaceMemory(identity.handle)) }, [identity.handle])
  const persistFaceState = useCallback((next: Record<Face, FaceMemory>) => {
    setFaceState(next)
    try { localStorage.setItem(faceStateKey(identity.handle), JSON.stringify(next)) } catch { /* quota */ }
  }, [identity.handle])

  // Zone heights — proportional, draggable
  const [solidHeight, setSolidHeight] = useState(() => Math.round(window.innerHeight * 0.35))
  const [liquidHeight, setLiquidHeight] = useState(() => Math.round(window.innerHeight * 0.30))

  // Session
  const [session, setSession] = useState<BeachSession>(() =>
    createBeachSession({
      agent_id: identity.handle,
      secret: identity.secret,
      beach,
      address: '',
      api_key: identity.apiKey || null,
      face,
    })
  )

  const kernelRef = useRef<BeachKernel | null>(null)

  useEffect(() => { localStorage.setItem('xstream-theme', theme) }, [theme])
  useEffect(() => { localStorage.setItem('xstream-face', face) }, [face])
  useEffect(() => { localStorage.setItem(BEACH_KEY, beach) }, [beach])

  // Kernel lifetime
  useEffect(() => {
    if (kernelRef.current) return
    const kernel = new BeachKernel(session, {
      onPresence: setPresence,
      onMarks: setMarks,
      onFrame: setFrame,
      onPool: setPool,
      onInbox: setInbox,
      onError: msg => setLogs(prev => [...prev.slice(-50), `❌ ${msg}`]),
      onLog: msg => setLogs(prev => [...prev.slice(-50), msg]),
    })
    kernelRef.current = kernel
    kernel.start()
    return () => { kernel.stop(); kernelRef.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Shell read on identity change
  useEffect(() => {
    if (!identity.handle) { setShell(null); return }
    let cancelled = false
    ;(async () => {
      let s = await readShell(identity.handle)
      if (!s && identity.secret) {
        await bootstrapShell({ agent_id: identity.handle, starting_beach: beach })
        s = await readShell(identity.handle)
      }
      if (!cancelled && s) setShell(s)
    })()
    return () => { cancelled = true }
  }, [identity.handle, identity.secret, beach])

  // Push watched beaches into the kernel — drives the inbox scan loop.
  useEffect(() => {
    if (!kernelRef.current) return
    kernelRef.current.setWatchedBeaches(shell?.watched_beaches ?? [])
  }, [shell])

  // Wire agent block hidden directories on beach change
  useEffect(() => {
    const beachRef = beachToRef(beach)
    if (!beachRef) return
    for (const name of ['medium-agent', 'soft-agent', 'hard-agent']) {
      const ab = getBlock(name)
      if (ab) setHiddenRef(ab, '1', beachRef)
    }
    ;(async () => {
      try {
        const resolved = await resolveRef(beachRef, identity.handle || '(anon)')
        if (resolved.block) injectBlock(beachRef, resolved.block)
      } catch (e) {
        console.warn('[beach prefetch]', e)
      }
    })()
  }, [beach, identity.handle])

  // Sync session into the running kernel
  useEffect(() => {
    setSession(prev => {
      const next: BeachSession = {
        ...prev,
        agent_id: identity.handle,
        secret: identity.secret,
        api_key: identity.apiKey || null,
        current_beach: beach,
        current_address: currentAddress,
        face,
      }
      if (kernelRef.current) {
        kernelRef.current.session.agent_id = next.agent_id
        kernelRef.current.session.secret = next.secret
        kernelRef.current.session.api_key = next.api_key
        kernelRef.current.setBeach(next.current_beach)
        kernelRef.current.setAddress(next.current_address)
        kernelRef.current.setFace(next.face)
      }
      return next
    })
  }, [identity.handle, identity.secret, identity.apiKey, beach, currentAddress, face])

  // Saved-handles list (multi-handle switcher).
  const [identities, setIdentities] = useState<string[]>(() => loadHandles())

  // Persist identity changes — per-handle keys. Active handle in localStorage;
  // secret + API key in sessionStorage scoped by handle. The list ensures the
  // switcher remembers handles across sessions even when their secrets aren't.
  useEffect(() => {
    if (identity.handle) {
      localStorage.setItem(ACTIVE_HANDLE_KEY, identity.handle)
      if (identity.secret) sessionStorage.setItem(secretKey(identity.handle), identity.secret)
      else sessionStorage.removeItem(secretKey(identity.handle))
      if (identity.apiKey) sessionStorage.setItem(apiKeyKey(identity.handle), identity.apiKey)
      else sessionStorage.removeItem(apiKeyKey(identity.handle))
      // Track handle in the list so the switcher remembers it across visits.
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

  // Switcher actions: switch loads stored secret/apiKey for the handle (may
  // be empty if the session hasn't unlocked it yet — user re-enters the
  // passphrase via the form). Forget removes a handle from the list and
  // wipes its session secrets + face memory.
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

  // Live peer vapour — join a Supabase Realtime channel scoped to (beach,
  // address, frame, entity). Switching face is intentionally NOT a scope
  // change: peers at the same address see each other regardless of face;
  // face filters render, not channel membership. Anonymous users (no
  // handle) don't broadcast — they can't be addressed back — but they
  // still receive peer vapour.
  useEffect(() => {
    // Tear down any prior channel.
    if (vapourChannelRef.current) {
      vapourChannelRef.current.leave().catch(() => {})
      vapourChannelRef.current = null
    }
    setPeerVapour({})
    if (!identity.handle) return // anonymous: skip joining; we have no agent_id to label our broadcast
    const scope = deriveScope({
      beach,
      address: currentAddress,
      frame: session.current_frame,
      entity_position: session.entity_position,
    })
    const handle = joinVapourChannel({
      scope,
      agent_id: identity.handle,
      face,
      onPeer: msg => {
        setPeerVapour(prev => ({ ...prev, [msg.agent_id]: msg }))
      },
    })
    if (handle) vapourChannelRef.current = handle
    return () => {
      if (vapourChannelRef.current) {
        vapourChannelRef.current.leave().catch(() => {})
        vapourChannelRef.current = null
      }
    }
  }, [identity.handle, beach, currentAddress, session.current_frame, session.entity_position, face])

  // Broadcast our vapour as it changes, debounced ~80 ms. Empty string
  // broadcasts too — that signals "I stopped typing" so peers fade us out.
  useEffect(() => {
    if (!vapourChannelRef.current) return
    if (vapourBroadcastDebounceRef.current) {
      window.clearTimeout(vapourBroadcastDebounceRef.current)
    }
    vapourBroadcastDebounceRef.current = window.setTimeout(() => {
      vapourChannelRef.current?.broadcast(vapor)
    }, 80)
  }, [vapor])

  // ── Handlers ──

  const handleTopDrag = useCallback((delta: number) => {
    setSolidHeight(h => Math.max(MIN_ZONE, h + delta))
    setLiquidHeight(h => Math.max(MIN_ZONE, h - delta))
  }, [])
  const handleBottomDrag = useCallback((delta: number) => {
    setLiquidHeight(h => Math.max(MIN_ZONE, h + delta))
  }, [])

  const handleFaceChange = useCallback((newFace: Face) => {
    if (newFace === face) return
    // Snapshot the outgoing face's surface state.
    const snapshot: FaceMemory = { address: currentAddress, vapor, pendingLiquid }
    const next = { ...faceState, [face]: snapshot }
    // Restore the incoming face's state. If the face has no memory yet,
    // fall back to its shell-defined default_address (existing convention).
    const incoming = next[newFace]
    let nextAddress = incoming.address
    if (!nextAddress && shell) {
      const sf = shell.faces.find(x => x.canonical === newFace)
      if (sf && sf.default_address) nextAddress = sf.default_address
    }
    setFace(newFace)
    setCurrentAddress(nextAddress)
    setVapor(incoming.vapor)
    setPendingLiquid(incoming.pendingLiquid)
    persistFaceState(next)
  }, [face, shell, currentAddress, vapor, pendingLiquid, faceState, persistFaceState])

  const handleEnterFrame = useCallback(() => {
    if (!frameInput.trim() || !kernelRef.current) return
    kernelRef.current.setFrame(frameInput.trim(), '1')
    setSession(s => ({ ...s, current_frame: frameInput.trim(), entity_position: '1' }))
  }, [frameInput])
  const handleLeaveFrame = useCallback(() => {
    kernelRef.current?.setFrame(null, null)
    setSession(s => ({ ...s, current_frame: null, entity_position: null }))
  }, [])

  // ⌘↵ — ask soft-LLM (Tier 2). The magic move: substrate-equipped, face-gated.
  const handleQuery = useCallback(async (text: string) => {
    if (!identity.apiKey) {
      setSoftResponse({
        id: Date.now().toString(), originalInput: text,
        text: 'Add an API key in identity (button → Identity) to query the soft-LLM.',
        softType: 'info', face, frameId: null,
      })
      return
    }
    setSoftPending(true)
    setSoftResponse(null)
    try {
      // ?mcp=connector flips to the Anthropic mcp_servers beta path. Falls
      // back to the in-client loop on connector failure.
      const useConnector = new URLSearchParams(window.location.search).get('mcp') === 'connector'
      let resultText: string
      let summary: string
      if (useConnector) {
        try {
          // Compose the same context the in-client loop uses so the connector
          // path knows where the user is (beach url, address, frame, shell,
          // active face). Only the transport differs — Anthropic dispatches
          // the bsp-mcp tools server-side instead of our in-client loop.
          const ctx = composeContext({
            session, shell, face, marks, presence, frame, userMessage: text,
          })
          const sysPrompt = buildSoftSystemPrompt({
            agentId: identity.handle, face, ctx,
          })
          const r = await callClaudeViaMcpConnector({
            apiKey: identity.apiKey,
            model: session.soft_model,
            systemPrompt: sysPrompt,
            userMessage: text,
          })
          resultText = r.text
          summary = ' (mcp-connector path)'
        } catch (e) {
          resultText = `(MCP connector failed; in-client fallback below)\n\n${e instanceof Error ? e.message : String(e)}`
          summary = ' (connector failed)'
        }
      } else {
        const result = await callClaudeWithTools({
          apiKey: identity.apiKey,
          model: session.soft_model,
          session,
          shell,
          face,
          marks,
          presence,
          frame,
          userMessage: text,
          onToolCall: (name, input) => {
            setLogs(prev => [...prev.slice(-50), `🛠 ${name}(${JSON.stringify(input).slice(0, 120)})`])
          },
          onLog: msg => setLogs(prev => [...prev.slice(-50), `· ${msg}`]),
        })
        resultText = result.text
        summary = result.toolCalls.length > 0
          ? ` (${result.toolCalls.length} tool call${result.toolCalls.length === 1 ? '' : 's'} · ${result.turns} turn${result.turns === 1 ? '' : 's'})`
          : ''
      }
      setSoftResponse({
        id: Date.now().toString(), originalInput: text,
        text: resultText + (summary ? `\n\n— ${summary.trim()}` : ''),
        softType: 'refine', face, frameId: null,
      })
    } catch (e) {
      setSoftResponse({
        id: Date.now().toString(), originalInput: text,
        text: `(soft error: ${e instanceof Error ? e.message : 'unknown'})`,
        softType: 'info', face, frameId: null,
      })
    } finally {
      setSoftPending(false)
    }
  }, [identity.apiKey, face, session, shell, marks, presence, frame])

  // ⇧↵ — submit. Parses an action verb prefix and dispatches to the matching
  // primitive. Default (no recognised prefix) drops a mark or commits liquid.
  // Verb syntax (matches the templates injected by the action column):
  //   passport: <description>
  //   register sed:<collective> <declaration>
  //   engage <agent_id> <description> | <my side>
  //   keys
  // Anything else is treated as raw mark / liquid content.
  const handleSubmit = useCallback(async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return

    const reportInfo = (msg: string) => setSoftResponse({
      id: Date.now().toString(), originalInput: text, text: msg,
      softType: 'info', face, frameId: null,
    })

    // passport: <description>
    const passportMatch = trimmed.match(/^passport[:\s]+([\s\S]+)$/i)
    if (passportMatch) {
      if (!identity.handle || !identity.secret) { reportInfo('Identify first (button → Identity).'); return }
      const desc = passportMatch[1].trim()
      const r = await bsp({
        agent_id: identity.handle, block: 'passport',
        spindle: '', pscale_attention: 0,
        content: desc, secret: identity.secret,
      })
      reportInfo(r.ok ? `📇 passport _ updated.` : `passport write failed: ${'error' in r ? r.error : 'unknown'}`)
      setVapor('')
      return
    }

    // register sed:<collective> <declaration>
    const registerMatch = trimmed.match(/^register\s+sed:(\S+)\s+([\s\S]+)$/i)
    if (registerMatch) {
      if (!identity.handle || !identity.secret) { reportInfo('Identify first (button → Identity).'); return }
      const collective = registerMatch[1]
      const declaration = registerMatch[2].trim()
      reportInfo(`📝 registering at sed:${collective}…`)
      const r = await pscaleRegister({ collective, declaration, passphrase: identity.secret })
      reportInfo(r.ok ? `📝 ${r.message}` : `register failed: ${r.message}`)
      setVapor('')
      return
    }

    // engage <agent_id> <description> | <my side>
    const engageMatch = trimmed.match(/^engage\s+(\S+)\s+([\s\S]+)$/i)
    if (engageMatch) {
      if (!identity.handle || !identity.secret) { reportInfo('Identify first (button → Identity).'); return }
      const partner = engageMatch[1]
      const rest = engageMatch[2]
      const [description, mySide] = rest.includes('|')
        ? rest.split('|', 2).map(s => s.trim())
        : [rest.trim(), rest.trim()]
      reportInfo(`🤝 reaching to ${partner}…`)
      const r = await pscaleGrainReach({
        agent_id: identity.handle, partner_agent_id: partner,
        description, my_side_content: mySide, my_passphrase: identity.secret,
      })
      reportInfo(r.ok ? `🤝 ${r.message}` : `engage failed: ${r.message}`)
      setVapor('')
      return
    }

    // pool: <purpose> — create a new pool at the next free beach:2.<N> and
    // navigate the address bar into it. The pool charter goes in the
    // underscore at 2.<N>; contributions then flow to 2.<N>.<n> from any
    // user (incl. the creator) just by typing + ⇧↵ at this address.
    const poolMatch = trimmed.match(/^pool[:\s]+([\s\S]+)$/i)
    if (poolMatch) {
      if (!identity.handle) { reportInfo('Identify first (button → Identity).'); return }
      const purpose = poolMatch[1].trim()
      if (!purpose) { reportInfo('Pool needs a purpose: `pool: <what we converge on>`.'); return }
      const r = await bsp({ agent_id: beach, block: 'beach', spindle: '2' })
      let nextDigit: string | null = null
      if (r.ok && 'raw' in r && r.raw && typeof r.raw === 'object') {
        const root = r.raw as Record<string, PscaleNode>
        const poolsNode = root['2']
        if (typeof poolsNode !== 'object' || poolsNode === null) {
          nextDigit = '1'
        } else {
          const ring = poolsNode as Record<string, PscaleNode>
          for (let d = 1; d <= 9; d++) {
            if (!(String(d) in ring)) { nextDigit = String(d); break }
          }
        }
      } else {
        nextDigit = '1'
      }
      if (!nextDigit) { reportInfo('All 9 pool slots are taken on this beach.'); return }
      const w = await bsp({
        agent_id: beach, block: 'beach',
        spindle: '2.' + nextDigit,
        content: { _: purpose },
      })
      if (w.ok) {
        reportInfo(`🌀 pool created at 2.${nextDigit}. Navigated in — type + ⇧↵ to contribute.`)
        setCurrentAddress('2.' + nextDigit)
        setVapor('')
      } else {
        reportInfo(`pool create failed: ${'error' in w ? w.error : 'unknown'}`)
      }
      return
    }

    // keys (publish ed25519 + x25519)
    if (/^keys$/i.test(trimmed)) {
      if (!identity.handle || !identity.secret) { reportInfo('Identify first (button → Identity).'); return }
      reportInfo(`🔑 deriving + publishing keys…`)
      const r = await pscaleKeyPublish({ agent_id: identity.handle, secret: identity.secret })
      reportInfo(r.ok ? `🔑 ${r.message}` : `key publish failed: ${r.message}`)
      setVapor('')
      return
    }

    // Default: pass to the existing pending-liquid → commit flow (mark drop,
    // pool contribution, or in-frame liquid commit, depending on session
    // state — branched in handleCommit / kernel.dropMark).
    setPendingLiquid(trimmed)
    setVapor('')
  }, [face, identity.handle, identity.secret, beach])

  // Click commit on the self liquid card → write to substrate
  const handleCommit = useCallback(async (_cardId: string) => {
    if (!pendingLiquid || !kernelRef.current) return
    if (!identity.handle || !identity.secret) {
      // Surface as soft note rather than silently dropping
      setSoftResponse({
        id: Date.now().toString(), originalInput: pendingLiquid,
        text: 'Identify (button → Identity → handle + passphrase) to commit to the substrate.',
        softType: 'info', face, frameId: null,
      })
      return
    }
    if (kernelRef.current.session.current_frame) {
      await kernelRef.current.commitLiquid(pendingLiquid)
    } else {
      await kernelRef.current.dropMark(pendingLiquid)
    }
    setPendingLiquid(null)
  }, [pendingLiquid, identity.handle, identity.secret, face])

  const handleCopyToVapor = useCallback((text: string) => {
    setVapor(text)
  }, [])

  // ── Derived data for the zones ──

  // Liquid cards: my pending + present peers
  const liquidCards: LiquidCard[] = (() => {
    const cards: LiquidCard[] = []
    if (pendingLiquid) {
      cards.push({
        id: 'self-pending',
        userId: 'self',
        userName: identity.handle || 'anon',
        content: pendingLiquid,
        timestamp: Date.now(),
      })
    }
    if (frame && session.entity_position) {
      // In-frame: peer entities with non-empty liquid
      for (const e of frame.entities) {
        if (e.position === session.entity_position) continue
        if (!e.liquid) continue
        cards.push({
          id: `entity-${e.position}`,
          userId: `entity-${e.position}`,
          userName: e.underscore?.split('—')[0]?.trim() || `entity ${e.position}`,
          content: e.liquid,
          timestamp: Date.now(),
        })
      }
    } else {
      // Beachcombing: present peers as liquid cards (their handle as userName)
      for (const p of presence) {
        if (p.agent_id === identity.handle) continue
        cards.push({
          id: `peer-${p.agent_id}`,
          userId: `peer-${p.agent_id}`,
          userName: p.agent_id,
          content: p.summary || `present at ${p.address || '/'}`,
          timestamp: p.timestamp ? Date.parse(p.timestamp) : Date.now(),
        })
      }
    }
    return cards
  })()

  // Solid blocks. The substrate determines the surface:
  //   frame mode  → frame synthesis + own committed solid (entity at .2)
  //   pool mode   → pool synthesis + pool purpose + every contribution
  //   beachcombing → my own marks at this address
  // Frame and pool can't co-exist (frame is its own block; pool is a sub-ring
  // of the beach block) — the kernel surfaces one or the other.
  const solidBlocks: SolidBlock[] = (() => {
    const out: SolidBlock[] = []
    if (frame) {
      if (frame.synthesis) {
        out.push({
          id: 'synthesis', title: 'Synthesis',
          content: frame.synthesis + (frame.synthesis_envelope ? `\n\n${frame.synthesis_envelope}` : ''),
          timestamp: Date.now(),
        })
      }
      if (session.entity_position) {
        const my = frame.entities.find(e => e.position === session.entity_position)
        if (my && my.solid) {
          out.push({ id: 'self-solid', title: 'You · last committed', content: my.solid, timestamp: Date.now() })
        }
      }
    } else if (pool) {
      if (pool.synthesis) {
        out.push({
          id: 'pool-synthesis', title: 'Synthesis',
          content: pool.synthesis + (pool.synthesis_envelope ? `\n\n${pool.synthesis_envelope}` : ''),
          timestamp: Date.now(),
        })
      }
      if (pool.purpose) {
        out.push({
          id: 'pool-purpose', title: `Pool · 2.${pool.pool_digit}`,
          content: pool.purpose, timestamp: Date.now(),
        })
      }
      for (const c of pool.contributions) {
        out.push({
          id: `pool-contrib-${c.digit}`,
          title: c.agent_id || `slot ${c.digit}`,
          content: c.text,
          timestamp: c.timestamp ? Date.parse(c.timestamp) : Date.now(),
          face: c.face,
        })
      }
    } else {
      // Beachcombing: my own marks at this address
      for (const m of marks) {
        if (m.is_presence) continue
        if (!identity.handle || m.agent_id !== identity.handle) continue
        out.push({
          id: `mark-${m.digit}`,
          content: m.text,
          timestamp: m.timestamp ? Date.parse(m.timestamp) : Date.now(),
          face: m.face,
        })
      }
    }
    return out
  })()

  // Vapour entries: peers' live vapour from the realtime channel. Drop
  // entries with empty text (peer stopped typing) and entries older than
  // 12 s (peer dropped offline / channel hiccup).
  const VAPOUR_STALENESS_MS = 12_000
  const now = Date.now()
  const vapourEntries: VapourEntry[] = Object.values(peerVapour)
    .filter(p => p.vapour_text.trim().length > 0 && (now - p.ts) < VAPOUR_STALENESS_MS)
    .map(p => ({
      id: `peer-vapour-${p.agent_id}`,
      userId: p.agent_id,
      userName: p.agent_id,
      text: p.vapour_text,
      timestamp: p.ts,
      isSelf: false,
    }))

  const placeholderText = identity.apiKey
    ? 'type · ⌘↵ ask soft · ⇧↵ submit'
    : (identity.handle ? 'type · ⇧↵ submit' : 'type to think · identify in button to engage')

  return (
    <div className="app relative" data-theme={theme} data-face={face}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 h-[44px] border-b border-border/50 text-sm shrink-0 z-10 relative bg-background overflow-x-auto">
        <span className={`text-xs font-mono ${identity.handle ? 'text-foreground font-semibold' : 'text-muted-foreground italic'}`}>
          {identity.handle || 'anon'}
        </span>

        {/* Face switcher */}
        <div className="flex items-center gap-0.5 border border-border/50 rounded overflow-hidden shrink-0">
          {(['character', 'author', 'designer', 'observer'] as const).map(f => {
            const sf = shell?.faces.find(x => x.canonical === f)
            const long = sf?.label?.split('—')[0]?.trim() || f
            const active = face === f
            return (
              <button
                key={f}
                onClick={() => handleFaceChange(f)}
                className={`text-xs px-2 py-0.5 border-none cursor-pointer transition-colors ${
                  active ? 'bg-accent text-foreground font-semibold' : 'bg-transparent text-muted-foreground hover:text-foreground'
                }`}
                title={sf?.label || f}
              >
                {long.charAt(0).toUpperCase()}
              </button>
            )
          })}
        </div>

        {/* Address bar */}
        <div className="flex items-center gap-1 text-xs font-mono border border-border/50 rounded px-2 py-0.5 text-foreground min-w-0 shrink">
          <span title="beach" className="text-muted-foreground shrink-0">🌊</span>
          <input
            type="text"
            value={beach}
            onChange={e => setBeach(e.target.value)}
            className="bg-transparent border-none outline-none text-muted-foreground"
            style={{ width: '11rem' }}
            title="beach"
          />
          <span className="text-muted-foreground shrink-0">:</span>
          <input
            type="text"
            value={currentAddress}
            placeholder="(root)"
            onChange={e => setCurrentAddress(e.target.value)}
            className="bg-transparent border-none outline-none text-foreground"
            style={{ width: '4rem' }}
            title="pscale address"
          />
        </div>

        {/* Frame */}
        {session.current_frame ? (
          <button onClick={handleLeaveFrame} className="text-xs px-2 py-0.5 rounded border border-border/50 text-muted-foreground hover:text-foreground" title="leave frame">
            🎬✕
          </button>
        ) : (
          <div className="flex items-center gap-1">
            <input
              type="text"
              value={frameInput}
              onChange={e => setFrameInput(e.target.value)}
              placeholder="frame:scene"
              className="bg-transparent border border-border/50 rounded px-2 py-0.5 text-xs font-mono text-foreground outline-none"
              style={{ width: '7rem' }}
              onKeyDown={e => e.key === 'Enter' && handleEnterFrame()}
            />
            <button
              onClick={handleEnterFrame}
              disabled={!frameInput.trim()}
              className="text-xs px-2 py-0.5 rounded bg-primary/80 text-primary-foreground disabled:opacity-30"
              title="enter frame"
            >
              🎬
            </button>
          </div>
        )}

        <div className="ml-auto flex items-center gap-2 shrink-0">
          {identity.handle && (() => {
            const unread = inbox.filter(i => !inboxAcks.has(`${i.beach}#${i.digit}`)).length
            return (
              <button
                onClick={() => setInboxOpen(v => !v)}
                className={`text-xs px-2 py-0.5 rounded border border-border/50 transition-colors relative ${inboxOpen ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                title={`inbox — marks across your ${shell?.watched_beaches.length ?? 0} watched beach${shell?.watched_beaches.length === 1 ? '' : 'es'} that mention ${identity.handle}`}
              >
                📬{unread > 0 && <span className="ml-1 text-[10px] font-semibold">{unread}</span>}
              </button>
            )
          })()}
          <button
            onClick={() => setViewerOpen(v => !v)}
            className={`text-xs px-2 py-0.5 rounded border border-border/50 transition-colors ${viewerOpen ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            title="viewer (look up at the beach)"
          >
            👁
          </button>
          <span className="text-xs text-muted-foreground" title="presence at this address">
            {presence.length > 0 ? `🟢 ${presence.length}` : '·'}
          </span>
        </div>
      </div>

      {/* Three zones */}
      <div className="flex-1 min-h-0 flex flex-col relative">
        <SolidZone blocks={solidBlocks} height={solidHeight} />
        <DraggableSeparator position="top" onDrag={handleTopDrag} />
        <LiquidZone
          cards={liquidCards}
          height={liquidHeight}
          currentUserId="self"
          isLoading={false}
          onCommit={handleCommit}
          onCopyToVapor={handleCopyToVapor}
        />
        <DraggableSeparator position="bottom" onDrag={handleBottomDrag} />
        <VapourZone
          entries={vapourEntries}
          softResponse={softPending ? null : softResponse}
          onDismissSoftResponse={() => setSoftResponse(null)}
        />

        {/* Viewer drawer overlay */}
        <ViewerDrawer
          open={viewerOpen}
          onClose={() => setViewerOpen(false)}
          face={face}
          beach={beach}
          address={currentAddress}
          marks={marks}
          presence={presence}
          agentId={identity.handle}
          secret={identity.secret}
          shell={shell}
          onShellSaved={setShell}
          onNavigateAddress={setCurrentAddress}
        />

        {/* Inbox drawer overlay — cold-contact across watched beaches */}
        <InboxDrawer
          open={inboxOpen}
          onClose={() => setInboxOpen(false)}
          items={inbox.filter(i => !inboxAcks.has(`${i.beach}#${i.digit}`))}
          watchedCount={shell?.watched_beaches.length ?? 0}
          onNavigate={(beachUrl, address) => {
            setBeach(beachUrl)
            setCurrentAddress(address || '')
            setInboxOpen(false)
          }}
          onAck={key => {
            const next = new Set(inboxAcks); next.add(key); persistAcks(next)
          }}
        />
      </div>

      {/* Floating button — home of vapour input + identity + theme */}
      <ConstructionButton
        onThemeChange={setTheme}
        currentTheme={theme}
        onQuery={handleQuery}
        onSubmit={handleSubmit}
        value={vapor}
        onChange={setVapor}
        isQuerying={softPending}
        placeholder={placeholderText}
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
