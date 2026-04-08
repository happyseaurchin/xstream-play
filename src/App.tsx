/**
 * App.block-agents.tsx — xstream UI powered by sovereign browser kernel.
 *
 * Three zones with draggable separators, themes, floating input button.
 * Engine: Kernel (polls relay, fires medium-LLM on commit/domino).
 * Soft-LLM (ASK) remains a direct call — no coordination needed.
 * Pure browser — no server runs LLM calls. All API costs are the player's.
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import SetupScreen from './components/SetupScreen'
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
import { listBlocks, getBlock, hydrateFromSaved } from './kernel/block-store'
import { bsp, type SpindleResult } from './kernel/bsp'
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

  // --- Create Game ---
  const handleCreateGame = useCallback((key: string, name: string, state: string, scene: string) => {
    setApiKey(key)
    setCharacterName(name)
    setPhase('loading')
    setStatusMessage('Creating game...')

    const code = generateGameCode()
    setGameCode(code)

    const charId = generateCharId()
    const block = createBlock(charId, name, state || `${name}. A newcomer.`, scene, key)

    // Seed presence: walk spatial block to get location, plant a starting event
    const spatialBlock = getBlock('spatial-thornkeep')
    if (spatialBlock) {
      const result = bsp(spatialBlock, block.spatial_address)
      if (result.mode === 'spindle') {
        const nodes = (result as SpindleResult).nodes
        // Use the building name (second-to-last) for the presence statement
        const building = nodes.length >= 2 ? nodes[nodes.length - 2].text.split('—')[0].trim() : 'the room'
        const room = nodes.length >= 1 ? nodes[nodes.length - 1].text.split('—')[0].trim() : ''
        const where = room ? `the ${room.toLowerCase()} of ${building}` : building
        const presence = `You are in ${where}.`
        block.event_log.push({ S: block.spatial_address, T: 0, I: block.character.id, text: presence, type: 'state_change' })
        block.accumulated.push({ source: 'world', events: [presence] })
      }
    }

    const kernel = new Kernel(block, code, makeKernelCallbacks())
    kernelRef.current = kernel
    kernel.start()

    setStatusMessage('')
    setPhase('ready')
  }, [makeKernelCallbacks])

  // --- Join Game ---
  const handleJoinGame = useCallback(async (key: string, name: string, state: string, code: string) => {
    setApiKey(key)
    setCharacterName(name)
    setGameCode(code)
    setPhase('loading')
    setStatusMessage('Joining game...')

    try {
      // Fetch existing game to get the scene
      const res = await fetch(`/api/relay/${code}?exclude=_nobody_`)
      let scene = ''
      if (res.ok) {
        const blocks = await res.json()
        if (blocks.length > 0) {
          scene = blocks[0].scene || ''
        }
      }

      const charId = generateCharId()
      const desc = state || 'A figure.'
      const block = createBlock(charId, name, desc, scene, key)

      // Seed arrival: joiner enters the scene
      block.pending_liquid = `${desc} enters.`

      const kernel = new Kernel(block, code, makeKernelCallbacks())
      kernelRef.current = kernel
      kernel.start()

      setStatusMessage('')
      setPhase('ready')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to join'
      setStatusMessage(`Error: ${msg}`)
      setPhase('setup')
    }
  }, [makeKernelCallbacks])

  // --- Resume Game ---
  const handleResumeGame = useCallback((key: string, save: SavedGame) => {
    setApiKey(key)
    setPhase('loading')
    setStatusMessage('Resuming game...')

    const block = loadKernelBlock(save.gameId, save.charId)
    if (!block) {
      setStatusMessage('Error: save not found')
      setPhase('setup')
      return
    }

    // Hydrate block store with individually-saved blocks
    const savedBlocks = loadAllBlocks(save.gameId)
    if (Object.keys(savedBlocks).length > 0) hydrateFromSaved(savedBlocks)

    // Update API key in block (may have changed)
    block.medium.api_key = key
    setCharacterName(block.character.name)
    setGameCode(save.gameId)

    const kernel = new Kernel(block, save.gameId, makeKernelCallbacks())
    kernelRef.current = kernel
    kernel.start()

    setStatusMessage('')
    setPhase('ready')
  }, [makeKernelCallbacks])

  // --- Import Game ---
  const handleImportGame = useCallback((key: string, json: string) => {
    setPhase('loading')
    setStatusMessage('Importing save...')

    try {
      const { gameId, block, blocks } = importGameState(json)
      setCurrentGame(gameId)
      hydrateFromSaved(blocks)
      // Write each block individually to localStorage
      for (const [name, b] of Object.entries(blocks)) {
        saveBlock(name, b)
      }
      block.medium.api_key = key
      setApiKey(key)
      setCharacterName(block.character.name)
      setGameCode(gameId)

      const kernel = new Kernel(block, gameId, makeKernelCallbacks())
      kernelRef.current = kernel
      kernel.start()

      setStatusMessage('')
      setPhase('ready')
    } catch (err) {
      setStatusMessage(`Error: ${err instanceof Error ? err.message : 'Import failed'}`)
      setPhase('setup')
    }
  }, [makeKernelCallbacks])

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

  // --- Render ---
  if (phase === 'setup') {
    return <SetupScreen onCreateGame={handleCreateGame} onJoinGame={handleJoinGame} onResumeGame={handleResumeGame} onImportGame={handleImportGame} />
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
        <select
          value={face}
          onChange={e => setFace(e.target.value as Face)}
          className="text-xs bg-transparent border border-border/50 rounded px-1 py-0.5 text-face-accent cursor-pointer"
          title="Switch face"
        >
          <option value="character">character</option>
          <option value="author">author</option>
          <option value="designer">designer</option>
        </select>
        <span className="text-muted-foreground text-xs font-mono"
              style={{ cursor: 'pointer' }}
              title="Click to copy game code"
              onClick={() => navigator.clipboard.writeText(gameCode)}>
          {gameCode}
        </span>
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
