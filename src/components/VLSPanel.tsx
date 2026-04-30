/**
 * VLSPanel — the always-visible vapour / liquid / solid surface.
 *
 * Three vertical zones, always rendered. Empty-state hints make the layout
 * legible from the first paint, even for an anonymous user with no API key.
 *
 * VAPOUR (top)   — your private thinking. Soft-LLM impression in response to a
 *                  query (Tier 2 — needs API key). Never persisted.
 * LIQUID (middle)— your pending commitment + face-relevant peers' liquid. Writes
 *                  to substrate on commit.
 * SOLID (bottom) — your committed contributions and the canon you belong to.
 *
 * Anonymous user: vapour is a typing surface; liquid + solid show empty-state
 * hints. Identifying (handle + passphrase) unlocks commit. Adding API key
 * unlocks soft-LLM in vapour.
 */

import { useState } from 'react'
import type { BeachSession, MarkRow, FrameView } from '../kernel/beach-session'
import type { PresenceMark } from '../lib/bsp-client'

export interface VLSPanelProps {
  session: BeachSession | null
  presence: PresenceMark[]
  marks: MarkRow[]            // for face-filtered peer liquid + solid (when in beachcombing)
  frame: FrameView | null     // when in-frame, replaces marks-based content
  vapor: string
  onVaporChange: (v: string) => void
  onCommit: (text: string) => Promise<void>
  onSoftQuery?: (text: string) => Promise<void>
  softResponse?: string | null
  softPending?: boolean
}

