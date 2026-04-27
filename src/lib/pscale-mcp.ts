/**
 * pscale-mcp.ts — bridge to the pscale-mcp substrate.
 *
 * xstream-play and pscale-mcp share the same Supabase project
 * (piqxyfmzzywxzqkzmpmm). This module reads and writes the
 * `pscale_blocks` table directly — no HTTP protocol required.
 *
 * Block naming differs between the two systems:
 *   xstream-play     pscale-mcp
 *   ─────────        ──────────
 *   spatial-thornkeep   →   thornkeep-gm/thornkeep-world
 *   rules-thornkeep     →   thornkeep-gm/thornkeep-rules
 *   character-{id}      →   {agent_id}/passport (similar shape)
 *
 * The translation map lives here.
 *
 * Auth: pscale-mcp mode requires the player's pscale-mcp agent_id
 * + secret. Validated by reading the agent's passport block (must exist).
 * Locks (substrate-side) are checked when WRITING via this module —
 * we compute the same hash the pscale-mcp server does and verify against
 * position_hashes['_'] for ordinary blocks.
 *
 * Storage of the bridge state (toggle, agent_id, secret):
 *   localStorage 'xstream:pscale-mcp:enabled'      = '1' | '0'
 *   localStorage 'xstream:pscale-mcp:agent_id'     = string
 *   sessionStorage 'xstream:pscale-mcp:secret'     = string (per-tab)
 *
 * The secret is held in sessionStorage (cleared on tab close) — never
 * persisted to disk. This matches how the pscale-mcp protocol asks
 * agents to handle passphrases.
 */

import { getSupabase } from './supabase'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PscaleNode = string | { [key: string]: any }

// ── Toggle state ──

const ENABLED_KEY = 'xstream:pscale-mcp:enabled'
const AGENT_ID_KEY = 'xstream:pscale-mcp:agent_id'
const SECRET_SESSION_KEY = 'xstream:pscale-mcp:secret'

export function isPscaleMcpEnabled(): boolean {
  return localStorage.getItem(ENABLED_KEY) === '1'
}

export function setPscaleMcpEnabled(on: boolean): void {
  localStorage.setItem(ENABLED_KEY, on ? '1' : '0')
  if (!on) {
    localStorage.removeItem(AGENT_ID_KEY)
    sessionStorage.removeItem(SECRET_SESSION_KEY)
  }
}

export function getPscaleAgentId(): string | null {
  return localStorage.getItem(AGENT_ID_KEY)
}

export function setPscaleAgentId(agentId: string): void {
  localStorage.setItem(AGENT_ID_KEY, agentId)
}

export function getPscaleSecret(): string | null {
  return sessionStorage.getItem(SECRET_SESSION_KEY)
}

export function setPscaleSecret(secret: string): void {
  sessionStorage.setItem(SECRET_SESSION_KEY, secret)
}

export function clearPscaleSession(): void {
  sessionStorage.removeItem(SECRET_SESSION_KEY)
}

// ── Block read ──

export interface PscaleBlockRow {
  owner_id: string
  name: string
  block: PscaleNode
  position_hashes: Record<string, string>
  updated_at: string
}

/** Read a single block by owner + name. Returns null if not found. */
export async function fetchBlock(ownerId: string, name: string): Promise<PscaleBlockRow | null> {
  const sb = getSupabase()
  if (!sb) return null
  const { data, error } = await sb
    .from('pscale_blocks')
    .select('owner_id, name, block, position_hashes, updated_at')
    .eq('owner_id', ownerId)
    .eq('name', name)
    .maybeSingle()
  if (error) {
    console.warn('[pscale-mcp] fetchBlock error:', error.message)
    return null
  }
  return data as PscaleBlockRow | null
}

/** Verify a passport exists at this agent_id — returns true if found. */
export async function passportExists(agentId: string): Promise<boolean> {
  const row = await fetchBlock(agentId, 'passport')
  return row !== null
}

// ── Lock hash (matches pscale-mcp's hashBlockPassphrase) ──
//
// Salt namespace: "block:" + agent_id + ":" + name + ":" + position
// SHA-256 hex, lowercase.
//
// See pscale-mcp-server/src/tools/block-ops.ts:24

