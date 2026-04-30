/**
 * App.tsx — xstream beach client.
 *
 * Anonymous landing on the V/L/S surface. No setup gate. Identity, viewer
 * and substrate tools live in the header as toggles. The user can:
 *
 *   - type into vapour and think privately (always);
 *   - identify (👤) to leave traces (commit to substrate);
 *   - add an API key to engage the soft-LLM (⇧↵) and medium-LLM on commit;
 *   - open the viewer (👁) to see what their face attends to on the beach.
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import { IdentityPopover, loadIdentity, type IdentityValues } from './components/IdentityPopover'
import { ViewerDrawer } from './components/ViewerDrawer'
import { SubstrateTray, type SubstrateAct } from './components/SubstrateTray'
import { VLSPanel } from './components/VLSPanel'
import { BeachKernel } from './kernel/beach-kernel'
import { createBeachSession, type BeachSession, type MarkRow, type FrameView } from './kernel/beach-session'
import { setHiddenRef, beachToRef, resolveRef, readShell, bootstrapShell, type AgentShell, type PresenceMark } from './lib/bsp-client'
import { getBlock, injectBlock } from './kernel/block-store'
import { callClaude } from './kernel/claude-direct'
import type { Face } from './types/xstream'
import './App.css'

type Theme = 'dark' | 'light' | 'cyber' | 'soft'

const DEFAULT_BEACH = 'https://happyseaurchin.com'
const BEACH_KEY = 'xstream:current-beach'

export default function App() {
  const [identity, setIdentity] = useState<IdentityValues>(() => loadIdentity())
  const [identityOpen, setIdentityOpen] = useState(false)
  const [viewerOpen, setViewerOpen] = useState(false)

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

  // Live data from kernel
  const [presence, setPresence] = useState<PresenceMark[]>([])
  const [marks, setMarks] = useState<MarkRow[]>([])
  const [frame, setFrame] = useState<FrameView | null>(null)
  const [, setLogs] = useState<string[]>([])

  // Vapour
  const [vapor, setVapor] = useState('')
  const [softResponse, setSoftResponse] = useState<string | null>(null)
  const [softPending, setSoftPending] = useState(false)

  // Build a session synchronously from identity + beach + address
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

  // Persist theme + face + beach
  useEffect(() => { localStorage.setItem('xstream-theme', theme) }, [theme])
  useEffect(() => { localStorage.setItem('xstream-face', face) }, [face])
  useEffect(() => { localStorage.setItem(BEACH_KEY, beach) }, [beach])

  // Kernel lifecycle: keep one kernel instance alive across the session;
  // mutate its session via setters (don't recreate).
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
    return () => {
      kernel.stop()
      kernelRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // When identity changes, attempt shell read/bootstrap & wire agent blocks.
  useEffect(() => {
    if (!identity.handle) {
      setShell(null)
      return
    }
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

  // When beach changes, wire agent blocks' hidden directories + prefetch the beach block.
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

  // Sync session to identity / beach / address / api key changes (kernel mutates internally).
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
      // Mutate the kernel's running session so its next cycle picks up changes.
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

  const handleFaceChange = useCallback((newFace: Face) => {
    setFace(newFace)
    if (shell) {
      const f = shell.faces.find(x => x.canonical === newFace)
      if (f && f.default_address) {
        setCurrentAddress(f.default_address)
      }
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

  const handleCommit = useCallback(async (text: string) => {
    if (!kernelRef.current) return
    if (kernelRef.current.session.current_frame) {
      await kernelRef.current.commitLiquid(text)
    } else {
      await kernelRef.current.dropMark(text)
    }
  }, [])

  const handleSoftQuery = useCallback(async (text: string) => {
    if (!identity.apiKey) return
    setSoftPending(true)
    setSoftResponse(null)
    try {
      const softAgent = getBlock('soft-agent')
      const systemPrompt = typeof softAgent === 'object' && softAgent && '_' in softAgent
        ? (typeof (softAgent as Record<string, unknown>)._ === 'string'
            ? (softAgent as Record<string, string>)._
            : 'You are a soft-LLM partner. Help the user think.')
        : 'You are a soft-LLM partner. Help the user think.'
      const prompt = `${systemPrompt}\n\nUser thought: ${text}`
      const reply = await callClaude(identity.apiKey, 'claude-haiku-4-5-20251001', prompt, 512)
      setSoftResponse(reply)
    } catch (e) {
      setSoftResponse(`(soft error: ${e instanceof Error ? e.message : 'unknown'})`)
    } finally {
      setSoftPending(false)
    }
  }, [identity.apiKey])

  const handleSaveIdentity = useCallback((v: IdentityValues) => {
    setIdentity(v)
  }, [])

  const handleAct = useCallback((act: SubstrateAct) => {
    setLogs(prev => [...prev.slice(-50), `🛠 substrate ${act.kind}: ${JSON.stringify(act).slice(0, 200)}`])
    // TODO: wire to real bsp() / pscale_register / pscale_grain_reach calls.
  }, [])

  const isAnonymous = !identity.handle

  return (
    <div className="app relative" data-theme={theme} data-face={face}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 h-[44px] border-b border-border/50 text-sm shrink-0 z-10 relative bg-background">
        {/* Identity indicator */}
        <button
          onClick={() => setIdentityOpen(true)}
          className="flex items-center gap-1.5 text-xs px-2 py-0.5 rounded border border-border/50 hover:bg-accent text-foreground"
          title="identity"
        >
          <span>👤</span>
          <span className={isAnonymous ? 'text-muted-foreground italic' : 'font-medium text-face-accent'}>
            {isAnonymous ? 'anon' : identity.handle}
          </span>
          {identity.apiKey && <span className="text-[10px] text-muted-foreground">·llm</span>}
        </button>

        {/* Face switcher */}
        <div className="flex items-center gap-0.5 border border-border/50 rounded overflow-hidden shrink-0">
          {(['character', 'author', 'designer', 'observer'] as const).map(f => {
            const sf = shell?.faces.find(x => x.canonical === f)
            const long = sf?.label?.split('—')[0]?.trim() || f
            const short = long.charAt(0).toUpperCase()
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
                {short}
              </button>
            )
          })}
        </div>

        {/* Address bar */}
        <div className="flex items-center gap-1 text-xs font-mono border border-border/50 rounded px-2 py-0.5 text-foreground min-w-0">
          <span title="beach" className="text-muted-foreground shrink-0">🌊</span>
          <input
            type="text"
            value={beach}
            onChange={e => setBeach(e.target.value)}
            className="bg-transparent border-none outline-none text-muted-foreground"
            style={{ width: '11rem' }}
            title="beach (URL or commons key)"
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

        <SubstrateTray agentId={identity.handle || '(anon)'} onAct={handleAct} />

        <div className="ml-auto flex items-center gap-2">
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

          <button
            onClick={() => {
              const next: Record<Theme, Theme> = { dark: 'light', light: 'cyber', cyber: 'soft', soft: 'dark' }
              setTheme(next[theme])
            }}
            className="text-xs px-2 py-0.5 rounded border border-border/50 text-muted-foreground hover:text-foreground"
            title={`theme: ${theme}`}
          >
            {theme}
          </button>
        </div>
      </div>

      {/* V/L/S surface */}
      <div className="flex-1 min-h-0 relative">
        <VLSPanel
          session={session}
          presence={presence}
          marks={marks}
          frame={frame}
          vapor={vapor}
          onVaporChange={setVapor}
          onCommit={handleCommit}
          onSoftQuery={handleSoftQuery}
          softResponse={softResponse}
          softPending={softPending}
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

      {/* Identity popover */}
      <IdentityPopover
        open={identityOpen}
        onClose={() => setIdentityOpen(false)}
        onSave={handleSaveIdentity}
        initial={identity}
      />
    </div>
  )
}
