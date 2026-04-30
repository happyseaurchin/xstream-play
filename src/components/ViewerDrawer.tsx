/**
 * ViewerDrawer — slide-down overlay showing what the active face attends to.
 *
 * Closed by default. Opens via the 👁 button in the header. Slides down over
 * the V/L/S surface; the user can drag the bottom edge to size it.
 *
 * Content per face:
 *   character / observer  → marks at this address (the landscape)
 *   author                → user's authored blocks: passport + shell manifest
 *                           pointers + blocks owned at this beach
 *   designer              → SHELL EDITOR — the reflexive move. Lets the user
 *                           edit shell:1.<digit>.{1,2,3,4} (default address /
 *                           knowledge gates / commit gates / persona) for each
 *                           CADO face. Writes via bsp() with the user's secret.
 *                           This is what makes the system self-shaping: the
 *                           user can change the gates that constrain how the
 *                           soft-LLM walks and writes for them.
 *
 * The viewer is secondary. Its job is to let the user "look up" briefly,
 * then dismiss it and return to V/L/S.
 */

import { useState, useRef, useEffect } from 'react'
import type { Face } from '../types/xstream'
import type { MarkRow } from '../kernel/beach-session'
import { bsp, readShell, type AgentShell, type PresenceMark, type ShellFace, type PscaleNode } from '../lib/bsp-client'