async function sha256Hex(data: string): Promise<string> {
  const buf = new TextEncoder().encode(data)
  const hash = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

export async function hashBlockPassphrase(
  passphrase: string, agentId: string, name: string, position: string,
): Promise<string> {
  const data = passphrase + 'block:' + agentId + ':' + name + ':' + position
  return sha256Hex(data)
}

/** Confirm the secret is the lock-key for this block. */
export async function verifyOwnership(
  agentId: string, name: string, secret: string,
): Promise<boolean> {
  const row = await fetchBlock(agentId, name)
  if (!row) return false
  const stored = row.position_hashes?._
  if (!stored) return true // unlocked block — anyone can write
  const computed = await hashBlockPassphrase(secret, agentId, name, '_')
  return computed === stored
}

// ── Block write (with optional lock-proof) ──
//
// Writes go through the same Supabase table the pscale-mcp server
// writes to. RLS is open-beta so the anon key can upsert. The lock
// check is enforced client-side here (and by pscale-mcp's tool
// handlers when writes come through the MCP route). For ordinary
// blocks with a whole-block lock at position_hashes['_'], the secret
// must hash correctly.

export interface WriteOptions {
  agentId: string
  name: string
  block: PscaleNode
  positionHashes?: Record<string, string>
  secret?: string  // required if the block has a whole-block lock
  blockType?: string
}

export async function writeBlock(opts: WriteOptions): Promise<{ ok: boolean; error?: string }> {
  const sb = getSupabase()
  if (!sb) return { ok: false, error: 'Supabase not configured' }

  // If the block exists and has a lock, verify ownership before writing
  const existing = await fetchBlock(opts.agentId, opts.name)
  if (existing?.position_hashes?._) {
    if (!opts.secret) return { ok: false, error: 'Block is locked. Secret required.' }
    const computed = await hashBlockPassphrase(opts.secret, opts.agentId, opts.name, '_')
    if (computed !== existing.position_hashes._) return { ok: false, error: 'Incorrect secret.' }
  }

  const positionHashes = opts.positionHashes ?? existing?.position_hashes ?? {}
  const blockType = opts.blockType ?? 'general'

  const { error } = await sb
    .from('pscale_blocks')
    .upsert({
      owner_id: opts.agentId,
      name: opts.name,
      block_type: blockType,
      block: opts.block,
      position_hashes: positionHashes,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'owner_id,name' })

  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

// ── Translation map: xstream-play block name ↔ pscale-mcp (owner_id, name) ──
//
// Currently only the world block is bridged. Rules, characters, agent
// blocks stay as static seeds — they don't change at runtime in the
// pscale-mcp ecology.

export interface PscaleMapping {
  ownerId: string
  name: string
}

const BRIDGE_MAP: Record<string, PscaleMapping> = {
  'spatial-thornkeep': { ownerId: 'thornkeep-gm', name: 'thornkeep-world' },
  // Future: 'rules-thornkeep' once authors-vs-designers split is stable
}

/** Returns the pscale-mcp address of an xstream-play block, or null if not bridged. */
export function bridgedAddress(xstreamName: string): PscaleMapping | null {
  return BRIDGE_MAP[xstreamName] ?? null
}

/**
 * Fetch all bridged blocks. Returns a map of xstream-play name → block content.
 * Skips blocks whose pscale-mcp counterpart isn't found.
 */
export async function fetchBridgedBlocks(): Promise<Record<string, PscaleNode>> {
  const result: Record<string, PscaleNode> = {}
  for (const [xstreamName, mapping] of Object.entries(BRIDGE_MAP)) {
    const row = await fetchBlock(mapping.ownerId, mapping.name)
    if (row) result[xstreamName] = row.block
  }
  return result
}

// ── Author observation write-through ──
//
// When the player is registered as an author in sed:thornkeep-authors,
// their author commits write to {agent_id}/thornkeep-observations.
// This matches the pscale-mcp convention — the world-compressor reads
// from there and integrates into the world block.

export async function writeObservation(
  agentId: string, secret: string,
  targetWorldAddress: string, detail: string,
): Promise<{ ok: boolean; error?: string; position?: string }> {
  const obsName = 'thornkeep-observations'
  const existing = await fetchBlock(agentId, obsName)

  // Ensure the block exists. If not, create it locked.
  if (!existing) {
    const initial: PscaleNode = { _: `${agentId}'s observations of Thornkeep` }
    const lockHash = await hashBlockPassphrase(secret, agentId, obsName, '_')
    const result = await writeBlock({
      agentId, name: obsName, block: initial,
      positionHashes: { _: lockHash },
    })
    if (!result.ok) return { ok: false, error: `Failed to create observations block: ${result.error}` }
  }

  // Walk current block, find next free numeric position at root.
  const fresh = await fetchBlock(agentId, obsName)
  if (!fresh) return { ok: false, error: 'Failed to load observations block after create' }
  const block = fresh.block as Record<string, PscaleNode>
  let next = 1
  while (next <= 9 && String(next) in block) next++
  if (next > 9) return { ok: false, error: 'Observations block at floor 1 capacity (extension to floor 2 is PENDING)' }

  const observation = `thornkeep-world@${targetWorldAddress} — ${detail}`
  block[String(next)] = observation

  const result = await writeBlock({
    agentId, name: obsName, block,
    positionHashes: fresh.position_hashes,
    secret,
  })
  if (!result.ok) return { ok: false, error: result.error }
  return { ok: true, position: String(next) }
}
