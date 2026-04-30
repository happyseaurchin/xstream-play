/**
 * ViewerDrawer — slide-down overlay showing what the active face attends to.
 *
 * Closed by default. Opens via the 👁 button in the header. Slides down over
 * the V/L/S surface; the user can drag the bottom edge to size it (resize
 * handle). Default height ~30vh.
 *
 * Content per face (v0.1):
 *   character / observer  → marks at this address (the landscape)
 *   author                → "viewer for author face — coming"
 *   designer              → "viewer for designer face — coming"
 *
 * The viewer is secondary. Its job is to let the user "look up" briefly,
 * then dismiss it and return to V/L/S. It does NOT show what the user has
 * produced — that's solid's job.
 */

import { useState, useRef, useEffect } from 'react'
import type { Face } from '../types/xstream'
import type { MarkRow } from '../kernel/beach-session'
import type { PresenceMark } from '../lib/bsp-client'

export interface ViewerDrawerProps {
  open: boolean
  onClose: () => void
  face: Face
  beach: string
  address: string
  marks: MarkRow[]
  presence: PresenceMark[]
}

export function ViewerDrawer(props: ViewerDrawerProps) {
  const [height, setHeight] = useState(() => {
    const saved = localStorage.getItem('xstream:viewer-height')
    return saved ? parseInt(saved, 10) : Math.round(window.innerHeight * 0.32)
  })
  const dragging = useRef(false)

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!dragging.current) return
      const next = Math.max(80, Math.min(window.innerHeight - 100, e.clientY - 44 /* header */))
      setHeight(next)
    }
    function onUp() {
      if (dragging.current) {
        dragging.current = false
        localStorage.setItem('xstream:viewer-height', String(height))
      }
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [height])

  if (!props.open) return null

  return (
    <div
      className="absolute left-0 right-0 top-0 bg-background/95 backdrop-blur-sm border-b border-border/60 shadow-md z-30 text-foreground flex flex-col"
      style={{ height }}
    >
      {/* Drawer header */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/40 text-xs shrink-0">
        <span className="text-muted-foreground">👁</span>
        <span className="font-medium">viewer</span>
        <span className="text-muted-foreground">·</span>
        <span className="text-muted-foreground capitalize">{props.face} face</span>
        <span className="text-muted-foreground">·</span>
        <span className="text-muted-foreground font-mono truncate">{props.beach}{props.address ? ':' + props.address : ''}</span>
        <button onClick={props.onClose} className="ml-auto text-muted-foreground hover:text-foreground" title="close viewer">✕</button>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-y-auto p-3">
        {(props.face === 'character' || props.face === 'observer') && (
          <FaceCharacterObserver face={props.face} marks={props.marks} presence={props.presence} address={props.address} />
        )}
        {props.face === 'author' && <FacePlaceholder face="author" />}
        {props.face === 'designer' && <FacePlaceholder face="designer" />}
      </div>

      {/* Resize handle */}
      <div
        onMouseDown={() => { dragging.current = true }}
        className="h-1.5 cursor-ns-resize bg-border/30 hover:bg-border/60"
        title="drag to resize"
      />
    </div>
  )
}

function FaceCharacterObserver({ face, marks, presence, address }: { face: Face; marks: MarkRow[]; presence: PresenceMark[]; address: string }) {
  const presenceIds = new Set(presence.map(p => p.agent_id))
  const nonPresence = marks.filter(m => !m.is_presence || !presenceIds.has(m.agent_id ?? ''))
  nonPresence.sort((a, b) => {
    if (a.timestamp && b.timestamp) return b.timestamp.localeCompare(a.timestamp)
    return parseInt(a.digit) - parseInt(b.digit)
  })
  return (
    <div className="space-y-3">
      {presence.length > 0 && (
        <div>
          <div className="text-[11px] text-muted-foreground uppercase tracking-wider mb-1">Present at this address</div>
          <div className="flex flex-wrap gap-2">
            {presence.map(p => (
              <span key={p.agent_id} className="px-2 py-0.5 rounded-full bg-accent text-foreground text-xs font-mono" title={`@${p.address || '/'}`}>🟢 {p.agent_id}</span>
            ))}
          </div>
        </div>
      )}
      <div>
        <div className="text-[11px] text-muted-foreground uppercase tracking-wider mb-1">Marks {address ? `at ${address}` : 'at root'}</div>
        {nonPresence.length === 0 ? (
          <div className="text-sm text-muted-foreground italic">{face === 'observer' ? 'Nothing here yet — the address is quiet.' : 'No marks here yet.'}</div>
        ) : (
          <ul className="space-y-2">
            {nonPresence.map(m => (
              <li key={m.digit} className="border border-border/40 rounded px-3 py-2 bg-card/50">
                <div className="text-sm whitespace-pre-wrap">{m.text}</div>
                <div className="flex gap-3 text-[11px] text-muted-foreground mt-1 font-mono">
                  {m.agent_id && <span>{m.agent_id}</span>}
                  {m.address && <span>@{m.address || '/'}</span>}
                  {m.timestamp && <span>{new Date(m.timestamp).toLocaleString()}</span>}
                  <span className="ml-auto opacity-50">1.{m.digit}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function FacePlaceholder({ face }: { face: 'author' | 'designer' }) {
  return (
    <div className="text-sm text-muted-foreground italic">
      Viewer for <strong>{face}</strong> face — coming. Will show {face === 'author' ? 'authored content (spatial blocks, documents being co-authored, prior versions)' : 'design blocks (rules, conventions, agent shells, skill packs in scope)'}.
    </div>
  )
}
