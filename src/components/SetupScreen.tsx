/**
 * SetupScreen.tsx — API key + Create/Join/Resume game flow.
 *
 * Three entry modes:
 * - Create: pick a name, write a scene, generate a game code
 * - Join: enter a code, pick a name, join an existing game
 * - Resume: reload a saved game from localStorage
 *
 * Plus: Import save file, Clear all saves.
 * Key stored in localStorage. Never leaves the browser.
 */

import { useState, useRef } from 'react'
import { DEFAULT_SCENE } from '../kernel/block-factory'
import { listSavedGames, clearAllSaves, importGameState } from '../kernel/persistence'
import type { SavedGame } from '../kernel/persistence'
import {
  isPscaleMcpEnabled, setPscaleMcpEnabled,
  getPscaleAgentId, setPscaleAgentId,
  setPscaleSecret,
  passportExists,
} from '../lib/pscale-mcp'

type Mode = 'menu' | 'create' | 'join'

interface SetupScreenProps {
  onCreateGame: (apiKey: string, charName: string, charState: string, scene: string) => void
  onJoinGame: (apiKey: string, charName: string, charState: string, gameCode: string) => void
  onResumeGame: (apiKey: string, save: SavedGame) => void
  onImportGame: (apiKey: string, json: string) => void
}

