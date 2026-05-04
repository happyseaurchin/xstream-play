/**
 * Column — one engagement context. The V/L/S surface for one (face, beach,
 * address, frame, pool) tuple, with its own kernel poll loop, realtime
 * channel, peer vapour, viewer/inbox drawers.
 *
 * Multiple columns tile horizontally with equal-split (flex: 1 1 0,
 * min-width: 320px); the floating ConstructionButton is global and targets
 * whichever column was last focused. Identity (handle/secret/apiKey) is
 * passed in as a prop and shared across all columns in v0.1 — per-column
 * identity is a follow-up.
 *
 * The column reports its (vapor, setVapor, submit, query, isQuerying,
 * placeholder) up to App via onInputsChange whenever it is focused, so the
 * floating button can drive the focused column.
 */

import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { SolidZone } from './xstream/SolidZone'
import { LiquidZone } from './xstream/LiquidZone'
import { VapourZone } from './xstream/VapourZone'
import { PaywallBanner } from './xstream/PaywallBanner'
import { usePaywallGate } from '../kernel/use-paywall-gate'
import { useStepARegistration } from '../kernel/use-step-a-registration'
import { useVerificationPoll, loadPersistedWatch } from '../kernel/use-verification-poll'
import { DraggableSeparator } from './DraggableSeparator'
import { ViewerDrawer } from './ViewerDrawer'
import { InboxDrawer } from './InboxDrawer'
import { BeachKernel, type InboxItem } from '../kernel/beach-kernel'
import { createBeachSession, type BeachSession, type MarkRow, type FrameView, type PoolView, type LiquidPeer } from '../kernel/beach-session'
import { resolveSetting, SETTINGS, type SettingsBlock } from '../kernel/settings-reader'
import { setHiddenRef, beachToRef, resolveRef, bsp, pscaleRegister, pscaleGrainReach, pscaleKeyPublish, pscaleVerifyRider, pscaleCreateCollective, type AgentShell, type PresenceMark, type PscaleNode } from '../lib/bsp-client'
// SubstrateTray was rendered into the column header in the pre-button-tray
// era. Its verbs (register / reach / keys / passport / create-collective)
// now live on the floating ConstructionButton; the handler also lives there
// or in handleSubmit's verb-router. The header copy was duplicating the
// button — removed so registering a handle no longer mutates the header.
//
// import { SubstrateTray, type SubstrateAct } from './SubstrateTray'
import { joinVapourChannel, deriveScope, type VapourChannelHandle, type VapourBroadcast } from '../lib/realtime'
import { getBlock, injectBlock } from '../kernel/block-store'
import { callClaudeWithTools, callClaudeViaMcpConnector, buildSoftRecipePrompt } from '../kernel/claude-tools'
import { synthesise, parseRecipe } from '../kernel/medium-llm'
import { resolveRecipe, getCollectivePolicy } from '../kernel/recipe-runner'
import type { SolidBlock, LiquidCard, VapourEntry, Face } from '../types/xstream'
import type { SoftLLMResponse } from '../types'

const MIN_ZONE = 80
const DEFAULT_BEACH = 'https://happyseaurchin.com'

// Per-column face memory key. Each column has its own (face → memory) map
// scoped by both handle AND column id, so the same human in two columns
// keeps each column's drafts/addresses distinct. Closing a column drops its
// memory; reload restores the persisted columns and their memory.
const faceStateKey = (h: string, columnId: string) => `xstream:face-state:${h || '_anon'}:${columnId}`
// Per-column "current face" so a column reload restores its last face.
const currentFaceKey = (columnId: string) => `xstream:column-face:${columnId}`
// Per-column current beach + address so reload restores where this column was.
const currentBeachKey = (columnId: string) => `xstream:column-beach:${columnId}`
const currentAddressKey = (columnId: string) => `xstream:column-address:${columnId}`

export interface ColumnInputs {
  value: string
  onChange: (v: string) => void
  onSubmit: (text: string) => void
  onQuery: (text: string) => void
  isQuerying: boolean
  placeholder: string
  // Active face of the focused column — App propagates this to the floating
  // button so its bg-face-accent / icon-accent rules pick up the right CADO
  // color (yellow / blue / pink / green).
  face: Face
  // True when the focused column has a non-empty self-liquid slot on the
  // substrate. Drives the button's submit↑ ↔ commit● morph.
  pendingLiquid: boolean
  // Commit the focused column's pending liquid — runs medium-LLM synthesis,
  // promotes to solid (mark or frame entity solid), clears the liquid slot.
  onCommit: () => void
  // True while the medium-LLM synthesis + substrate writes for commit are
  // in flight. Drives the button's spinner state.
  isCommitting: boolean
}

