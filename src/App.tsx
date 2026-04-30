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
import { BeachKernel } from './kernel/beach-kernel'
import { createBeachSession, type BeachSession, type MarkRow, type FrameView } from './kernel/beach-session'
import { setHiddenRef, beachToRef, resolveRef, readShell, bootstrapShell, bsp, pscaleRegister, pscaleGrainReach, pscaleKeyPublish, type AgentShell, type PresenceMark } from './lib/bsp-client'
import { getBlock, injectBlock } from './kernel/block-store'
import { callClaudeWithTools, callClaudeViaMcpConnector, composeContext, buildSoftSystemPrompt } from './kernel/claude-tools'
import type { SolidBlock, LiquidCard, VapourEntry, Theme } from './types/xstream'
import type { Face } from './types/xstream'
import type { SoftLLMResponse } from './types'
import './App.css'

const HANDLE_KEY = 'xstream:handle'
const SECRET_SESSION_KEY = 'xstream:secret'
const API_KEY_SESSION_KEY = 'xstream:api-key'
const BEACH_KEY = 'xstream:current-beach'
const DEFAULT_BEACH = 'https://happyseaurchin.com'

const MIN_ZONE = 80

function loadIdentity() {
  return {
    handle: localStorage.getItem(HANDLE_KEY) ?? '',
    secret: sessionStorage.getItem(SECRET_SESSION_KEY) ?? '',
    apiKey: sessionStorage.getItem(API_KEY_SESSION_KEY) ?? localStorage.getItem('xstream-api-key') ?? '',
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

  // Live data from kernel
  const [presence, setPresence] = useState<PresenceMark[]>([])
  const [marks, setMarks] = useState<MarkRow[]>([])
  const [frame, setFrame] = useState<FrameView | null>(null)
  const [, setLogs] = useState<string[]>([])

  // Vapour
  const [vapor, setVapor] = useState('')
  const [softResponse, setSoftResponse] = useState<SoftLLMResponse | null>(null)
  const [softPending, setSoftPending] = useState(false)

  // Pending liquid card (after ⇧↵, before commit)
  const [pendingLiquid, setPendingLiquid] = useState<string | null>(null)

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
      }
      if (kernelRef.current) {
        kernelRef.current.session.agent_id = next.agent_id
        kernelRef.current.session.secret = next.secret
        kernelRef.current.session.api_key = next.api_key
        kernelRef.current.setBeach(next.current_beach)
        kernelRef.current.setAddress(next.current_address)
      }
      return next
    })
  }, [identity.handle, identity.secret, identity.apiKey, beach, currentAddress])

  // Persist identity changes
  useEffect(() => {
    if (identity.handle) localStorage.setItem(HANDLE_KEY, identity.handle); else localStorage.removeItem(HANDLE_KEY)
    if (identity.secret) sessionStorage.setItem(SECRET_SESSION_KEY, identity.secret); else sessionStorage.removeItem(SECRET_SESSION_KEY)
    if (identity.apiKey) sessionStorage.setItem(API_KEY_SESSION_KEY, identity.apiKey); else sessionStorage.removeItem(API_KEY_SESSION_KEY)
  }, [identity])

  // ── Handlers ──

  const handleTopDrag = useCallback((delta: number) => {
    setSolidHeight(h => Math.max(MIN_ZONE, h + delta))
    setLiquidHeight(h => Math.max(MIN_ZONE, h - delta))
  }, [])
  const handleBottomDrag = useCallback((delta: number) => {
    setLiquidHeight(h => Math.max(MIN_ZONE, h + delta))
  }, [])

  const handleFaceChange = useCallback((newFace: Face) => {
    setFace(newFace)
    if (shell) {
      const f = shell.faces.find(x => x.canonical === newFace)
      if (f && f.default_address) setCurrentAddress(f.default_address)
    }
  }, [shell])

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

    // keys (publish ed25519 + x25519)
    if (/^keys$/i.test(trimmed)) {
      if (!identity.handle || !identity.secret) { reportInfo('Identify first (button → Identity).'); return }
      reportInfo(`🔑 deriving + publishing keys…`)
      const r = await pscaleKeyPublish({ agent_id: identity.handle, secret: identity.secret })
      reportInfo(r.ok ? `🔑 ${r.message}` : `key publish failed: ${r.message}`)
      setVapor('')
      return
    }

    // Default: pass to the existing pending-liquid → commit flow (mark drop
    // or in-frame liquid commit, depending on session state).
    setPendingLiquid(trimmed)
    setVapor('')
  }, [face, identity.handle, identity.secret])

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

  // Solid blocks: my contributions (own marks) or frame synthesis
  const solidBlocks: SolidBlock[] = (() => {
    const out: SolidBlock[] = []
    if (frame && frame.synthesis) {
      out.push({
        id: 'synthesis',
        title: 'Synthesis',
        content: frame.synthesis + (frame.synthesis_envelope ? `\n\n${frame.synthesis_envelope}` : ''),
        timestamp: Date.now(),
      })
    }
    if (frame && session.entity_position) {
      const my = frame.entities.find(e => e.position === session.entity_position)
      if (my && my.solid) {
        out.push({ id: 'self-solid', title: 'You · last committed', content: my.solid, timestamp: Date.now() })
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
        })
      }
    }
    return out
  })()

  // Vapour entries: peers' vapour (none today — placeholder for realtime)
  const vapourEntries: VapourEntry[] = []

  const placeholderText = identity.apiKey
    ? 'type · ⌘↵ ask soft · ⇧↵ submit'
    : (identity.handle ? 'type · ⇧↵ submit' : 'type to think · identify in button to engage')

  return (
    <div className="app relative" data-theme={theme} data-face={face}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 h-[44px] border-b border-border/50 text-sm shrink-0 z-10 relative bg-background overflow-x-auto">
        <span className={`text-xs font-mono ${identity.handle ? 'text-face-accent font-semibold' : 'text-muted-foreground italic'}`}>
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
        }}
      />
    </div>
  )
}