export default function SetupScreen({ onCreateGame, onJoinGame, onResumeGame, onImportGame }: SetupScreenProps) {
  const [apiKey, setApiKey] = useState(
    () => localStorage.getItem('xstream-api-key') ?? ''
  )
  const [name, setName] = useState(
    () => localStorage.getItem('xstream-character-name') ?? ''
  )
  const [charState, setCharState] = useState('')
  const [scene, setScene] = useState(DEFAULT_SCENE)
  const [gameCode, setGameCode] = useState('')
  const [mode, setMode] = useState<Mode>('menu')
  const [error, setError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  // pscale-mcp bridge state
  const [pscaleEnabled, setPscaleEnabled] = useState<boolean>(() => isPscaleMcpEnabled())
  const [pscaleAgentId, setPscaleAgentIdState] = useState<string>(() => getPscaleAgentId() ?? '')
  const [pscaleSecret, setPscaleSecretState] = useState<string>('')
  const [pscaleValidating, setPscaleValidating] = useState<boolean>(false)

  const savedGames = listSavedGames()

  /**
   * Validate pscale-mcp credentials. We confirm the passport exists; the
   * secret is held in sessionStorage and validated implicitly when the
   * player tries to write through the bridge (the lock check rejects).
   */
  async function validatePscale(): Promise<boolean> {
    if (!pscaleEnabled) return true
    if (!pscaleAgentId.trim()) {
      setError('pscale-mcp agent_id is required when bridge is on.')
      return false
    }
    if (!pscaleSecret.trim()) {
      setError('pscale-mcp secret is required when bridge is on.')
      return false
    }
    setPscaleValidating(true)
    try {
      const exists = await passportExists(pscaleAgentId.trim())
      if (!exists) {
        setError(`No passport found for "${pscaleAgentId.trim()}". Publish one via the pscale-mcp tools first.`)
        return false
      }
      setPscaleAgentId(pscaleAgentId.trim())
      setPscaleSecret(pscaleSecret.trim())
      return true
    } finally {
      setPscaleValidating(false)
    }
  }

  function handlePscaleToggle(on: boolean) {
    setPscaleEnabled(on)
    setPscaleMcpEnabled(on)
    if (!on) {
      setPscaleAgentIdState('')
      setPscaleSecretState('')
    }
  }

  function validateKey(): boolean {
    const key = apiKey.trim()
    if (!key) { setError('API key is required.'); return false }
    if (!key.startsWith('sk-ant-')) { setError("That doesn't look like an Anthropic API key."); return false }
    localStorage.setItem('xstream-api-key', key)
    setError('')
    return true
  }

  function validate(): boolean {
    if (!validateKey()) return false
    const charName = name.trim()
    if (!charName) { setError('Give your character a name.'); return false }
    localStorage.setItem('xstream-character-name', charName)
    return true
  }

  async function handleCreate() {
    if (!validate()) return
    if (!(await validatePscale())) return
    onCreateGame(apiKey.trim(), name.trim(), charState.trim(), scene.trim())
  }

  async function handleJoin() {
    if (!validate()) return
    if (!(await validatePscale())) return
    const code = gameCode.trim().toUpperCase()
    if (!code || code.length < 4) { setError('Enter a valid game code.'); return }
    onJoinGame(apiKey.trim(), name.trim(), charState.trim(), code)
  }

  async function handleResume(save: SavedGame) {
    if (!validateKey()) return
    if (!(await validatePscale())) return
    onResumeGame(apiKey.trim(), save)
  }

  function handleClearAll() {
    clearAllSaves()
    setError('')
    // Force re-render by clearing error
    setError('Saves cleared.')
    setTimeout(() => setError(''), 2000)
  }

  function handleImportClick() {
    fileInputRef.current?.click()
  }

  function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!validateKey()) return

    const reader = new FileReader()
    reader.onload = () => {
      try {
        // Validate the JSON before passing up
        importGameState(reader.result as string)
        onImportGame(apiKey.trim(), reader.result as string)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Invalid save file')
      }
    }
    reader.readAsText(file)
    // Reset input so same file can be re-imported
    e.target.value = ''
  }

  // Menu — choose create, join, or resume
  if (mode === 'menu') {
    return (
      <div style={containerStyle}>
        <h1 style={{ fontSize: '1.5rem', marginBottom: '0.25rem', color: '#fff' }}>
          xstream{pscaleEnabled ? <span style={{ fontSize: '0.65rem', color: '#7af', marginLeft: '0.5rem' }}>· pscale-mcp</span> : null}
        </h1>
        <p style={{ fontSize: '0.85rem', color: '#888', marginBottom: '2rem' }}>
          narrative coordination
        </p>

        <div style={{ width: '100%', maxWidth: 360, display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <input
            type="password"
            placeholder="Anthropic API key (sk-ant-...)"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            style={inputStyle}
          />

          <input
            type="text"
            placeholder="Character name"
            value={name}
            onChange={e => setName(e.target.value)}
            style={inputStyle}
          />

          {error && <p style={{ color: error === 'Saves cleared.' ? '#8b8' : '#e55', fontSize: '0.8rem', margin: 0 }}>{error}</p>}

          <button onClick={() => { if (validate()) setMode('create') }} style={buttonStyle}>
            Create Game
          </button>
          <button onClick={() => { if (validate()) setMode('join') }} style={{ ...buttonStyle, background: '#444' }}>
            Join Game
          </button>

          {/* Saved games */}
          {savedGames.length > 0 && (
            <div style={{ borderTop: '1px solid #333', paddingTop: '1rem', marginTop: '0.5rem' }}>
              <p style={{ fontSize: '0.75rem', color: '#888', marginBottom: '0.5rem' }}>Saved Games</p>
              {savedGames.map(save => (
                <button
                  key={`${save.gameId}-${save.charId}`}
                  onClick={() => handleResume(save)}
                  style={{ ...buttonStyle, background: '#2a4a2a', marginBottom: '0.5rem', width: '100%', textAlign: 'left', fontSize: '0.8rem' }}
                >
                  {save.charName} in {save.gameId}
                  <span style={{ float: 'right', color: '#888', fontSize: '0.7rem' }}>
                    {new Date(save.savedAt).toLocaleDateString()}
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* Import + Clear */}
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button onClick={handleImportClick} style={{ ...smallButtonStyle, flex: 1 }}>
              Import Save
            </button>
            {savedGames.length > 0 && (
              <button onClick={handleClearAll} style={{ ...smallButtonStyle, flex: 1, color: '#e55' }}>
                Clear Saves
              </button>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={handleImportFile}
            style={{ display: 'none' }}
          />

          {/* pscale-mcp bridge */}
          <div style={{ borderTop: '1px solid #333', paddingTop: '1rem', marginTop: '0.5rem' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem', color: '#aaa', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={pscaleEnabled}
                onChange={e => handlePscaleToggle(e.target.checked)}
              />
              <span>pscale-mcp bridge</span>
              <span style={{ fontSize: '0.65rem', color: '#666' }}>(persistent canon + multi-author)</span>
            </label>

            {pscaleEnabled && (
              <div style={{ marginTop: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <input
                  type="text"
                  placeholder="agent_id (e.g. happyseaurchin)"
                  value={pscaleAgentId}
                  onChange={e => setPscaleAgentIdState(e.target.value)}
                  style={{ ...inputStyle, fontSize: '0.85rem' }}
                />
                <input
                  type="password"
                  placeholder="passport secret"
                  value={pscaleSecret}
                  onChange={e => setPscaleSecretState(e.target.value)}
                  style={{ ...inputStyle, fontSize: '0.85rem' }}
                />
                {pscaleValidating && <p style={{ fontSize: '0.7rem', color: '#888', margin: 0 }}>validating...</p>}
                <p style={{ fontSize: '0.65rem', color: '#666', margin: 0 }}>
                  Bridges this session to pscale-mcp: world block reads from the substrate; author commits write through to the substrate. Secret is held in sessionStorage only (cleared on tab close).
                </p>
              </div>
            )}
          </div>

          <p style={{ fontSize: '0.7rem', color: '#666', textAlign: 'center' }}>
            Your API key stays in your browser. It is never sent to our server.
          </p>
        </div>
      </div>
    )
  }

  // Create — scene + character description
  if (mode === 'create') {
    return (
      <div style={containerStyle}>
        <button onClick={() => setMode('menu')} style={backStyle}>← Back</button>
        <h2 style={{ fontSize: '1.2rem', color: '#aaa', marginBottom: '1.5rem' }}>Create Game</h2>

        <div style={{ width: '100%', maxWidth: 420, display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <label style={labelStyle}>Character Description</label>
          <textarea
            placeholder="A weary traveller with a scarred hand..."
            value={charState}
            onChange={e => setCharState(e.target.value)}
            rows={3}
            style={{ ...inputStyle, resize: 'vertical' }}
          />

          <label style={labelStyle}>Scene</label>
          <textarea
            value={scene}
            onChange={e => setScene(e.target.value)}
            rows={5}
            style={{ ...inputStyle, resize: 'vertical', fontSize: '0.8rem' }}
          />

          {error && <p style={{ color: '#e55', fontSize: '0.8rem', margin: 0 }}>{error}</p>}

          <button onClick={handleCreate} style={buttonStyle}>
            Create & Enter
          </button>
        </div>
      </div>
    )
  }

  // Join — enter game code
  return (
    <div style={containerStyle}>
      <button onClick={() => setMode('menu')} style={backStyle}>← Back</button>
      <h2 style={{ fontSize: '1.2rem', color: '#aaa', marginBottom: '1.5rem' }}>Join Game</h2>

      <div style={{ width: '100%', maxWidth: 360, display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <label style={labelStyle}>Game Code</label>
        <input
          type="text"
          placeholder="ABC123"
          value={gameCode}
          onChange={e => setGameCode(e.target.value.toUpperCase())}
          onKeyDown={e => e.key === 'Enter' && handleJoin()}
          style={{ ...inputStyle, fontSize: '1.5rem', textAlign: 'center', letterSpacing: '0.2em', fontFamily: 'monospace' }}
          maxLength={6}
        />

        <label style={labelStyle}>Character Description</label>
        <textarea
          placeholder="A weary traveller with a scarred hand..."
          value={charState}
          onChange={e => setCharState(e.target.value)}
          rows={2}
          style={{ ...inputStyle, resize: 'vertical' }}
        />

        {error && <p style={{ color: '#e55', fontSize: '0.8rem', margin: 0 }}>{error}</p>}

        <button onClick={handleJoin} style={buttonStyle}>
          Join & Enter
        </button>
      </div>
    </div>
  )
}

const containerStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', alignItems: 'center',
  justifyContent: 'center', minHeight: '100vh',
  fontFamily: 'system-ui, sans-serif', background: '#1a1a1a',
  color: '#e0e0e0', padding: '2rem',
}

const inputStyle: React.CSSProperties = {
  padding: '0.75rem', borderRadius: 6, border: '1px solid #333',
  background: '#252525', color: '#e0e0e0', fontSize: '0.9rem', outline: 'none',
}

const buttonStyle: React.CSSProperties = {
  padding: '0.75rem', borderRadius: 6, border: 'none',
  background: '#7c3aed', color: '#fff', fontSize: '0.9rem',
  cursor: 'pointer', fontWeight: 600,
}

const smallButtonStyle: React.CSSProperties = {
  padding: '0.5rem', borderRadius: 6, border: '1px solid #333',
  background: 'transparent', color: '#888', fontSize: '0.75rem',
  cursor: 'pointer',
}

const backStyle: React.CSSProperties = {
  background: 'none', border: 'none', color: '#888', cursor: 'pointer',
  fontSize: '0.85rem', marginBottom: '0.5rem', alignSelf: 'flex-start',
}

const labelStyle: React.CSSProperties = {
  fontSize: '0.8rem', color: '#888', marginBottom: '-0.5rem',
}
