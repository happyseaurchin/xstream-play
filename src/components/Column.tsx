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
import { DraggableSeparator } from './DraggableSeparator'
import { ViewerDrawer } from './ViewerDrawer'
import { InboxDrawer } from './InboxDrawer'
import { BeachKernel, type InboxItem } from '../kernel/beach-kernel'
import { createBeachSession, type BeachSession, type MarkRow, type FrameView, type PoolView } from '../kernel/beach-session'
import { setHiddenRef, beachToRef, resolveRef, bsp, pscaleRegister, pscaleGrainReach, pscaleKeyPublish, type AgentShell, type PresenceMark, type PscaleNode } from '../lib/bsp-client'
import { joinVapourChannel, deriveScope, type VapourChannelHandle, type VapourBroadcast } from '../lib/realtime'
import { getBlock, injectBlock } from '../kernel/block-store'
import { callClaudeWithTools, callClaudeViaMcpConnector, composeContext, buildSoftSystemPrompt } from '../kernel/claude-tools'
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
}

export interface ColumnProps {
  id: string
  identity: { handle: string; secret: string; apiKey: string }
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
  const { id, identity, shell, inboxAcks, onAckInbox, isFocused, onFocus, onClose, onInputsChange } = props

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
  const [frame, setFrame] = useState<FrameView | null>(null)
  const [pool, setPool] = useState<PoolView | null>(null)
  const [inbox, setInbox] = useState<InboxItem[]>([])
  const [, setLogs] = useState<string[]>([])

  // Vapour
  const [vapor, setVapor] = useState('')
  const [softResponse, setSoftResponse] = useState<SoftLLMResponse | null>(null)
  const [softPending, setSoftPending] = useState(false)

  // Live peer vapour
  const [peerVapour, setPeerVapour] = useState<Record<string, VapourBroadcast>>({})
  const vapourChannelRef = useRef<VapourChannelHandle | null>(null)
  const vapourBroadcastDebounceRef = useRef<number | null>(null)

  const [pendingLiquid, setPendingLiquid] = useState<string | null>(null)

  // Per-face surface memory — lives per-handle in localStorage so flicking
  // face within a column restores that face's last (address, vapor, pending).
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
      agent_id: identity.handle,
      secret: identity.secret,
      beach,
      address: currentAddress,
      api_key: identity.apiKey || null,
      face,
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
      onInbox: setInbox,
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

  // Live peer vapour — channel scope keyed by (beach, address, frame, entity).
  useEffect(() => {
    if (vapourChannelRef.current) {
      vapourChannelRef.current.leave().catch(() => {})
      vapourChannelRef.current = null
    }
    setPeerVapour({})
    if (!identity.handle) return
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
      onPeer: msg => { setPeerVapour(prev => ({ ...prev, [msg.agent_id]: msg })) },
    })
    if (handle) vapourChannelRef.current = handle
    return () => {
      if (vapourChannelRef.current) {
        vapourChannelRef.current.leave().catch(() => {})
        vapourChannelRef.current = null
      }
    }
  }, [identity.handle, beach, currentAddress, session.current_frame, session.entity_position, face])

  // Broadcast our vapour as it changes, debounced ~80 ms.
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
    const snapshot: FaceMemory = { address: currentAddress, vapor, pendingLiquid }
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
          const ctx = composeContext({ session, shell, face, marks, presence, frame, userMessage: text })
          const sysPrompt = buildSoftSystemPrompt({ agentId: identity.handle, face, ctx })
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
  }, [identity.apiKey, identity.handle, face, session, shell, marks, presence, frame])

  // ⇧↵ — submit (verb prefix or default to liquid commit flow).
  const handleSubmit = useCallback(async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return

    const reportInfo = (msg: string) => setSoftResponse({
      id: Date.now().toString(), originalInput: text, text: msg,
      softType: 'info', face, frameId: null,
    })

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

    setPendingLiquid(trimmed)
    setVapor('')
  }, [face, identity.handle, identity.secret, beach])

  const handleCommit = useCallback(async (_cardId: string) => {
    if (!pendingLiquid || !kernelRef.current) return
    if (!identity.handle || !identity.secret) {
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

  // ── Floating-button input registration ──
  // When this column is focused, push the inputs (vapor + handlers) up to App
  // so the global ConstructionButton can drive this column. Re-pushed whenever
  // any input-shape value changes; cleared on unmount.
  const inputs = useMemo<ColumnInputs>(() => ({
    value: vapor,
    onChange: setVapor,
    onSubmit: handleSubmit,
    onQuery: handleQuery,
    isQuerying: softPending,
    placeholder: placeholderText,
  }), [vapor, handleSubmit, handleQuery, softPending, placeholderText])

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
                  active ? 'bg-accent text-foreground font-semibold' : 'bg-transparent text-muted-foreground hover:text-foreground'
                }`}
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