export interface ColumnProps {
  id: string
  identity: { handle: string; secret: string; apiKey: string }
  /** Session-stable pseudo-handle (`anon-XXXXXX`) used as the substrate
   * agent_id when identity.handle is empty. Lets anonymous tabs participate
   * in presence/liquid/vapour without typing anything. */
  anonId: string
  /** Per-user settings sub-block (shell:5). Phase B: layered above per-beach
   * in the resolveSetting precedence chain. Updated when shell reloads. */
  userSettings: SettingsBlock
  shell: AgentShell | null
  inboxAcks: Set<string>
  onAckInbox: (key: string) => void
  onShellSaved?: (next: AgentShell) => void  // Designer-face shell editor → bubble up
  isFocused: boolean
  onFocus: () => void
  onClose?: () => void  // omit/undefined ⇒ column is not closeable (e.g. last one)
  onInputsChange: (id: string, inputs: ColumnInputs | null) => void
  // Seed parameters when spawning a fresh column. Subsequent navigation
  // happens within the column.
  initialBeach?: string
  initialFace?: Face
  initialAddress?: string
}

export function Column(props: ColumnProps) {
  const { id, identity, anonId, userSettings, shell, inboxAcks, onAckInbox, isFocused, onFocus, onClose, onInputsChange } = props
  // Effective substrate id: real handle if typed, else stable anon pseudo.
  // Used everywhere the kernel writes to the substrate or joins the vapour
  // channel. UI continues to display identity.handle (or "anon" when empty).
  const effectiveAgentId = identity.handle || anonId
  const isAnonymous = !identity.handle

  // Per-column persistent state. Restored from localStorage on mount; falls
  // back to props (initialFace/initialBeach/initialAddress) on first run.
  const [face, setFace] = useState<Face>(() => {
    const saved = localStorage.getItem(currentFaceKey(id)) as Face | null
    return saved ?? props.initialFace ?? 'character'
  })
  const [beach, setBeach] = useState<string>(() =>
    localStorage.getItem(currentBeachKey(id)) ?? props.initialBeach ?? DEFAULT_BEACH
  )
  const [currentAddress, setCurrentAddress] = useState<string>(() =>
    localStorage.getItem(currentAddressKey(id)) ?? props.initialAddress ?? ''
  )
  // Persist column-scoped navigation as it changes.
  useEffect(() => { try { localStorage.setItem(currentFaceKey(id), face) } catch { /* quota */ } }, [id, face])
  useEffect(() => { try { localStorage.setItem(currentBeachKey(id), beach) } catch { /* quota */ } }, [id, beach])
  useEffect(() => { try { localStorage.setItem(currentAddressKey(id), currentAddress) } catch { /* quota */ } }, [id, currentAddress])
  const [frameInput, setFrameInput] = useState('')
  const [viewerOpen, setViewerOpen] = useState(false)
  const [inboxOpen, setInboxOpen] = useState(false)

  // Live data from kernel
  const [presence, setPresence] = useState<PresenceMark[]>([])
  const [marks, setMarks] = useState<MarkRow[]>([])
  const [peerLiquid, setPeerLiquid] = useState<LiquidPeer[]>([])
  const [frame, setFrame] = useState<FrameView | null>(null)
  const [pool, setPool] = useState<PoolView | null>(null)
  const [inbox, setInbox] = useState<InboxItem[]>([])
  // Beach-level settings sub-block (beach:5). Phase A: just this layer +
  // built-in defaults. Phase B will add per-user (shell.settings).
  const [beachSettings, setBeachSettings] = useState<SettingsBlock>(null)
  const [, setLogs] = useState<string[]>([])

  // Vapour
  const [vapor, setVapor] = useState('')
  const [softResponse, setSoftResponse] = useState<SoftLLMResponse | null>(null)
  const [softPending, setSoftPending] = useState(false)

  // Live peer vapour
  const [peerVapour, setPeerVapour] = useState<Record<string, VapourBroadcast>>({})
  // Vapour transport status — surfaced as a header indicator so the user can
  // see at a glance whether two-browser vapour will work or is silently dead.
  // 'pending' = joining, 'subscribed' = live, 'no-transport' = Supabase env
  // vars missing, 'error' = subscribe failed (auth / network / RLS).
  const [vapourStatus, setVapourStatus] = useState<'pending' | 'subscribed' | 'no-transport' | 'error'>('pending')
  const vapourChannelRef = useRef<VapourChannelHandle | null>(null)
  const vapourBroadcastDebounceRef = useRef<number | null>(null)

  // Per-handle vapour mute. Scoped to the user's own handle so muting "noisy"
  // in one tab persists to every column for that user; anonymous tabs skip
  // muting (their own peers are likely impossible to identify reliably).
  const muteKey = identity.handle ? `xstream:vapour-mutes:${identity.handle}` : null
  const [mutedHandles, setMutedHandles] = useState<Set<string>>(() => {
    if (!muteKey) return new Set()
    try {
      const raw = localStorage.getItem(muteKey)
      return new Set(raw ? JSON.parse(raw) as string[] : [])
    } catch { return new Set() }
  })
  useEffect(() => {
    if (!muteKey) { setMutedHandles(new Set()); return }
    try {
      const raw = localStorage.getItem(muteKey)
      setMutedHandles(new Set(raw ? JSON.parse(raw) as string[] : []))
    } catch { setMutedHandles(new Set()) }
  }, [muteKey])
  const toggleMute = useCallback((aid: string) => {
    if (!muteKey || !aid) return
    setMutedHandles(prev => {
      const next = new Set(prev)
      if (next.has(aid)) next.delete(aid); else next.add(aid)
      try { localStorage.setItem(muteKey, JSON.stringify([...next])) } catch { /* quota */ }
      return next
    })
  }, [muteKey])

  // Self liquid is no longer kept as local state — it's read from the
  // substrate (peerLiquid filtered for is_self) so self and peer cards go
  // through one truth-path. The button's commit-vs-submit state is derived
  // from this substrate read; no awaitingEcho flag because a 1.5s poll
  // makes the round-trip feel-fast enough.
  const [isCommitting, setIsCommitting] = useState(false)

  // Per-face surface memory — lives per-handle in localStorage so flicking
  // face within a column restores that face's last (address, vapor).
  type FaceMemory = { address: string; vapor: string; pendingLiquid: string | null }
  const emptyMemory = (): FaceMemory => ({ address: '', vapor: '', pendingLiquid: null })
  const loadFaceMemory = (handle: string, columnId: string): Record<Face, FaceMemory> => {
    try {
      const raw = localStorage.getItem(faceStateKey(handle, columnId))
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<Record<Face, FaceMemory>>
        return {
          character: parsed.character ?? emptyMemory(),
          author: parsed.author ?? emptyMemory(),
          designer: parsed.designer ?? emptyMemory(),
          observer: parsed.observer ?? emptyMemory(),
        }
      }
    } catch { /* corrupt */ }
    return { character: emptyMemory(), author: emptyMemory(), designer: emptyMemory(), observer: emptyMemory() }
  }
  const [faceState, setFaceState] = useState<Record<Face, FaceMemory>>(() => loadFaceMemory(identity.handle, id))
  useEffect(() => { setFaceState(loadFaceMemory(identity.handle, id)) }, [identity.handle, id])
  const persistFaceState = useCallback((next: Record<Face, FaceMemory>) => {
    setFaceState(next)
    try { localStorage.setItem(faceStateKey(identity.handle, id), JSON.stringify(next)) } catch { /* quota */ }
  }, [identity.handle, id])

  // Zone heights — proportional, draggable
  const [solidHeight, setSolidHeight] = useState(() => Math.round(window.innerHeight * 0.35))
  const [liquidHeight, setLiquidHeight] = useState(() => Math.round(window.innerHeight * 0.30))

  // Session — kernel mirrors its fields
  const [session, setSession] = useState<BeachSession>(() =>
    createBeachSession({
      agent_id: effectiveAgentId,
      secret: identity.secret,
      beach,
      address: currentAddress,
      api_key: identity.apiKey || null,
      face,
      is_anonymous: isAnonymous,
    })
  )

  const kernelRef = useRef<BeachKernel | null>(null)

  // Kernel lifetime — one per column, independent poll loop.
  useEffect(() => {
    if (kernelRef.current) return
    const kernel = new BeachKernel(session, {
      onPresence: setPresence,
      onMarks: setMarks,
      onFrame: setFrame,
      onPool: setPool,
      onLiquid: setPeerLiquid,
      onInbox: setInbox,
      onSettings: setBeachSettings,
      onError: msg => setLogs(prev => [...prev.slice(-50), `❌ ${msg}`]),
      onLog: msg => setLogs(prev => [...prev.slice(-50), msg]),
    })
    kernelRef.current = kernel
    kernel.start()
    return () => { kernel.stop(); kernelRef.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Push watched beaches into the kernel — drives the inbox scan loop.
  useEffect(() => {
    if (!kernelRef.current) return
    kernelRef.current.setWatchedBeaches(shell?.watched_beaches ?? [])
  }, [shell])

  // Push per-user settings into the kernel so its internal getSetting() walks
  // the per-user layer too (presence staleness, liquid staleness, inbox cadence).
  useEffect(() => {
    if (!kernelRef.current) return
    kernelRef.current.setUserSettings(userSettings)
  }, [userSettings])

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
        agent_id: effectiveAgentId,
        secret: identity.secret,
        is_anonymous: isAnonymous,
        api_key: identity.apiKey || null,
        current_beach: beach,
        current_address: currentAddress,
        face,
      }
      if (kernelRef.current) {
        const prevAgentId = kernelRef.current.session.agent_id
        kernelRef.current.session.agent_id = next.agent_id
        kernelRef.current.session.secret = next.secret
        kernelRef.current.session.is_anonymous = next.is_anonymous
        kernelRef.current.session.api_key = next.api_key
        kernelRef.current.setBeach(next.current_beach)
        kernelRef.current.setAddress(next.current_address)
        kernelRef.current.setFace(next.face)
        // Logout / handle-switch: actively release the previous identity's
        // presence + liquid slots so peers see them depart immediately
        // (not after the 30s staleness window).
        if (prevAgentId && prevAgentId !== next.agent_id) {
          kernelRef.current.releasePresence(prevAgentId).catch(() => {})
        }
      }
      return next
    })
  }, [effectiveAgentId, isAnonymous, identity.secret, identity.apiKey, beach, currentAddress, face])

  // Live peer vapour — channel scope keyed by (beach, address, frame, entity).
  // Anonymous tabs join too, using their stable anon-XXXXXX id, so two
  // strangers at the same address see each other's keystrokes without
  // either typing a handle.
  useEffect(() => {
    if (vapourChannelRef.current) {
      vapourChannelRef.current.leave().catch(() => {})
      vapourChannelRef.current = null
    }
    setPeerVapour({})
    setVapourStatus('pending')
    const scope = deriveScope({
      beach,
      address: currentAddress,
      frame: session.current_frame,
      entity_position: session.entity_position,
    })
    const handle = joinVapourChannel({
      scope,
      agent_id: effectiveAgentId,
      face,
      onPeer: msg => { setPeerVapour(prev => ({ ...prev, [msg.agent_id]: msg })) },
      onStatus: (status) => setVapourStatus(status),
    })
    if (handle) vapourChannelRef.current = handle
    else setVapourStatus('no-transport')
    return () => {
      if (vapourChannelRef.current) {
        vapourChannelRef.current.leave().catch(() => {})
        vapourChannelRef.current = null
      }
    }
  }, [effectiveAgentId, beach, currentAddress, session.current_frame, session.entity_position, face])

  // Broadcast our vapour as it changes, debounced. Debounce window is
  // resolved from settings (default 80ms) so beaches with chatty users can
  // raise the floor (e.g. 200ms) without changing client code.
  useEffect(() => {
    if (!vapourChannelRef.current) return
    const debounceMs = resolveSetting(
      { beach_settings: beachSettings, user_settings: userSettings },
      SETTINGS.VAPOUR_DEBOUNCE,
      80,
    )
    if (vapourBroadcastDebounceRef.current) {
      window.clearTimeout(vapourBroadcastDebounceRef.current)
    }
    vapourBroadcastDebounceRef.current = window.setTimeout(() => {
      vapourChannelRef.current?.broadcast(vapor)
    }, debounceMs)
  }, [vapor, beachSettings, userSettings])

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
    // pendingLiquid is now substrate-derived per-(beach, address), so no
    // need to snapshot it across face changes — it'll re-derive from the
    // substrate at the new face's address.
    const snapshot: FaceMemory = { address: currentAddress, vapor, pendingLiquid: null }
    const next = { ...faceState, [face]: snapshot }
    const incoming = next[newFace]
    let nextAddress = incoming.address
    if (!nextAddress && shell) {
      const sf = shell.faces.find(x => x.canonical === newFace)
      if (sf && sf.default_address) nextAddress = sf.default_address
    }
    setFace(newFace)
    setCurrentAddress(nextAddress)
    setVapor(incoming.vapor)
    persistFaceState(next)
  }, [face, shell, currentAddress, vapor, faceState, persistFaceState])

  const handleEnterFrame = useCallback(() => {
    if (!frameInput.trim() || !kernelRef.current) return
    kernelRef.current.setFrame(frameInput.trim(), '1')
    setSession(s => ({ ...s, current_frame: frameInput.trim(), entity_position: '1' }))
  }, [frameInput])
  const handleLeaveFrame = useCallback(() => {
    kernelRef.current?.setFrame(null, null)
    setSession(s => ({ ...s, current_frame: null, entity_position: null }))
  }, [])

  // ⌘↵ — soft-LLM
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
      const useConnector = new URLSearchParams(window.location.search).get('mcp') === 'connector'
      let resultText: string
      let summary: string
      if (useConnector) {
        try {
          const sysPrompt = buildSoftRecipePrompt({
            session, shell, face, marks, presence, frame,
            settingsContext: { beach_settings: beachSettings, user_settings: userSettings },
          })
          const r = await callClaudeViaMcpConnector({
            apiKey: identity.apiKey, model: session.soft_model,
            systemPrompt: sysPrompt, userMessage: text,
          })
          resultText = r.text
          summary = ' (mcp-connector path)'
        } catch (e) {
          resultText = `(MCP connector failed; in-client fallback below)\n\n${e instanceof Error ? e.message : String(e)}`
          summary = ' (connector failed)'
        }
      } else {
        const result = await callClaudeWithTools({
          apiKey: identity.apiKey, model: session.soft_model,
          session, shell, face, marks, presence, frame, userMessage: text,
          settingsContext: { beach_settings: beachSettings, user_settings: userSettings },
          onToolCall: (name, input) => {
            setLogs(prev => [...prev.slice(-50), `🛠 ${name}(${JSON.stringify(input).slice(0, 120)})`])
          },
          onLog: msg => setLogs(prev => [...prev.slice(-50), `· ${msg}`]),
          // Soft proposes; user commits. The propose lands as the user's
          // liquid slot on the substrate (frame entity .1 in-frame, or
          // beach:7.<address>.<digit> on the beach). The next poll cycle
          // returns it as is_self in peerLiquid → drives the button to
          // commit●. No local pending state — substrate is the truth.
          onProposeLiquid: async (proposed: string) => {
            const k = kernelRef.current
            if (!k) return { ok: false, scope: 'no-kernel', error: 'kernel not ready' }
            if (face === 'observer') {
              return { ok: false, scope: 'observer', error: 'Observer face is read-only — propose_liquid blocked.' }
            }
            if (k.session.current_frame && k.session.entity_position) {
              const r = await k.commitLiquid(proposed)
              return r.ok
                ? { ok: true, scope: `frame:${k.session.current_frame}:${k.session.entity_position}.1 (shared with peers in-frame)` }
                : { ok: false, scope: 'frame', error: r.error }
            }
            const r = await k.writeBeachLiquid(proposed)
            return r.ok
              ? { ok: true, scope: `beach:7.${k.session.current_address || '<root>'}.<your-digit> (shared with peers at this address)` }
              : { ok: false, scope: 'beach-liquid', error: r.error }
          },
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
  }, [identity.apiKey, identity.handle, face, session, shell, marks, presence, frame])

  // ⇧↵ — submit (verb prefix or default to liquid commit flow).
  const handleSubmit = useCallback(async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return

    const reportInfo = (msg: string) => setSoftResponse({
      id: Date.now().toString(), originalInput: text, text: msg,
      softType: 'info', face, frameId: null,
    })

    // Observer face is read-only across V/L/S. Identity/substrate verbs
    // (passport / register / engage / pool / keys) are still allowed below
    // because they're sovereign acts of the user, not engagement on the
    // shared frame. Only the default fallback (text → liquid) is gated.

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

    if (/^keys$/i.test(trimmed)) {
      if (!identity.handle || !identity.secret) { reportInfo('Identify first (button → Identity).'); return }
      reportInfo(`🔑 deriving + publishing keys…`)
      const r = await pscaleKeyPublish({ agent_id: identity.handle, secret: identity.secret })
      reportInfo(r.ok ? `🔑 ${r.message}` : `key publish failed: ${r.message}`)
      setVapor('')
      return
    }

    if (face === 'observer') {
      reportInfo('Observer face is read-only. Switch to character / author / designer to stage liquid.')
      return
    }

    setVapor('')
    // Publish to the location-keyed liquid layer at beach:7.<address>.<digit>.
    // The next poll cycle returns this as is_self in peerLiquid; the button
    // morphs from submit↑ to commit●. No local pending state — substrate
    // is the single source of truth, surface mirrors it. Anonymous tabs
    // publish too — the anon-XXXXXX pseudo-handle is what identifies the
    // slot. In-frame, the entity's .1 slot is written at commit-time via
    // kernel.commitLiquid (different path).
    if (kernelRef.current && !kernelRef.current.session.current_frame) {
      kernelRef.current.writeBeachLiquid(trimmed).catch(() => {})
    }
  }, [face, identity.handle, identity.secret, beach])

  // Self-liquid source — read from the substrate echo, not local state.
  // myLiquidSlot is the only "do I have something pending to commit?" truth.
  const myLiquidSlot = peerLiquid.find(lp => lp.is_self) ?? null
  const myLiquidText = myLiquidSlot && myLiquidSlot.text.trim() ? myLiquidSlot.text : null
  const hasPending = myLiquidText !== null

  const handleCommit = useCallback(async () => {
    if (!kernelRef.current) return
    // Re-read the slot at commit time (peerLiquid changes between renders;
    // capture inside the callback to avoid a stale closure overwriting fresh
    // text the user just typed into their substrate slot).
    const slot = kernelRef.current.session.current_frame
      ? null
      : peerLiquid.find(lp => lp.is_self)
    const sourceText = slot?.text?.trim()
      ? slot.text
      : null
    if (!sourceText && !kernelRef.current.session.current_frame) return
    if (face === 'observer') {
      setSoftResponse({
        id: Date.now().toString(), originalInput: sourceText ?? '',
        text: 'Observer face is read-only. Switch to character / author / designer to commit.',
        softType: 'info', face, frameId: null,
      })
      return
    }
    // No identity gate — marks at beach:1 are open writes; anon commits
    // succeed via the anon-XXXXXX pseudo-handle. Synthesis requires an
    // API key but is bypassed cleanly when one isn't present.

    setIsCommitting(true)
    try {
      // Commit IS synthesis. Read recipe from shell:1.<face>.synthesis._ if
      // present (designer-authored override); else use the face default.
      const sf = shell?.faces.find(x => x.canonical === face)
      const recipeRaw = sf && (sf as unknown as { synthesis?: string }).synthesis
      const mode = parseRecipe(typeof recipeRaw === 'string' ? recipeRaw : null, face)
      const settingsContext = { beach_settings: beachSettings, user_settings: userSettings }
      // Phase D: collective policy is per-recipe. Resolve here so both medium
      // (gather) and the post-commit clear honour the same authored policy.
      const mediumRecipe = resolveRecipe('medium', face, settingsContext)
      const collective = getCollectivePolicy(mediumRecipe)

      let textToWrite = sourceText ?? ''
      if (mode !== 'bypass' && identity.apiKey && sourceText && identity.handle) {
        try {
          setLogs(prev => [...prev.slice(-50), `🌀 medium synthesising (${typeof mode === 'string' ? mode : 'custom'} · ${face} · ${peerLiquid.length} liquid slot${peerLiquid.length === 1 ? '' : 's'})…`])
          const r = await synthesise({
            apiKey: identity.apiKey,
            model: session.medium_model,
            agentId: identity.handle,
            face,
            pendingLiquid: sourceText,
            mode,
            session: kernelRef.current.session,
            marks, presence, frame, pool,
            peerLiquid,
            settingsContext,
          })
          if (!r.bypassed) {
            textToWrite = r.text
            setLogs(prev => [...prev.slice(-50), `🌀 synthesis: ${r.text.slice(0, 80)}`])
          }
        } catch (e) {
          setSoftResponse({
            id: Date.now().toString(), originalInput: sourceText,
            text: `(medium synthesis failed; committing raw): ${e instanceof Error ? e.message : 'unknown'}`,
            softType: 'info', face, frameId: null,
          })
        }
      }

      if (kernelRef.current.session.current_frame) {
        await kernelRef.current.commitLiquid(textToWrite)
      } else {
        await kernelRef.current.dropMark(textToWrite)
        // Phase D: clear behaviour is policy-driven. `self` (default) clears
        // only the committer's slot — peer autonomy preserved. `all` clears
        // every slot at the address — collective absorbed (brainstorm). The
        // governance variants (`consent`, `referenced`) require committed-flag
        // state on slots and land in a follow-up; they fall back to `self`.
        const k = kernelRef.current
        if (collective.clearPolicy === 'all') {
          k.clearLiquidAtAddress(peerLiquid.map(p => ({ digit: p.digit }))).catch(() => {})
        } else {
          k.clearMyBeachLiquid().catch(() => {})
        }
      }
    } finally {
      setIsCommitting(false)
    }
  }, [peerLiquid, identity.handle, identity.secret, identity.apiKey, face, shell, session.medium_model, marks, presence, frame, pool, beachSettings, userSettings])

  const handleCopyToVapor = useCallback((text: string) => {
    setVapor(text)
  }, [])

  // Substrate tray — direct calls to the five non-geometric primitives.
  // handleTrayAct was the handler for the (now-removed) header SubstrateTray.
  // The verbs it dispatched (register / grain_reach / key_publish /
  // create_collective / verify_rider) are reachable today via:
  //   - the floating ConstructionButton's verb tray
  //   - handleSubmit's verb-router (e.g. "register sed:<c> <decl>")
  //   - the soft-LLM with bsp-mcp tools
  // No live caller; removed alongside the tray render.

  // ── Derived data for the zones ──

  const liquidCards: LiquidCard[] = (() => {
    const cards: LiquidCard[] = []
    // No self-card — the floating button reflects "you have something pending"
    // via its commit● state, derived from the substrate (myLiquidSlot above).
    // Self and peers go through one truth-path: peer-cards rendered from the
    // substrate; self surfaced only as a button state.
    if (frame && session.entity_position) {
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
      // Beach mode: peer liquid from beach:7.<address> takes precedence over
      // bare presence. A presence entry without a liquid peer for the same
      // agent shows up as "present" (no text). A liquid peer replaces that
      // with the peer's current liquid text.
      const liquidByAgent = new Map<string, LiquidPeer>()
      for (const lp of peerLiquid) {
        // Include self too — renders as a peer-card with a `(you)` label
        // so the user sees their own submission alongside peers. Same
        // render path for self and peers; one substrate truth.
        if (lp.agent_id) liquidByAgent.set(lp.agent_id, lp)
      }
      for (const lp of liquidByAgent.values()) {
        const isSelf = lp.agent_id === effectiveAgentId
        cards.push({
          id: `liquid-${lp.agent_id}`,
          userId: `liquid-${lp.agent_id}`,
          userName: (lp.agent_id || 'peer') + (isSelf ? ' (you)' : ''),
          content: lp.text,
          timestamp: lp.timestamp ? Date.parse(lp.timestamp) : Date.now(),
        })
      }
      // De-dupe presence per agent_id — multiple presence digits or stale
      // entries can land for the same handle. Keep the freshest.
      const seenPresence = new Set<string>()
      const sortedPresence = [...presence].sort((a, b) =>
        (b.timestamp || '').localeCompare(a.timestamp || ''))
      for (const p of sortedPresence) {
        if (p.agent_id === effectiveAgentId) continue
        if (p.agent_id && liquidByAgent.has(p.agent_id)) continue // already shown as liquid
        const dedupeKey = p.agent_id || `anon-${p.timestamp || ''}`
        if (seenPresence.has(dedupeKey)) continue
        seenPresence.add(dedupeKey)
        cards.push({
          id: `peer-${dedupeKey}`,
          userId: `peer-${dedupeKey}`,
          userName: p.agent_id,
          content: p.summary || `present at ${p.address || '/'}`,
          timestamp: p.timestamp ? Date.parse(p.timestamp) : Date.now(),
        })
      }
    }
    return cards
  })()

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
      // Beach mode (no frame, no pool): show ALL substantive marks at this
      // address — co-presence on a block is the universal social primitive.
      // Solid is what has emerged here, not just what this user produced.
      // Self vs peer is a UI tag for SolidZone, not a filter.
      //
      // Sort newest-first by timestamp so a fresh commit lands at the top of
      // the visible solid zone (the zone is height-constrained; rendering in
      // raw digit order hides recent commits below the scroll fold).
      const recent = marks
        .filter(m => !m.is_presence)
        .slice()
        .sort((a, b) => {
          if (a.timestamp && b.timestamp) return b.timestamp.localeCompare(a.timestamp)
          return parseInt(b.digit) - parseInt(a.digit)
        })
      for (const m of recent) {
        out.push({
          id: `mark-${m.digit}`,
          title: m.agent_id && m.agent_id !== identity.handle ? m.agent_id : undefined,
          content: m.text,
          timestamp: m.timestamp ? Date.parse(m.timestamp) : Date.now(),
          face: m.face,
        })
      }
    }
    return out
  })()

  // Resolved via the substrate-as-program settings reader. Precedence:
  // per-user (shell:5) → per-beach (beach:5) → built-in default (12000ms).
  // Designer can override per-user by writing shell:5.1.1; per-beach by
  // writing beach:5.1.1. Spindle-targeted writes work for any digit-keyed
  // setting — no whole-object replacement required.
  const VAPOUR_STALENESS_MS = resolveSetting(
    { beach_settings: beachSettings, user_settings: userSettings },
    SETTINGS.VAPOUR_STALENESS,
    12_000
  )
  const now = Date.now()
  const vapourEntries: VapourEntry[] = Object.values(peerVapour)
    .filter(p =>
      p.vapour_text.trim().length > 0
      && (now - p.ts) < VAPOUR_STALENESS_MS
      && !mutedHandles.has(p.agent_id)
    )
    .map(p => ({
      id: `peer-vapour-${p.agent_id}`,
      userId: p.agent_id,
      userName: p.agent_id,
      text: p.vapour_text,
      timestamp: p.ts,
      isSelf: false,
    }))

  // Tri-state placeholder mirrors the V/L/S cycle the button drives:
  //   pending liquid → "commit solid (⇧↵)"  the next ⇧↵ promotes to solid
  //   has text       → "submit liquid (⇧↵)"  the next ⇧↵ writes liquid
  //   neither        → the canonical hint     teaches the V/L/S vocabulary
  const placeholderText = hasPending
    ? 'commit solid content (⇧↵)'
    : (vapor.trim()
        ? 'submit liquid intention (⇧↵)'
        : 'type vapour thinking · submit liquid intention · commit solid content')

  // Paywall gate — read `_tickets` on the face-bound sed: collective for the
  // current frame. Banner escalates from quiet → active when the user shows
  // write-intent (vapour non-empty or pending liquid waiting to commit).
  const paywallStatus = usePaywallGate({
    face,
    frame: session.current_frame ?? null,
    agentId: identity.handle,
  })
  const hasWriteIntent = vapor.trim().length > 0
    || hasPending
    || (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('paywall') === 'active')

  // Return-from-purchase: when the issuer's success URL hands the buyer back
  // here with ?ticket_grain=…&ticket_collective=…, the matching column runs
  // Step A (pscale_register + grain reference write).
  const stepAStatus = useStepARegistration({
    agentId: identity.handle,
    secret: identity.secret,
    collectiveRef: paywallStatus.kind === 'gated' ? paywallStatus.collectiveRef : null,
    tickets: paywallStatus.kind === 'gated' ? paywallStatus.tickets : null,
  })

  // Verifier-audit poll: kicks off when Step A returns `done`, OR when a
  // persisted watch is found on mount (resumes after reload). Cleared by the
  // hook on terminal verdict.
  const persistedWatch = useMemo(() => loadPersistedWatch(id), [id])
  const watchRegistrationRef =
    stepAStatus.kind === 'done'
      ? `${stepAStatus.collective}:${stepAStatus.position}`
      : persistedWatch?.registrationRef ?? null
  const watchVerifierId =
    stepAStatus.kind === 'done'
      ? (paywallStatus.kind === 'gated' ? paywallStatus.tickets.verifier : null)
      : persistedWatch?.verifierId ?? null
  const verificationStatus = useVerificationPoll({
    columnId: id,
    registrationRef: watchRegistrationRef,
    verifierId: watchVerifierId,
    agentId: identity.handle,
  })

  // ── Floating-button input registration ──
  // When this column is focused, push the inputs (vapor + handlers + pending
  // state) up to App so the global ConstructionButton can drive this column.
  // Re-pushed whenever any input-shape value changes; cleared on unmount.
  const inputs = useMemo<ColumnInputs>(() => ({
    value: vapor,
    onChange: setVapor,
    onSubmit: handleSubmit,
    onQuery: handleQuery,
    isQuerying: softPending,
    placeholder: placeholderText,
    face,
    pendingLiquid: hasPending,
    onCommit: handleCommit,
    isCommitting,
  }), [vapor, handleSubmit, handleQuery, softPending, placeholderText, face, hasPending, handleCommit, isCommitting])

  useEffect(() => {
    if (isFocused) onInputsChange(id, inputs)
  }, [isFocused, inputs, id, onInputsChange])
  // On unmount, clear our slot (in case we were focused).
  useEffect(() => {
    return () => { onInputsChange(id, null) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  // Inbox unread count (filtered by global acks).
  const unread = inbox.filter(i => !inboxAcks.has(`${i.beach}#${i.digit}`)).length

  return (
    <div
      className={`column-shell flex flex-col h-full min-w-0 relative ${isFocused ? 'column-focused' : 'column-unfocused'}`}
      data-face={face}
      onMouseDown={onFocus}
      onFocus={onFocus}
    >
      {/* Per-column header — column-header-tint picks up the column's
          face accent (subtle 8% alpha) so the user sees CADO-orientation
          at a glance across multi-column layouts. */}
      <div className="column-header-tint flex items-center gap-2 px-3 h-[44px] border-b border-border/50 text-sm shrink-0 z-10 relative overflow-x-auto">
        <span className={`text-xs font-mono ${identity.handle ? 'text-foreground font-semibold' : 'text-muted-foreground italic'}`}>
          {identity.handle || 'anon'}
        </span>

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
                  active ? 'text-white font-semibold' : 'bg-transparent text-muted-foreground hover:text-foreground'
                }`}
                style={active ? { background: `hsl(var(--face-${f}))` } : undefined}
                title={sf?.label || f}
              >
                {long.charAt(0).toUpperCase()}
              </button>
            )
          })}
        </div>

        <div className="flex items-center gap-1 text-xs font-mono border border-border/50 rounded px-2 py-0.5 text-foreground min-w-0 shrink">
          <span title="beach" className="text-muted-foreground shrink-0">🌊</span>
          <input
            type="text"
            value={beach}
            onChange={e => setBeach(e.target.value)}
            className="bg-transparent border-none outline-none text-muted-foreground"
            style={{ width: '8rem' }}
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
              style={{ width: '6rem' }}
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

        <div className="ml-auto flex items-center gap-1.5 shrink-0">
          {/* SubstrateTray (reach / register / keys / passport / planet) lives
              on the floating ConstructionButton — it was duplicated here from
              the pre-button-tray era. Removed so registering a handle no
              longer mutates the header. */}
          {identity.handle && (
            <button
              onClick={() => setInboxOpen(v => !v)}
              className={`text-xs px-2 py-0.5 rounded border border-border/50 transition-colors relative ${inboxOpen ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              title={`inbox — across watched beaches mentioning ${identity.handle}`}
            >
              📬{unread > 0 && <span className="ml-1 text-[10px] font-semibold">{unread}</span>}
            </button>
          )}
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
          <span
            className="text-xs"
            title={
              vapourStatus === 'subscribed' ? 'vapour channel live'
              : vapourStatus === 'pending' ? 'vapour subscribing…'
              : vapourStatus === 'no-transport' ? 'vapour transport unavailable (Supabase env vars missing?)'
              : 'vapour subscribe failed (network / auth / RLS)'
            }
          >
            {vapourStatus === 'subscribed' ? '☁️'
              : vapourStatus === 'pending' ? '☁️…'
              : '⚠️'}
          </span>
          {onClose && (
            <button
              onClick={(e) => { e.stopPropagation(); onClose() }}
              className="text-xs px-1.5 py-0.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10"
              title="close column"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* V/L/S */}
      <div className="flex-1 min-h-0 flex flex-col relative">
        <SolidZone blocks={solidBlocks} height={solidHeight} />
        <DraggableSeparator position="top" onDrag={handleTopDrag} />
        <PaywallBanner status={paywallStatus} hasIntent={hasWriteIntent} stepA={stepAStatus} verification={verificationStatus} />
        <LiquidZone
          cards={liquidCards}
          height={liquidHeight}
          currentUserId="self"
          onCopyToVapor={handleCopyToVapor}
        />
        <DraggableSeparator position="bottom" onDrag={handleBottomDrag} />
        <VapourZone
          entries={vapourEntries}
          softResponse={softPending ? null : softResponse}
          onDismissSoftResponse={() => setSoftResponse(null)}
          onMutePeer={muteKey ? toggleMute : undefined}
        />

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
          onShellSaved={props.onShellSaved}
          onNavigateAddress={setCurrentAddress}
        />

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
          onAck={key => onAckInbox(key)}
        />
      </div>
    </div>
  )
}