export function VLSPanel(props: VLSPanelProps) {
  const [busy, setBusy] = useState(false)
  const inFrame = !!(props.session?.current_frame)
  const hasIdentity = !!(props.session?.agent_id && props.session?.secret)
  const hasApiKey = !!(props.session?.api_key)

  async function handleCommit() {
    if (!props.vapor.trim() || busy) return
    if (!hasIdentity) return
    setBusy(true)
    try {
      await props.onCommit(props.vapor)
      props.onVaporChange('')
    } finally {
      setBusy(false)
    }
  }

  async function handleSoftQuery() {
    if (!props.vapor.trim() || !props.onSoftQuery || !hasApiKey) return
    await props.onSoftQuery(props.vapor)
  }

  // Liquid stream: in-frame = entity rows; beachcombing = nothing yet (peer liquid not surfaced through marks)
  const myLiquid = inFrame && props.frame && props.session?.entity_position
    ? (props.frame.entities.find(e => e.position === props.session?.entity_position)?.liquid ?? '')
    : (props.session?.liquid_pending ?? '')

  const peerLiquid = inFrame && props.frame && props.session?.entity_position
    ? props.frame.entities.filter(e => e.position !== props.session?.entity_position && e.liquid)
    : []

  // Solid stream: in-frame = synthesis + my entity solid; beachcombing = my own marks (filtered by handle) + last committed
  const ownMarks = props.session?.agent_id
    ? props.marks.filter(m => !m.is_presence && m.agent_id === props.session?.agent_id)
    : []
  const mySolid = inFrame && props.frame && props.session?.entity_position
    ? (props.frame.entities.find(e => e.position === props.session?.entity_position)?.solid ?? '')
    : ''

  return (
    <div className="flex flex-col h-full text-foreground bg-background">
      {/* VAPOUR */}
      <div className="flex-1 min-h-[120px] border-b border-border/30 flex flex-col">
        <ZoneHeader label="vapour" hint={hasApiKey ? 'private thinking · soft impressions' : 'private thinking · type to draft'} />
        <div className="flex-1 min-h-0 flex flex-col p-3 gap-2 overflow-y-auto">
          <textarea
            value={props.vapor}
            onChange={e => props.onVaporChange(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.shiftKey) {
                e.preventDefault(); handleCommit()
              }
              if (e.key === 'Enter' && e.shiftKey) {
                e.preventDefault(); handleSoftQuery()
              }
            }}
            placeholder={hasApiKey ? 'type to think; ⇧↵ ask soft; ⌘↵ commit' : (hasIdentity ? 'type to think; ⌘↵ commit' : 'type to think (identify to commit)')}
            rows={2}
            className="w-full bg-card/30 border border-border/40 rounded px-3 py-2 text-sm text-foreground resize-none outline-none focus:border-primary/50 font-sans"
          />
          {props.softPending && <div className="text-xs text-muted-foreground italic">soft is thinking…</div>}
          {props.softResponse && (
            <div className="text-sm text-foreground bg-card/40 border border-border/30 rounded px-3 py-2 whitespace-pre-wrap">
              <span className="text-[11px] text-muted-foreground uppercase tracking-wider mr-2">soft</span>
              {props.softResponse}
            </div>
          )}
          {!props.softPending && !props.softResponse && !hasApiKey && (
            <div className="text-[11px] text-muted-foreground italic">add an API key in identity (👤) to query the soft-LLM with ⇧↵</div>
          )}
        </div>
      </div>

      {/* LIQUID */}
      <div className="flex-1 min-h-[100px] border-b border-border/30 flex flex-col">
        <ZoneHeader
          label="liquid"
          hint={inFrame ? `frame · entity ${props.session?.entity_position}` : 'pending commitment'}
          right={(
            <button
              onClick={handleCommit}
              disabled={!props.vapor.trim() || busy || !hasIdentity}
              className="text-xs px-3 py-0.5 rounded bg-primary text-primary-foreground font-medium disabled:opacity-30 disabled:cursor-not-allowed"
              title={!hasIdentity ? 'identify (👤) to commit' : (inFrame ? 'commit liquid to frame' : 'drop a mark at this address')}
            >
              {busy ? '…' : (inFrame ? 'commit' : 'mark')}
            </button>
          )}
        />
        <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2">
          {myLiquid ? (
            <div className="text-sm text-foreground bg-primary/5 border border-primary/30 rounded px-3 py-2 italic">
              <span className="text-[11px] text-muted-foreground uppercase tracking-wider mr-2">you</span>{myLiquid}
            </div>
          ) : (
            <div className="text-xs text-muted-foreground italic">{hasIdentity ? 'your pending commitment will appear here' : 'identify (👤) to commit; your pending appears here'}</div>
          )}
          {peerLiquid.length > 0 && (
            <div className="space-y-1.5">
              {peerLiquid.map(e => (
                <div key={e.position} className="text-sm bg-card/40 border border-border/30 rounded px-3 py-1.5 italic">
                  <span className="text-[11px] text-muted-foreground uppercase tracking-wider mr-2">entity {e.position}</span>{e.liquid}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* SOLID */}
      <div className="flex-1 min-h-[100px] flex flex-col">
        <ZoneHeader
          label="solid"
          hint={inFrame ? 'your last committed · synthesis canon' : 'your contributions · canon you belong to'}
        />
        <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2">
          {inFrame ? (
            <>
              {props.frame?.synthesis && (
                <div className="text-sm bg-primary/5 border border-primary/30 rounded px-3 py-2">
                  <span className="text-[11px] text-muted-foreground uppercase tracking-wider mr-2">synthesis</span>{props.frame.synthesis}
                  {props.frame.synthesis_envelope && (
                    <div className="text-[11px] text-muted-foreground mt-1 font-mono">{props.frame.synthesis_envelope}</div>
                  )}
                </div>
              )}
              {mySolid && (
                <div className="text-sm bg-card/40 border border-border/30 rounded px-3 py-2">
                  <span className="text-[11px] text-muted-foreground uppercase tracking-wider mr-2">you · last committed</span>{mySolid}
                </div>
              )}
              {!props.frame?.synthesis && !mySolid && (
                <div className="text-xs text-muted-foreground italic">no synthesis yet · commit your liquid to start the round</div>
              )}
            </>
          ) : (
            <>
              {ownMarks.length === 0 ? (
                <div className="text-xs text-muted-foreground italic">{hasIdentity ? 'your committed contributions appear here' : 'identify (👤) to leave a trace'}</div>
              ) : (
                ownMarks.map(m => (
                  <div key={m.digit} className="text-sm bg-card/40 border border-border/30 rounded px-3 py-2">
                    <div className="whitespace-pre-wrap">{m.text}</div>
                    <div className="flex gap-3 text-[11px] text-muted-foreground mt-1 font-mono">
                      {m.address && <span>@{m.address || '/'}</span>}
                      {m.timestamp && <span>{new Date(m.timestamp).toLocaleString()}</span>}
                      <span className="ml-auto opacity-50">1.{m.digit}</span>
                    </div>
                  </div>
                ))
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function ZoneHeader({ label, hint, right }: { label: string; hint?: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-3 px-3 py-1 bg-muted/20 border-b border-border/30 shrink-0">
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</span>
      {hint && <span className="text-[11px] text-muted-foreground italic">{hint}</span>}
      {right && <div className="ml-auto">{right}</div>}
    </div>
  )
}
