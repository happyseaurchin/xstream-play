/**
 * InboxDrawer — cold-contact surface across watched beaches.
 *
 * The protocol replaces the legacy inbox primitive with "structured marks
 * on beaches the recipient watches" (per CLAUDE.md). Anyone can leave a
 * mark mentioning your agent_id on a beach you watch; the kernel scans
 * shell:2 (watched beaches) every ~20 s and surfaces the matches here.
 *
 * Click-to-navigate: tapping an item routes the active beach + address
 * to the mark's location, so the user can engage in context. Drawer is
 * lightweight — it slides down from under the header and dismisses
 * easily, mirroring the ViewerDrawer shape.
 */

import { useState, useRef, useEffect } from 'react'
import type { InboxItem } from '../kernel/beach-kernel'

export interface InboxDrawerProps {
  open: boolean
  onClose: () => void
  items: InboxItem[]
  watchedCount: number
  onNavigate: (beach: string, address: string) => void
}

export function InboxDrawer({ open, onClose, items, watchedCount, onNavigate }: InboxDrawerProps) {
  const [height, setHeight] = useState(() => {
    const saved = localStorage.getItem('xstream:inbox-height')
    return saved ? parseInt(saved, 10) : Math.round(window.innerHeight * 0.32)
  })
  const dragging = useRef(false)

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!dragging.current) return
      const next = Math.max(80, Math.min(window.innerHeight - 100, e.clientY - 44))
      setHeight(next)
    }
    function onUp() {
      if (dragging.current) {
        dragging.current = false
        localStorage.setItem('xstream:inbox-height', String(height))
      }
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [height])

  if (!open) return null

  return (
    <div
      className="absolute left-0 right-0 top-0 bg-background/95 backdrop-blur-sm border-b border-border/60 shadow-md z-30 text-foreground flex flex-col"
      style={{ height }}
    >
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/40 text-xs shrink-0">
        <span className="text-muted-foreground">📬</span>
        <span className="font-medium">inbox</span>
        <span className="text-muted-foreground">·</span>
        <span className="text-muted-foreground">{items.length} mark{items.length === 1 ? '' : 's'} for you across {watchedCount} watched beach{watchedCount === 1 ? '' : 'es'}</span>
        <button onClick={onClose} className="ml-auto text-muted-foreground hover:text-foreground" title="close inbox">✕</button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2">
        {items.length === 0 ? (
          <div className="text-sm text-muted-foreground italic">
            {watchedCount === 0
              ? 'No watched beaches yet — add URLs to shell:2 (Designer face) to receive cold contact.'
              : 'No marks mentioning you on any watched beach right now.'}
          </div>
        ) : (
          items.map(item => (
            <button
              key={`${item.beach}#${item.digit}`}
              onClick={() => onNavigate(item.beach, item.address || '')}
              className="block w-full text-left border border-border/40 rounded px-3 py-2 bg-card/50 hover:bg-accent/30 transition-colors"
              title={`open ${item.beach}${item.address ? ':' + item.address : ''}`}
            >
              <div className="text-sm whitespace-pre-wrap text-foreground">{item.text}</div>
              <div className="flex gap-3 text-[11px] text-muted-foreground mt-1 font-mono flex-wrap">
                {item.agent_id && <span>{item.agent_id}</span>}
                <span className="opacity-70">{item.beach}{item.address ? ':' + item.address : ''}</span>
                {item.timestamp && <span>{new Date(item.timestamp).toLocaleString()}</span>}
                <span className="ml-auto opacity-50">1.{item.digit}</span>
              </div>
            </button>
          ))
        )}
      </div>

      <div
        onMouseDown={() => { dragging.current = true }}
        className="h-1.5 cursor-ns-resize bg-border/30 hover:bg-border/60"
        title="drag to resize"
      />
    </div>
  )
}
