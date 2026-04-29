/**
 * App.tsx — xstream beach client.
 *
 * Single panel V/L/S surface against bsp-mcp commons or any federated beach.
 * Setup → identity + beach choice; Ready → BeachPanel + header (face switcher,
 * address bar, substrate-tool tray, presence indicator).
 *
 * No game kernel. No fantasy seeds. Just substrate I/O + a UI on top.
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import SetupScreen, { type ActivationContext } from './components/SetupScreen'
import { SubstrateTray, type SubstrateAct } from './components/SubstrateTray'
import { BeachPanel } from './components/BeachPanel'
import { BeachKernel } from './kernel/beach-kernel'
import { createBeachSession, type BeachSession, type MarkRow, type FrameView } from './kernel/beach-session'
import { setHiddenRef, beachToRef, resolveRef, type AgentShell, type PresenceMark } from './lib/bsp-client'
import { getBlock, injectBlock } from './kernel/block-store'
import type { Face } from './types/xstream'
import './App.css'

type AppPhase = 'setup' | 'loading' | 'ready'
type Theme = 'dark' | 'light' | 'cyber' | 'soft'

export default function App() {
  // Session
  const [phase, setPhase] = useState<AppPhase>('setup')
  const [session, setSession] = useState<BeachSession | null>(null)
  const [shell, setShell] = useState<AgentShell | null>(null)
  const [statusMessage, setStatusMessage] = useState('')
  const kernelRef = useRef<BeachKernel | null>(null)

  // Theme + Face
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem('xstream-theme') as Theme) || 'light'
  )
  const [face, setFace] = useState<Face>(
    () => (localStorage.getItem('xstream-face') as Face) || 'character'
  )

  // Live data from kernel
  const [presence, setPresence] = useState<PresenceMark[]>([])
  const [marks, setMarks] = useState<MarkRow[]>([])
  const [frame, setFrame] = useState<FrameView | null>(null)
  const [, setLogs] = useState<string[]>([])

  // Vapor draft + currentAddress (mirrors session for live UI updates)
  const [vapor, setVapor] = useState('')
  const [currentAddress, setCurrentAddress] = useState('')

  // Frame name input — when entering a specific frame
  const [frameInput, setFrameInput] = useState('')

  useEffect(() => {
    localStorage.setItem('xstream-theme', theme)
  }, [theme])

  useEffect(() => {
    localStorage.setItem('xstream-face', face)
  }, [face])

  useEffect(() => () => { kernelRef.current?.stop() }, [])

  const handleActivate = useCallback(async (ctx: ActivationContext) => {
    setPhase('loading')
    setStatusMessage(ctx.bootstrapped ? 'Shell bootstrapped — entering…' : 'Entering…')

    const startingFace = ctx.shell.faces.find(f => f.canonical === 'character') ?? ctx.shell.faces[0]
    const initialAddress = ctx.address || (startingFace?.default_address ?? '')

    const sess = createBeachSession({
      agent_id: ctx.agentId,
      secret: ctx.secret,
      beach: ctx.beach,
      address: initialAddress,
      api_key: ctx.apiKey || null,
    })
    setSession(sess)
    setShell(ctx.shell)
    setCurrentAddress(initialAddress)

    // Wire the agent blocks' hidden directories to this user's beach.
    const beachRef = beachToRef(ctx.beach)
    if (beachRef) {
      for (const agentBlockName of ['medium-agent', 'soft-agent', 'hard-agent']) {
        const ab = getBlock(agentBlockName)
        if (ab) setHiddenRef(ab, '1', beachRef)
      }
      try {
        const resolved = await resolveRef(beachRef, ctx.agentId)
        if (resolved.block) injectBlock(beachRef, resolved.block)
      } catch (e) {
        console.warn('[activate] beach prefetch failed:', e)
      }
    }

    const kernel = new BeachKernel(sess, {
      onPresence: setPresence,
      onMarks: setMarks,
      onFrame: setFrame,
      onError: msg => setLogs(prev => [...prev.slice(-50), `❌ ${msg}`]),
      onLog: msg => setLogs(prev => [...prev.slice(-50), msg]),
    })
    kernelRef.current = kernel
    kernel.start()

    setStatusMessage('')
    setPhase('ready')
  }, [])

  const handleFaceChange = useCallback((newFace: Face) => {
    setFace(newFace)
    if (shell && kernelRef.current) {
      const f = shell.faces.find(x => x.canonical === newFace)
      if (f && f.default_address) {
        kernelRef.current.setAddress(f.default_address)
        setCurrentAddress(f.default_address)
      }
    }
  }, [shell])

  const handleAddressChange = useCallback((addr: string) => {
    setCurrentAddress(addr)
    kernelRef.current?.setAddress(addr)
  }, [])

  const handleEnterFrame = useCallback(() => {
    if (!frameInput.trim() || !kernelRef.current) return
    // For now, all entrants take entity position '1'. The host who creates
    // the frame is presumably already in position 1, etc. Per-entity
    // assignment (asking the host's daemon for a slot) is a follow-up.
    kernelRef.current.setFrame(frameInput.trim(), '1')
    if (session) setSession({ ...session, current_frame: frameInput.trim(), entity_position: '1' })
  }, [frameInput, session])

  const handleLeaveFrame = useCallback(() => {
    kernelRef.current?.setFrame(null, null)
    if (session) setSession({ ...session, current_frame: null, entity_position: null })
  }, [session])

  const handleDropMark = useCallback(async (text: string) => {
    await kernelRef.current?.dropMark(text)
  }, [])

  const handleCommitLiquid = useCallback(async (text: string) => {
    await kernelRef.current?.commitLiquid(text)
  }, [])

  // ── Render ──

  if (phase === 'setup') {
    return <SetupScreen onActivate={handleActivate} />
  }

  if (phase === 'loading' || !session) {
    return (
      <div className="app" data-theme={theme}>
        <div className="flex items-center justify-center h-screen">
          <p className="text-sm text-muted-foreground animate-pulse">{statusMessage || 'Loading…'}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="app" data-theme={theme} data-face={face}>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 h-[44px] border-b border-border/50 text-sm shrink-0">
        <span className="text-face-accent font-medium">{session.agent_id}</span>

        {/* Face switcher — 4 CADO slots, single-letter labels */}
        <div className="flex items-center gap-0.5 border border-border/50 rounded overflow-hidden shrink-0">
          {(['character', 'author', 'designer', 'observer'] as const).map(f => {
            const sf = shell?.faces.find(x => x.canonical === f)
            const long = sf?.label?.split('—')[0]?.trim() || f
            const short = (long.charAt(0).toUpperCase())
            const active = face === f
            return (
              <button
                key={f}
                onClick={() => handleFaceChange(f)}
                className={`text-xs px-2 py-0.5 border-none cursor-pointer transition-colors ${
                  active
                    ? 'bg-accent text-foreground font-semibold'
                    : 'bg-transparent text-muted-foreground hover:text-foreground'
                }`}
                title={sf?.label || f}
              >
                {short}
              </button>
            )
          })}
        </div>

        {/* Unified address bar */}
        <div className="flex items-center gap-1 text-xs font-mono border border-border/50 rounded px-2 py-0.5 text-foreground min-w-0">
          <span title="beach scope" className="text-muted-foreground shrink-0">🌊</span>
          <span className="text-muted-foreground truncate max-w-[12rem]" title={session.current_beach}>{session.current_beach}</span>
          <span className="text-muted-foreground shrink-0">:</span>
          <input
            type="text"
            value={currentAddress}
            placeholder="(root)"
            onChange={e => handleAddressChange(e.target.value)}
            className="bg-transparent border-none outline-none text-foreground font-mono"
            style={{ width: '5rem' }}
            title="Current pscale address. Edit to navigate."
          />
        </div>

        {/* Frame entry / exit */}
        {session.current_frame ? (
          <button
            onClick={handleLeaveFrame}
            className="text-xs px-2 py-0.5 rounded border border-border/50 text-muted-foreground hover:text-foreground"
            title="Leave the current frame"
          >
            🎬✕ leave
          </button>
        ) : (
          <div className="flex items-center gap-1">
            <input
              type="text"
              value={frameInput}
              onChange={e => setFrameInput(e.target.value)}
              placeholder="frame:scene-id"
              className="bg-transparent border border-border/50 rounded px-2 py-0.5 text-xs font-mono text-foreground outline-none"
              style={{ width: '8rem' }}
              onKeyDown={e => e.key === 'Enter' && handleEnterFrame()}
            />
            <button
              onClick={handleEnterFrame}
              disabled={!frameInput.trim()}
              className="text-xs px-2 py-0.5 rounded bg-primary/80 text-primary-foreground disabled:opacity-30"
              title="Enter frame"
            >
              enter
            </button>
          </div>
        )}

        {/* Substrate-tool tray */}
        <SubstrateTray
          agentId={session.agent_id}
          onAct={(act: SubstrateAct) => {
            setLogs(prev => [...prev.slice(-50), `🛠 substrate ${act.kind}: ${JSON.stringify(act).slice(0, 200)}`])
          }}
        />

        {/* Theme cycle */}
        <button
          onClick={() => {
            const next: Record<Theme, Theme> = { dark: 'light', light: 'cyber', cyber: 'soft', soft: 'dark' }
            setTheme(next[theme])
          }}
          className="text-xs px-2 py-0.5 rounded border border-border/50 text-muted-foreground hover:text-foreground ml-auto"
          title={`theme: ${theme} (click to cycle)`}
        >
          {theme}
        </button>
      </div>

      {/* Beach panel */}
      <div className="flex-1 min-h-0">
        <BeachPanel
          session={session}
          presence={presence}
          marks={marks}
          frame={frame}
          vapor={vapor}
          onVaporChange={setVapor}
          onDropMark={handleDropMark}
          onCommitLiquid={handleCommitLiquid}
        />
      </div>
    </div>
  )
}