export interface ViewerDrawerProps {
  open: boolean
  onClose: () => void
  face: Face
  beach: string
  address: string
  marks: MarkRow[]
  presence: PresenceMark[]
  // Identity + shell — needed by author and designer faces. Pass-through;
  // character/observer don't read these.
  agentId: string
  secret: string
  shell: AgentShell | null
  onShellSaved?: (next: AgentShell) => void
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
        {props.face === 'author' && (
          <FaceAuthor agentId={props.agentId} secret={props.secret} shell={props.shell} beach={props.beach} />
        )}
        {props.face === 'designer' && (
          <FaceDesigner agentId={props.agentId} secret={props.secret} shell={props.shell} onShellSaved={props.onShellSaved} />
        )}
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

// ── Designer face — shell editor ──────────────────────────────────────────
//
// The reflexive move. Writes go to the user's own shell block via bsp() with
// their session secret as proof of authority. After save, we re-read the
// shell and call onShellSaved so the active face's gates flow into the next
// soft-LLM call without a page reload.

const FACE_LABELS: Record<'1' | '2' | '3' | '4', string> = {
  '1': 'Character — engage as yourself',
  '2': 'Author — edit your own blocks',
  '3': 'Designer — edit your own faces',
  '4': 'Observer — read-only',
}

function FaceDesigner({ agentId, secret, shell, onShellSaved }: { agentId: string; secret: string; shell: AgentShell | null; onShellSaved?: (s: AgentShell) => void }) {
  if (!agentId) {
    return <div className="text-sm text-muted-foreground italic">Identify in the floating button (handle + passphrase) to edit your shell.</div>
  }
  if (!shell) {
    return <div className="text-sm text-muted-foreground italic">Loading shell at <code>{agentId}:shell</code>…</div>
  }
  return (
    <div className="space-y-3">
      <div className="text-xs text-muted-foreground">
        Editing <code className="font-mono">{agentId}:shell</code>. Each face's <em>knowledge_gates</em> filters what the soft-LLM reads under that face; <em>commit_gates</em> filters what it can write. Comma-separated entries: <code>{agentId}</code>, <code>{agentId}:passport</code>, <code>https://…</code>, <code>sed:foo</code>.
      </div>
      {(['1', '2', '3', '4'] as const).map(digit => {
        const face = shell.faces.find(f => f.digit === digit)
        return (
          <FaceCard
            key={digit}
            digit={digit}
            face={face}
            agentId={agentId}
            secret={secret}
            onShellSaved={onShellSaved}
          />
        )
      })}
    </div>
  )
}

function FaceCard({ digit, face, agentId, secret, onShellSaved }: { digit: '1' | '2' | '3' | '4'; face: ShellFace | undefined; agentId: string; secret: string; onShellSaved?: (s: AgentShell) => void }) {
  const [label, setLabel] = useState(face?.label ?? FACE_LABELS[digit])
  const [defaultAddr, setDefaultAddr] = useState(face?.default_address ?? '')
  const [knowledge, setKnowledge] = useState(face?.knowledge_gates ?? '')
  const [commit, setCommit] = useState(face?.commit_gates ?? '')
  const [persona, setPersona] = useState(face?.persona ?? '')
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Re-sync when shell prop changes (e.g. after save in another card).
  useEffect(() => {
    setLabel(face?.label ?? FACE_LABELS[digit])
    setDefaultAddr(face?.default_address ?? '')
    setKnowledge(face?.knowledge_gates ?? '')
    setCommit(face?.commit_gates ?? '')
    setPersona(face?.persona ?? '')
  }, [face, digit])

  const dirty =
    (face?.label ?? FACE_LABELS[digit]) !== label ||
    (face?.default_address ?? '') !== defaultAddr ||
    (face?.knowledge_gates ?? '') !== knowledge ||
    (face?.commit_gates ?? '') !== commit ||
    (face?.persona ?? '') !== persona

  async function save() {
    if (!secret) {
      setError('Passphrase required to write your shell.')
      return
    }
    setSaving(true)
    setError(null)
    const content: PscaleNode = {
      _: label,
      '1': defaultAddr,
      '2': knowledge,
      '3': commit,
      '4': persona,
    }
    // Pass new_lock=secret so the first save of an unlocked shell sets
    // the write-lock (R1/R2). Subsequent saves rotate to the same hash —
    // idempotent. This makes the Designer face genuinely sovereign:
    // after the first edit, no one without the passphrase can rewrite
    // the user's gates, even though anyone can READ them.
    const result = await bsp({
      agent_id: agentId,
      block: 'shell',
      spindle: '1.' + digit,
      content,
      secret,
      new_lock: secret,
    })
    setSaving(false)
    if (!result.ok) {
      setError(('error' in result ? result.error : null) ?? 'write failed')
      return
    }
    setSavedAt(Date.now())
    // Re-read shell and bubble up so face gates take effect immediately.
    const next = await readShell(agentId)
    if (next && onShellSaved) onShellSaved(next)
  }

  const labelShort = (FACE_LABELS[digit].split('—')[0] || '').trim()

  return (
    <div className="border border-border/40 rounded p-3 bg-card/40 space-y-2">
      <div className="flex items-baseline gap-2">
        <span className="text-[10px] text-muted-foreground font-mono">shell:1.{digit}</span>
        <span className="text-sm font-medium">{labelShort}</span>
        <div className="ml-auto flex items-center gap-2">
          {error && <span className="text-[11px] text-destructive">{error}</span>}
          {savedAt && !dirty && !error && <span className="text-[11px] text-emerald-500">saved</span>}
          <button
            onClick={save}
            disabled={!dirty || saving || !secret}
            className="text-[11px] px-2 py-0.5 rounded bg-primary text-primary-foreground disabled:opacity-30 disabled:cursor-not-allowed hover:opacity-90"
            title={!secret ? 'add a passphrase in Identity to save' : dirty ? 'save this face' : 'no changes to save'}
          >
            {saving ? '…' : 'save'}
          </button>
        </div>
      </div>
      <FieldRow label="label" hint="shell:1.<digit>._ — short name + intent" value={label} onChange={setLabel} />
      <FieldRow label="default address" hint="pscale coord this face starts at" value={defaultAddr} onChange={setDefaultAddr} />
      <FieldRow label="knowledge gates" hint="comma-separated read scope refs" value={knowledge} onChange={setKnowledge} />
      <FieldRow label="commit gates" hint="comma-separated write scope refs" value={commit} onChange={setCommit} />
      <FieldRow label="persona" hint="soft-LLM persona for this face" value={persona} onChange={setPersona} multiline />
    </div>
  )
}

function FieldRow({ label, hint, value, onChange, multiline }: { label: string; hint: string; value: string; onChange: (v: string) => void; multiline?: boolean }) {
  return (
    <label className="block">
      <div className="flex items-baseline gap-2 mb-0.5">
        <span className="text-[11px] font-medium text-foreground">{label}</span>
        <span className="text-[10px] text-muted-foreground">{hint}</span>
      </div>
      {multiline ? (
        <textarea
          value={value}
          onChange={e => onChange(e.target.value)}
          rows={2}
          className="w-full px-2 py-1 text-xs font-mono rounded border border-border/40 bg-background text-foreground outline-none focus:border-primary/60 resize-y"
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          className="w-full px-2 py-1 text-xs font-mono rounded border border-border/40 bg-background text-foreground outline-none focus:border-primary/60"
        />
      )}
    </label>
  )
}

// ── Author face — owned blocks ────────────────────────────────────────────
//
// Lists the agent's own named blocks: passport, shell manifest entries, plus
// a "what's at this beach as me?" probe. Click an entry to expand into a
// raw JSON view (read-only for now — write affordances come with a richer
// block editor in a follow-up). The substrate-tray actions on the input
// panel cover the canonical writes (passport, register, engage, keys).

interface PoolEntry { digit: string; underscore: string; synthesis: string | null }

function FaceAuthor({ agentId, secret, shell, beach }: { agentId: string; secret: string; shell: AgentShell | null; beach: string }) {
  const [passport, setPassport] = useState<PscaleNode | null>(null)
  const [loadingPassport, setLoadingPassport] = useState(false)
  const [pools, setPools] = useState<PoolEntry[]>([])

  // void to satisfy lint — secret may be referenced in writes added later
  void secret

  useEffect(() => {
    if (!agentId) { setPassport(null); return }
    let cancelled = false
    setLoadingPassport(true)
    ;(async () => {
      const r = await bsp({ agent_id: agentId, block: 'passport' })
      if (cancelled) return
      setLoadingPassport(false)
      setPassport(r.ok && 'raw' in r ? r.raw : null)
    })()
    return () => { cancelled = true }
  }, [agentId])

  // Pool discovery — walk beach:2 to list pools at this beach. Each pool
  // is a sub-block at beach:2.<N> with its own underscore (purpose) and
  // optionally _synthesis. Pure read; no writes here.
  useEffect(() => {
    if (!beach) { setPools([]); return }
    let cancelled = false
    ;(async () => {
      const r = await bsp({ agent_id: beach, block: 'beach', spindle: '2' })
      if (cancelled) return
      if (!r.ok || !('raw' in r) || !r.raw || typeof r.raw !== 'object') { setPools([]); return }
      const root = r.raw as Record<string, PscaleNode>
      const poolsNode = root['2']
      if (typeof poolsNode !== 'object' || poolsNode === null) { setPools([]); return }
      const out: PoolEntry[] = []
      const po = poolsNode as Record<string, PscaleNode>
      for (let d = 1; d <= 9; d++) {
        const k = String(d)
        const v = po[k]
        if (typeof v !== 'object' || v === null) continue
        const vo = v as Record<string, PscaleNode>
        const u = typeof vo._ === 'string' ? (vo._ as string) : ''
        const synthNode = vo._synthesis
        let synthesis: string | null = null
        if (typeof synthNode === 'object' && synthNode !== null) {
          const sn = synthNode as Record<string, PscaleNode>
          if (typeof sn._ === 'string') synthesis = sn._ as string
        }
        if (!u && !synthesis) continue
        out.push({ digit: k, underscore: u, synthesis })
      }
      setPools(out)
    })()
    return () => { cancelled = true }
  }, [beach])

  if (!agentId) {
    return <div className="text-sm text-muted-foreground italic">Identify in the floating button to view what you've authored.</div>
  }

  return (
    <div className="space-y-3">
      <BlockCard
        label={`passport`}
        sublabel={`bsp(agent_id="${agentId}", block="passport")`}
        body={loadingPassport ? '(loading)' : passport ? formatPscale(passport, 0) : '(none — use 🪪 in the input panel to publish one)'}
        emptyHint="No passport yet"
      />
      {pools.length > 0 && (
        <div>
          <div className="text-[11px] text-muted-foreground uppercase tracking-wider mb-1">Pools at this beach (beach:2)</div>
          <ul className="space-y-1.5">
            {pools.map(p => (
              <li key={p.digit} className="px-2 py-1.5 border border-border/30 rounded bg-card/30">
                <div className="flex items-baseline gap-2">
                  <span className="text-[10px] text-muted-foreground font-mono">2.{p.digit}</span>
                  <span className="text-sm">{p.underscore || '(no purpose)'}</span>
                </div>
                {p.synthesis && (
                  <div className="text-[11px] text-muted-foreground mt-0.5 italic line-clamp-2">{p.synthesis}</div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {shell && shell.block_manifest.length > 0 && (
        <div>
          <div className="text-[11px] text-muted-foreground uppercase tracking-wider mb-1">Block manifest (shell:3)</div>
          <ul className="space-y-1 text-xs font-mono">
            {shell.block_manifest.map((ref, i) => (
              <li key={i} className="px-2 py-1 border border-border/30 rounded bg-card/30">{ref}</li>
            ))}
          </ul>
        </div>
      )}
      {shell && shell.watched_beaches.length > 0 && (
        <div>
          <div className="text-[11px] text-muted-foreground uppercase tracking-wider mb-1">Watched beaches (shell:2)</div>
          <ul className="space-y-1 text-xs font-mono">
            {shell.watched_beaches.map((url, i) => {
              const here = url === beach
              return <li key={i} className={`px-2 py-1 border border-border/30 rounded ${here ? 'bg-accent/30' : 'bg-card/30'}`}>{url}{here && <span className="ml-2 text-[10px] text-muted-foreground">(current)</span>}</li>
            })}
          </ul>
        </div>
      )}
    </div>
  )
}

function BlockCard({ label, sublabel, body, emptyHint }: { label: string; sublabel?: string; body: string; emptyHint?: string }) {
  return (
    <div className="border border-border/40 rounded bg-card/40">
      <div className="px-3 py-1.5 border-b border-border/30 flex items-baseline gap-2">
        <span className="text-sm font-medium">{label}</span>
        {sublabel && <span className="text-[10px] text-muted-foreground font-mono">{sublabel}</span>}
      </div>
      <pre className="px-3 py-2 text-[11px] font-mono whitespace-pre-wrap text-foreground/80 leading-relaxed">
        {body || emptyHint || ''}
      </pre>
    </div>
  )
}

/** Compact pretty-print of a pscale block, capped to keep the viewer light. */
function formatPscale(node: PscaleNode, depth: number, maxDepth = 3, maxStrLen = 200): string {
  if (typeof node === 'string') {
    return node.length > maxStrLen ? node.slice(0, maxStrLen) + '…' : node
  }
  if (depth >= maxDepth) return '{…}'
  if (typeof node !== 'object' || node === null) return ''
  const obj = node as Record<string, PscaleNode>
  const lines: string[] = []
  const indent = '  '.repeat(depth)
  if (typeof obj._ === 'string') lines.push(`${indent}_: ${obj._.length > maxStrLen ? obj._.slice(0, maxStrLen) + '…' : obj._}`)
  else if (typeof obj._ === 'object') lines.push(`${indent}_: ${formatPscale(obj._, depth + 1, maxDepth, maxStrLen)}`)
  for (const k of '123456789') {
    if (!(k in obj)) continue
    const v = obj[k]
    if (typeof v === 'string') lines.push(`${indent}${k}: ${v.length > maxStrLen ? v.slice(0, maxStrLen) + '…' : v}`)
    else if (typeof v === 'object' && v !== null) lines.push(`${indent}${k}: ${formatPscale(v, depth + 1, maxDepth, maxStrLen)}`)
  }
  return lines.join('\n')
}
