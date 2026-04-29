/**
 * App.block-agents.tsx — xstream UI powered by sovereign browser kernel.
 *
 * Three zones with draggable separators, themes, floating input button.
 * Engine: Kernel (polls relay, fires medium-LLM on commit/domino).
 * Soft-LLM (ASK) remains a direct call — no coordination needed.
 * Pure browser — no server runs LLM calls. All API costs are the player's.
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import SetupScreen, { type ActivationContext } from './components/SetupScreen'
import { SubstrateTray, type SubstrateAct } from './components/SubstrateTray'
import { setHiddenRef, beachToRef, resolveRef, type AgentShell } from './lib/bsp-client'
import { SolidZone } from './components/xstream/SolidZone'
import { LiquidZone } from './components/xstream/LiquidZone'
import { VapourZone } from './components/xstream/VapourZone'
import { DraggableSeparator } from './components/DraggableSeparator'
import { ConstructionButton } from './components/xstream/ConstructionButton'
import { Kernel } from './kernel/kernel'
import { createBlock, generateGameCode, generateCharId } from './kernel/block-factory'
import { callClaude } from './kernel/claude-direct'
import { buildSoftPrompt } from './kernel/soft-prompt'
import type { SolidBlock, LiquidCard } from './types/xstream'
import type { Face } from './types/xstream'
import type { SoftLLMResponse } from './types'
import { listBlocks, getBlock, hydrateFromSaved, overlayBlocks, injectBlock } from './kernel/block-store'
import { bsp, type SpindleResult } from './kernel/bsp'
// (Legacy pscale-mcp bridge imports removed — bsp-client now talks to the commons directly.)
import { loadKernelBlock, loadAllBlocks, exportGameState, importGameState, setCurrentGame, saveBlock } from './kernel/persistence'
import type { SavedGame } from './kernel/persistence'
import { SaveModal } from './components/SaveModal'
import './App.css'

type AppPhase = 'setup' | 'loading' | 'ready'
type Theme = 'dark' | 'light' | 'cyber' | 'soft'

const MIN_ZONE = 80

export default function App() {
  // Session
  const [phase, setPhase] = useState<AppPhase>('setup')
  const [apiKey, setApiKey] = useState('')
  const [characterName, setCharacterName] = useState('')
  const [gameCode, setGameCode] = useState('')
  const [shell, setShell] = useState<AgentShell | null>(null)
  const [currentAddress, setCurrentAddress] = useState('')

  // Kernel
  const kernelRef = useRef<Kernel | null>(null)

  // Theme + Face (declared early — solidBlocks depends on face)
  const [theme, setTheme] = useState<Theme>(() =>
    (localStorage.getItem('xstream-theme') as Theme) || 'dark'
  )
  const [face, setFace] = useState<Face>(() =>
    (localStorage.getItem('xstream-face') as Face) || 'character'
  )

  // UI data — solid blocks scoped per face
  const [characterSolids, setCharacterSolids] = useState<SolidBlock[]>([])
  const [authorSolids, setAuthorSolids] = useState<SolidBlock[]>([])
  const [designerSolids, setDesignerSolids] = useState<SolidBlock[]>([])
  const solidBlocks = face === 'author' ? authorSolids : face === 'designer' ? designerSolids : characterSolids
  const [liquidCards, setLiquidCards] = useState<LiquidCard[]>([])
  const [softResponse, setSoftResponse] = useState<SoftLLMResponse | null>(null)
  const [synthesising, setSynthesising] = useState(false)
  const [softLoading, setSoftLoading] = useState(false)
  const [statusMessage, setStatusMessage] = useState('')
  const [vaporText, setVaporText] = useState('')
  const [kernelStatus, setKernelStatus] = useState('idle')
  const [kernelLogs, setKernelLogs] = useState<string[]>([])
  const [accumulatedCount, setAccumulatedCount] = useState(0)
  const [dominoMode, setDominoMode] = useState<'auto' | 'informed' | 'silent'>('auto')
  const [showSaveModal, setShowSaveModal] = useState(false)

  // Zone heights (proportional)
  const [solidHeight, setSolidHeight] = useState(() => window.innerHeight * 0.35)
  const [liquidHeight, setLiquidHeight] = useState(() => window.innerHeight * 0.30)

  useEffect(() => {
    localStorage.setItem('xstream-theme', theme)
  }, [theme])

  useEffect(() => {
    localStorage.setItem('xstream-face', face)
    // Set sensible edit defaults when switching face
    if (face === 'author') {
      setEditTarget('spatial-thornkeep')
      setEditAddress(kernelRef.current?.block.spatial_address ?? '111')
    } else if (face === 'designer') {
      setEditTarget('rules-thornkeep')
      setEditAddress('0')
    }
  }, [face])

  // Cleanup kernel on unmount
  useEffect(() => {
    return () => { kernelRef.current?.stop() }
  }, [])

  // --- Draggable separator handlers ---
  const handleTopDrag = useCallback((delta: number) => {
    setSolidHeight(h => Math.max(MIN_ZONE, h + delta))
    setLiquidHeight(h => Math.max(MIN_ZONE, h - delta))
  }, [])

  const handleBottomDrag = useCallback((delta: number) => {
    setLiquidHeight(h => Math.max(MIN_ZONE, h + delta))
  }, [])

  // --- Kernel callbacks ---
  const makeKernelCallbacks = useCallback(() => ({
    onSolid: (solid: string) => {
      if (!solid) return
      const entry = { id: Date.now().toString(), content: solid, timestamp: Date.now() }
      // Route to the face that produced this solid
      const f = kernelRef.current?.face ?? 'character'
      if (f === 'author') setAuthorSolids(prev => [...prev, entry])
      else if (f === 'designer') setDesignerSolids(prev => [...prev, entry])
      else setCharacterSolids(prev => [...prev, entry])
      // Clear liquid cards — covers both commit and domino-triggered solids
      setLiquidCards([])
      setSynthesising(false)
    },
    onStatusChange: (status: string) => {
      setKernelStatus(status)
      setSynthesising(status === 'resolving' || status === 'domino_responding')
    },
    onAccumulate: (_source: string, count: number) => {
      setAccumulatedCount(prev => prev + count)
    },
    onDomino: (source: string, context: string) => {
      setKernelLogs(prev => [...prev.slice(-50), `💥 Domino from ${source}: ${context.slice(0, 80)}`])
    },
    onPeerLiquid: (peers: { id: string; label: string; liquid: string }[]) => {
      setLiquidCards(prev => {
        const selfCards = prev.filter(c => c.userId === 'self')
        const peerCards = peers.map(p => ({
          id: `peer-${p.id}`,
          userId: p.id,
          userName: p.label,
          content: p.liquid,
          timestamp: Date.now(),
        }))
        return [...selfCards, ...peerCards]
      })
    },
    onError: (error: string) => {
      console.error('[kernel]', error)
      setKernelLogs(prev => [...prev.slice(-50), `❌ ${error}`])
      setSynthesising(false)
    },
    onLog: (msg: string) => {
      console.log('[kernel]', msg)
      setKernelLogs(prev => [...prev.slice(-50), msg])
    },
  }), [])

  // --- Auto-orientation: fire soft-LLM at game start ---
  const fireOrientation = useCallback(async (key: string) => {
    if (!kernelRef.current) return
    setSoftLoading(true)
    try {
      const block = kernelRef.current.block
      const prompt = buildSoftPrompt(block, 'Where am I? What do I see?', 'character')
      const response = await callClaude(key, 'claude-haiku-4-5-20251001', prompt, 256)
      setSoftResponse({
        id: Date.now().toString(),
        originalInput: 'Where am I? What do I see?',
        text: response,
        softType: 'refine',
        face: 'character',
        frameId: null,
      })
    } catch (_e) {
      // Silent fail — orientation is nice-to-have, not critical
    } finally {
      setSoftLoading(false)
    }
  }, [])

  // (Legacy game-flow handlers and the pscale-mcp bridge overlay — handleCreateGame,
  // handleJoinGame, handleResumeGame, handleImportGame, overlayPscaleBlocks — removed
  // in feature/bsp-mcp-native. Activation goes through handleActivate; the SetupScreen
  // collects agent_id+secret+beach; the bsp-client wrapper talks to the commons directly.)

  // --- Edit target/address (author/designer shelf) ---
  const [editTarget, setEditTarget] = useState('spatial-thornkeep')
  const [editAddress, setEditAddress] = useState('111')

  // --- ASK (Soft — direct call, no kernel needed) ---
  const handleQuery = useCallback(async (text: string) => {
    if (!text.trim() || !kernelRef.current) return
    setSoftLoading(true)
    setSoftResponse(null)

    try {
      const block = kernelRef.current.block
      // Sync edit context before building prompt
      if (face !== 'character') {
        block.edit_target = editTarget
        block.edit_address = editAddress
      }
      const peers = kernelRef.current.lastPeerBlocks
      const prompt = buildSoftPrompt(block, text, face, peers)
      const response = await callClaude(apiKey, 'claude-haiku-4-5-20251001', prompt, 256)

      setSoftResponse({
        id: Date.now().toString(),
        originalInput: text,
        text: response,
        softType: 'refine',
        face,
        frameId: null,
      })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Soft call failed'
      setSoftResponse({
        id: Date.now().toString(),
        originalInput: text,
        text: `Error: ${msg}`,
        softType: 'info',
        face,
        frameId: null,
      })
    } finally {
      setSoftLoading(false)
    }
  }, [apiKey, face, editTarget, editAddress])

  // --- SUBMIT to Liquid ---
  const handleSubmit = useCallback((text: string) => {
    if (!text.trim() || !kernelRef.current) return
    const card: LiquidCard = {
      id: Date.now().toString(),
      userId: 'self',
      userName: characterName,
      content: text,
      timestamp: Date.now(),
    }
    setLiquidCards(prev => [...prev, card])
    // Sync edit context to kernel block
    if (face !== 'character') {
      kernelRef.current.block.edit_target = editTarget
      kernelRef.current.block.edit_address = editAddress
    }
    kernelRef.current.submitLiquid(text)
  }, [characterName, face])

  // --- COMMIT (fires kernel, which fires medium on next cycle) ---
  const handleCommit = useCallback((_cardId: string) => {
    if (!kernelRef.current) return
    setSynthesising(true)
    kernelRef.current.commit(face)

    // (Author write-through to pscale-mcp's thornkeep-observations block — removed
    // in feature/bsp-mcp-native. Author commits now go via the kernel's bsp() write
    // to the agent's own character block at agent_id; the substrate is uniform.)

    // Clear liquid cards — kernel will handle the rest
    setLiquidCards([])
  }, [face])

  // --- Copy liquid card text back to vapor input ---
  const handleCopyToVapor = useCallback((text: string) => {
    setVaporText(text)
  }, [])

  // --- Domino mode toggle (character face) ---
  const handleDominoModeToggle = useCallback(() => {
    const modes: Array<'auto' | 'informed' | 'silent'> = ['auto', 'informed', 'silent']
    const next = modes[(modes.indexOf(dominoMode) + 1) % modes.length]
    setDominoMode(next)
    if (kernelRef.current) {
      kernelRef.current.block.trigger.domino_mode = next
    }
  }, [dominoMode])

  // --- Commit mode toggle (all faces) ---
  const [commitMode, setCommitMode] = useState<'auto' | 'manual' | 'informed'>('manual')
  const handleCommitModeToggle = useCallback(() => {
    const modes: Array<'auto' | 'manual' | 'informed'> = ['manual', 'informed', 'auto']
    const next = modes[(modes.indexOf(commitMode) + 1) % modes.length]
    setCommitMode(next)
    if (kernelRef.current?.block.face_commit_mode) {
      kernelRef.current.block.face_commit_mode[face] = next
    }
  }, [commitMode, face])

  // --- Reset ---
  const handleReset = useCallback(() => {
    kernelRef.current?.stop()
    kernelRef.current = null
    setPhase('setup')
    setCharacterSolids([])
    setAuthorSolids([])
    setDesignerSolids([])
    setLiquidCards([])
    setSoftResponse(null)
    setVaporText('')
    setStatusMessage('')
    setKernelLogs([])
    setAccumulatedCount(0)
    setKernelStatus('idle')
  }, [])

  // --- Activate (beach mode, bsp-mcp native) ---
  const handleActivate = useCallback(async (ctx: ActivationContext) => {
    setApiKey(ctx.apiKey)
    setCharacterName(ctx.agentId)
    setGameCode(ctx.beach)
    setShell(ctx.shell)
    setPhase('loading')
    setStatusMessage(ctx.bootstrapped ? 'Shell bootstrapped — entering…' : 'Entering…')

    const block = createBlock(ctx.agentId, ctx.agentId, ctx.shell.description || `${ctx.agentId} — present.`, '', ctx.apiKey)

    // Apply face defaults from shell — use Character's default address if no explicit starting address
    const startingFace = ctx.shell.faces.find(f => f.canonical === 'character') ?? ctx.shell.faces[0]
    const initialAddress = ctx.address || (startingFace?.default_address ?? '')
    block.spatial_address = initialAddress
    setCurrentAddress(initialAddress)

    // Wire the agent blocks' hidden directories to this user's beach. The
    // resolver follows the URL ref to fetch the beach block from the commons,
    // and we inject it under the ref string so the prompt builder's getBlock(ref)
    // call finds it. Per docs/protocol-block-references.md.
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

    const kernel = new Kernel(block, ctx.beach, makeKernelCallbacks())
    kernelRef.current = kernel
    kernel.start()
    setDominoMode(block.trigger?.domino_mode ?? 'auto')

    setStatusMessage('')
    setPhase('ready')
    fireOrientation(ctx.apiKey)
  }, [makeKernelCallbacks, fireOrientation])

  // Switch face — applies face's default address if blank
  const handleFaceChange = useCallback((newFace: Face) => {
    setFace(newFace)
    if (shell && kernelRef.current) {
      const f = shell.faces.find(x => x.canonical === newFace)
      if (f && f.default_address) {
        kernelRef.current.block.spatial_address = f.default_address
        setCurrentAddress(f.default_address)
      }
    }
  }, [shell])

  // --- Render ---
  if (phase === 'setup') {
    return <SetupScreen onActivate={handleActivate} />
  }

  if (phase === 'loading') {
    return (
      <div className="app" data-theme={theme}>
        <div className="flex items-center justify-center h-screen">
          <p className="text-sm text-muted-foreground animate-pulse">{statusMessage || 'Loading...'}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="app" data-theme={theme} data-face={face}>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 h-[44px] border-b border-border/50 text-sm shrink-0">
        <span className="text-face-accent font-medium">{characterName}</span>
        {/* Face switcher — 4 CADO slots, shell-driven labels */}
        <div className="flex items-center gap-0.5 border border-border/50 rounded overflow-hidden shrink-0">
          {(['character', 'author', 'designer', 'observer'] as const).map(f => {
            const sf = shell?.faces.find(x => x.canonical === f)
            const long = sf?.label?.split('—')[0]?.trim() || f
            const short = (long.charAt(0).toUpperCase()) // single letter — C/A/D/O
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
        {/* Unified address bar — scope icon + beach + address */}
        <div className="flex items-center gap-1 text-xs font-mono border border-border/50 rounded px-2 py-0.5 text-foreground min-w-0">
          <span title="beach scope" className="text-muted-foreground shrink-0">🌊</span>
          <span className="text-muted-foreground truncate max-w-[10rem]" title={gameCode}>{gameCode}</span>
          <span className="text-muted-foreground shrink-0">:</span>
          <input
            type="text"
            value={currentAddress}
            placeholder="(root)"
            onChange={e => {
              const v = e.target.value
              setCurrentAddress(v)
              if (kernelRef.current) kernelRef.current.block.spatial_address = v
            }}
            className="bg-transparent border-none outline-none text-foreground font-mono"
            style={{ width: '5rem' }}
            title="Current pscale address. Edit to navigate."
          />
        </div>
        {/* Substrate-tool tray — Level-2/3 relational acts */}
        <SubstrateTray
          agentId={characterName}
          onAct={(act: SubstrateAct) => {
            setKernelLogs(prev => [...prev.slice(-50), `🛠 substrate ${act.kind}: ${JSON.stringify(act).slice(0, 200)}`])
          }}
        />
        <span className="text-xs" style={{ opacity: 0.5 }}>
          {kernelStatus === 'idle' ? '🟢' : kernelStatus === 'resolving' ? '🟡' : kernelStatus === 'domino_responding' ? '💥' : '⚪'}
        </span>
        {face === 'character' ? (
          <button
            onClick={handleDominoModeToggle}
            className="text-xs"
            style={{ opacity: 0.7, cursor: 'pointer', background: 'none', border: 'none', color: 'inherit', padding: '2px 4px' }}
            title={`Domino mode: ${dominoMode}. Click to cycle.`}
          >
            {dominoMode === 'auto' ? '🔄auto' : dominoMode === 'informed' ? '👁️watch' : '🔇silent'}
          </button>
        ) : (
          <button
            onClick={handleCommitModeToggle}
            className="text-xs"
            style={{ opacity: 0.7, cursor: 'pointer', background: 'none', border: 'none', color: 'inherit', padding: '2px 4px' }}
            title={`Commit mode: ${commitMode}. Click to cycle.`}
          >
            {commitMode === 'manual' ? '✋manual' : commitMode === 'informed' ? '👁️informed' : '⚡auto'}
          </button>
        )}
        {accumulatedCount > 0 && (
          <span className="text-xs text-face-accent" title="Accumulated peer events">
            📥 {accumulatedCount}
          </span>
        )}
        <div className="flex-1" />
        <button onClick={() => {
          const text = solidBlocks.map(b => b.content).join('\n\n---\n\n')
          const blob = new Blob([`${characterName} — ${gameCode}\n${new Date().toLocaleString()}\n\n${text}`], { type: 'text/plain' })
          const a = document.createElement('a')
          a.href = URL.createObjectURL(blob)
          a.download = `${characterName.toLowerCase()}-${gameCode}.txt`
          a.click()
        }} className="text-muted-foreground hover:text-foreground text-xs" title="Download story">📜</button>
        <button onClick={() => setShowSaveModal(true)} className="text-muted-foreground hover:text-foreground text-xs" title="Save game">💾</button>
        <button onClick={handleReset} className="text-muted-foreground hover:text-foreground text-xs" title="Leave game">🚪</button>
      </div>

      {statusMessage && (
        <div className="px-4 py-2 text-xs text-face-accent bg-accent/10">{statusMessage}</div>
      )}

      {/* Shelf: block navigator for author/designer */}
      {face !== 'character' && kernelRef.current && (
        <div className="flex items-center gap-2 px-4 py-1.5 border-b border-border/30 text-xs bg-accent/5">
          <span className="text-muted-foreground">target:</span>
          <select
            value={editTarget}
            onChange={e => {
              setEditTarget(e.target.value)
              if (kernelRef.current) kernelRef.current.block.edit_target = e.target.value
            }}
            className="bg-transparent border border-border/50 rounded px-1 py-0.5 text-face-accent cursor-pointer"
          >
            {listBlocks().map(name => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
          <span className="text-muted-foreground">@</span>
          <input
            type="text"
            value={editAddress}
            onChange={e => {
              setEditAddress(e.target.value)
              if (kernelRef.current) kernelRef.current.block.edit_address = e.target.value
            }}
            className="bg-transparent border border-border/50 rounded px-1 py-0.5 w-16 text-face-accent font-mono"
            title="BSP address"
          />
        </div>
      )}

      {/* Three zones with draggable separators */}
      <SolidZone blocks={solidBlocks} height={solidHeight} />
      <DraggableSeparator position="top" onDrag={handleTopDrag} />
      <LiquidZone
        cards={liquidCards}
        height={liquidHeight}
        currentUserId="self"
        isLoading={synthesising}
        onCommit={handleCommit}
        onCopyToVapor={handleCopyToVapor}
      />
      <DraggableSeparator position="bottom" onDrag={handleBottomDrag} />
      <VapourZone
        entries={[]}
        softResponse={softResponse}
        onDismissSoftResponse={() => setSoftResponse(null)}
      />

      {/* Floating construction button — input lives here */}
      <ConstructionButton
        onThemeChange={setTheme}
        onLogout={handleReset}
        currentTheme={theme}
        onQuery={handleQuery}
        onSubmit={handleSubmit}
        value={vaporText}
        onChange={setVaporText}
        isQuerying={softLoading}
        placeholder="What do you do?"
      />

      {/* Save modal */}
      {showSaveModal && kernelRef.current && (
        <SaveModal
          gameCode={gameCode}
          block={kernelRef.current.block}
          onClose={() => setShowSaveModal(false)}
          onFileSave={() => {
            const allBlocks: Record<string, unknown> = {}
            for (const n of listBlocks()) { const b = getBlock(n); if (b) allBlocks[n] = b }
            const json = exportGameState(gameCode, kernelRef.current!.block, allBlocks)
            const blob = new Blob([json], { type: 'application/json' })
            const a = document.createElement('a')
            a.href = URL.createObjectURL(blob)
            a.download = `xstream-${characterName.toLowerCase()}-${gameCode}.json`
            a.click()
          }}
        />
      )}
    </div>
  )
}
