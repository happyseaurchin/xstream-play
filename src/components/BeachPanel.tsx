/**
 * BeachPanel — single-panel V/L/S surface for the xstream beach client.
 *
 * Mode indicator at the top: 🏖 beachcombing (no frame) or 🎬 in-frame.
 *
 * Beachcombing layout:
 *   - presence row (live agents at this address)
 *   - SOLID stream = marks at the current address
 *   - VAPOR input + drop-mark button
 *
 * Frame layout (when current_frame is set in the session):
 *   - synthesis at the top (canonical render)
 *   - per-entity rows (liquid + solid)
 *   - VAPOR input + commit-liquid button (writes to user's entity.1)
 *
 * No game state. No spatial walks. No dominos. Pure beach + frame.
 */

import { useState, useEffect } from 'react'
import type { BeachSession, MarkRow, FrameView } from '../kernel/beach-session'
import type { PresenceMark } from '../lib/bsp-client'

export interface BeachPanelProps {
  session: BeachSession
  presence: PresenceMark[]
  marks: MarkRow[]
  frame: FrameView | null
  vapor: string
  onVaporChange: (v: string) => void
  onDropMark: (text: string) => Promise<void>
  onCommitLiquid: (text: string) => Promise<void>
}

export function BeachPanel(props: BeachPanelProps) {
  const inFrame = !!props.session.current_frame
  const [busy, setBusy] = useState(false)

  async function handlePrimary() {
    if (!props.vapor.trim() || busy) return
    setBusy(true)
    try {
      if (inFrame) {
        await props.onCommitLiquid(props.vapor)
      } else {
        await props.onDropMark(props.vapor)
      }
      props.onVaporChange('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col h-full text-foreground">
      {/* Mode indicator */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border/50 text-xs text-muted-foreground shrink-0">
        {inFrame ? (
          <>
            <span>🎬</span>
            <span className="font-mono">{props.session.current_frame}</span>
            {props.session.entity_position && <span>· you are entity <strong>{props.session.entity_position}</strong></span>}
          </>
        ) : (
          <>
            <span>🏖</span>
            <span>beachcombing — drop marks freely; pick a frame to enter V/L/S</span>
          </>
        )}
        <span className="ml-auto" title="agents present at this address">
          {props.presence.length === 0 ? 'no peers' : `${props.presence.length} present`}
        </span>
      </div>

      {/* Body — scroll independently */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-4">
        {inFrame && props.frame ? <FrameBody frame={props.frame} userPos={props.session.entity_position} /> : null}
        {!inFrame ? <MarksBody marks={props.marks} presence={props.presence} /> : null}
      </div>

      {/* Vapor input + primary action */}
      <div className="border-t border-border/50 p-3 shrink-0">
        <div className="flex gap-2 items-end">
          <textarea
            value={props.vapor}
            onChange={e => props.onVaporChange(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                handlePrimary()
              }
            }}
            placeholder={inFrame ? 'compose your liquid…' : 'drop a mark — what\'s here?'}
            rows={3}
            className="flex-1 bg-background border border-border/50 rounded px-3 py-2 text-sm text-foreground resize-none outline-none focus:border-primary/50"
          />
          <button
            onClick={handlePrimary}
            disabled={!props.vapor.trim() || busy}
            className="px-4 py-2 rounded bg-primary text-primary-foreground text-sm font-medium disabled:opacity-40 shrink-0"
            title={inFrame ? 'commit liquid (⌘↵)' : 'drop mark (⌘↵)'}
          >
            {busy ? '…' : (inFrame ? 'commit' : 'mark')}
          </button>
        </div>
      </div>
    </div>
  )
}

function MarksBody({ marks, presence }: { marks: MarkRow[]; presence: PresenceMark[] }) {
  const presenceIds = new Set(presence.map(p => p.agent_id))
  const filtered = marks.filter(m => !m.is_presence || !presenceIds.has(m.agent_id ?? ''))
  // Sort: most recent timestamps first, then by digit
  filtered.sort((a, b) => {
    if (a.timestamp && b.timestamp) return b.timestamp.localeCompare(a.timestamp)
    if (a.timestamp) return -1
    if (b.timestamp) return 1
    return parseInt(a.digit) - parseInt(b.digit)
  })
  return (
    <div className="space-y-3">
      {presence.length > 0 && <PresenceStrip presence={presence} />}
      <div className="text-xs text-muted-foreground uppercase tracking-wider">Marks at this address</div>
      {filtered.length === 0 ? (
        <div className="text-sm text-muted-foreground italic">No marks here yet. Drop one — leave a trace.</div>
      ) : (
        <ul className="space-y-2">
          {filtered.map(m => (
            <li key={m.digit} className="border border-border/50 rounded px-3 py-2 bg-background/50">
              <div className="text-sm text-foreground whitespace-pre-wrap">{m.text}</div>
              <div className="flex gap-3 text-xs text-muted-foreground mt-1 font-mono">
                {m.agent_id && <span title="agent">{m.agent_id}</span>}
                {m.address && <span title="address">@{m.address || '/'}</span>}
                {m.timestamp && <span title="when">{new Date(m.timestamp).toLocaleString()}</span>}
                <span className="ml-auto opacity-50">1.{m.digit}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function PresenceStrip({ presence }: { presence: PresenceMark[] }) {
  return (
    <div className="flex flex-wrap gap-2 text-xs">
      {presence.map(p => (
        <span key={p.agent_id} className="px-2 py-1 rounded-full bg-accent text-foreground font-mono" title={`@${p.address || '/'} · ${p.timestamp}`}>
          🟢 {p.agent_id}
        </span>
      ))}
    </div>
  )
}

function FrameBody({ frame, userPos }: { frame: FrameView; userPos: string | null }) {
  return (
    <div className="space-y-4">
      {frame.scene_underscore && (
        <div className="border border-border/50 rounded px-3 py-2 bg-muted/20">
          <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Scene</div>
          <div className="text-sm text-foreground italic">{frame.scene_underscore}</div>
        </div>
      )}
      {frame.synthesis && (
        <div className="border border-primary/30 rounded px-3 py-2 bg-primary/5">
          <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Synthesis</div>
          <div className="text-sm text-foreground">{frame.synthesis}</div>
          {frame.synthesis_envelope && (
            <div className="text-xs text-muted-foreground mt-1 font-mono">{frame.synthesis_envelope}</div>
          )}
        </div>
      )}
      <div className="text-xs text-muted-foreground uppercase tracking-wider">Entities</div>
      <ul className="space-y-3">
        {frame.entities.map(e => (
          <li
            key={e.position}
            className={`border rounded px-3 py-2 ${e.position === userPos ? 'border-primary/50 bg-primary/5' : 'border-border/50 bg-background/40'}`}
          >
            <div className="flex items-baseline gap-2 mb-1">
              <span className="font-mono text-xs text-muted-foreground">{e.position}</span>
              {e.position === userPos && <span className="text-xs text-primary">you</span>}
              {e.underscore && <span className="text-sm text-foreground">{e.underscore}</span>}
            </div>
            {e.liquid && (
              <div className="text-sm text-foreground italic mt-1">
                <span className="text-xs text-muted-foreground mr-2">liquid:</span>{e.liquid}
              </div>
            )}
            {e.solid && (
              <div className="text-sm text-foreground mt-1">
                <span className="text-xs text-muted-foreground mr-2">solid:</span>{e.solid}
              </div>
            )}
            {!e.liquid && !e.solid && (
              <div className="text-xs text-muted-foreground italic">silent</div>
            )}
          </li>
        ))}
        {frame.entities.length === 0 && (
          <li className="text-sm text-muted-foreground italic">No entities yet — write to a position to populate.</li>
        )}
      </ul>
    </div>
  )
}

// Suppress unused-import warning in case useEffect is later wired in tests.
void useEffect;
