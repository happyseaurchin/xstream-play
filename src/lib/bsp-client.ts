/**
 * bsp-client.ts — browser-side bsp() client for the bsp-mcp commons.
 *
 * Implements the whetstone signature:
 *   bsp(agent_id, block, spindle, pscale_attention, content?, face?, tier?, secret?, gray?)
 *
 * Read when content is omitted; write when content is provided. Selection shape
 * derives from (spindle length, pscale_attention) per whetstone:2. Modifiers
 * (face, tier, secret, gray) compose without altering the geometry.
 *
 * Substrate dispatch by block name prefix per whetstone:3.6 — ordinary names
 * route to pscale_blocks; sed: and grain: prefixes are reserved for future
 * registration and grain substrates (passthrough today, server-validated later).
 *
 * URL-prefixed agent_ids (matching ^https?://) currently fall through to the
 * commons. When bsp-mcp Stage 3 (WellKnownAdapter) ships, those route to the
 * remote /.well-known/pscale-beach endpoint instead — change is a single
 * dispatch branch.
 *
 * Higher-level helpers (presence heartbeat/read, shell read) sit on top of
 * the core bsp() function.
 */

import { getSupabase } from './supabase';
import { bsp as walkBlock, collectUnderscore } from '../kernel/bsp';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PscaleNode = string | { [key: string]: any };

export type Face = 'character' | 'author' | 'designer' | 'observer';
export type Tier = 'soft' | 'medium' | 'hard';

export interface BspParams {
  agent_id: string;
  block: string;
  spindle?: string;
  pscale_attention?: number;
  content?: PscaleNode;
  face?: Face;
  tier?: Tier;
  secret?: string;
  gray?: boolean;
}

export type BspShape = 'whole' | 'spindle' | 'point' | 'ring' | 'dir' | 'disc' | 'star';

export interface BspReadResult {
  ok: true;
  shape: BspShape;
  data: unknown;
  raw: PscaleNode | null;
}

export interface BspWriteResult {
  ok: boolean;
  shape: BspShape;
  error?: string;
}

// ── SHA-256 (matches pscale-mcp's hashBlockPassphrase) ──

async function sha256Hex(data: string): Promise<string> {
  const buf = new TextEncoder().encode(data);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hashBlockPassphrase(secret: string, agentId: string, name: string, position: string): Promise<string> {
  return sha256Hex(secret + 'block:' + agentId + ':' + name + ':' + position);
}

// ── Substrate I/O ──

interface BlockRow {
  owner_id: string;
  name: string;
  block: PscaleNode;
  position_hashes: Record<string, string>;
}

async function loadBlock(agentId: string, name: string): Promise<BlockRow | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb
    .from('pscale_blocks')
    .select('owner_id, name, block, position_hashes')
    .eq('owner_id', agentId)
    .eq('name', name)
    .maybeSingle();
  if (error) {
    console.warn('[bsp] loadBlock error:', error.message);
    return null;
  }
  return data as BlockRow | null;
}

async function saveBlock(agentId: string, name: string, block: PscaleNode, positionHashes: Record<string, string>): Promise<{ ok: boolean; error?: string }> {
  const sb = getSupabase();
  if (!sb) return { ok: false, error: 'Supabase not configured' };
  const { error } = await sb.from('pscale_blocks').upsert({
    owner_id: agentId,
    name,
    block_type: 'general',
    block,
    position_hashes: positionHashes,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'owner_id,name' });
  return error ? { ok: false, error: error.message } : { ok: true };
}

// ── Spindle parsing & shape derivation ──

interface ParsedSpindle {
  digits: string[];
  hasStar: boolean;
}

function parseSpindle(spindle: string | undefined): ParsedSpindle {
  if (!spindle) return { digits: [], hasStar: false };
  const hasStar = spindle.endsWith('*') || spindle.endsWith('.*');
  const cleaned = spindle.replace(/\.?\*$/, '');
  if (!cleaned) return { digits: [], hasStar };
  const [integer = '0', frac = ''] = cleaned.split('.');
  const fracClean = frac.replace(/0+$/, '');
  const digits = integer === '0' ? [...fracClean] : [...(integer + fracClean)];
  return { digits, hasStar };
}

function deriveShape(parsed: ParsedSpindle, pAtt: number | undefined, isWrite: boolean): BspShape {
  const pEnd = parsed.digits.length;
  if (parsed.hasStar) return 'star';
  if (parsed.digits.length === 0 && pAtt === undefined) return 'whole';
  if (parsed.digits.length === 0 && pAtt !== undefined) return 'disc';
  if (pAtt === undefined) return isWrite ? 'point' : 'spindle';
  if (pAtt === pEnd) return 'point';
  if (pAtt === pEnd - 1) return 'ring';
  if (pAtt < pEnd - 1) return 'dir';
  return 'spindle';
}

// ── Walk dispatch (uses local kernel/bsp walker) ──

function walkForShape(block: PscaleNode, parsed: ParsedSpindle, pAtt: number | undefined, shape: BspShape): unknown {
  const spindleStr = parsed.digits.join('');
  const spindleNum = spindleStr === '' ? null : (spindleStr.length === 1 ? spindleStr : parseFloat('0.' + spindleStr));

  switch (shape) {
    case 'whole':
      return walkBlock(block);
    case 'star':
      return walkBlock(block, spindleNum, '*');
    case 'point':
      return walkBlock(block, spindleNum, pAtt ?? null, 'point');
    case 'ring':
      return walkBlock(block, spindleNum, 'ring');
    case 'dir':
      return walkBlock(block, spindleNum, 'dir');
    case 'disc':
      return walkBlock(block, null, pAtt ?? null, 'disc');
    case 'spindle':
    default:
      return walkBlock(block, spindleNum);
  }
}

// ── Write at spindle (mutates block, returns new block) ──

function applyWrite(block: PscaleNode, parsed: ParsedSpindle, content: PscaleNode): PscaleNode {
  if (parsed.digits.length === 0) return content;
  const root = (typeof block === 'object' && block !== null) ? { ...(block as Record<string, PscaleNode>) } : {};
  let cursor = root as Record<string, PscaleNode>;
  for (let i = 0; i < parsed.digits.length - 1; i++) {
    const k = parsed.digits[i] === '0' ? '_' : parsed.digits[i];
    const next = cursor[k];
    if (typeof next !== 'object' || next === null) {
      cursor[k] = {};
    } else {
      cursor[k] = { ...(next as Record<string, PscaleNode>) };
    }
    cursor = cursor[k] as Record<string, PscaleNode>;
  }
  const lastDigit = parsed.digits[parsed.digits.length - 1];
  cursor[lastDigit === '0' ? '_' : lastDigit] = content;
  return root;
}

// ── Lock check ──

async function checkLock(row: BlockRow | null, agentId: string, name: string, secret: string | undefined): Promise<string | null> {
  if (!row) return null;
  const stored = row.position_hashes?._;
  if (!stored) return null;
  if (!secret) return 'Block is locked. Secret required.';
  const computed = await hashBlockPassphrase(secret, agentId, name, '_');
  return computed === stored ? null : 'Incorrect secret.';
}

// ── Core bsp() ──

export async function bsp(params: BspParams): Promise<BspReadResult | BspWriteResult> {
  const { agent_id, block: blockName, spindle, pscale_attention, content, secret } = params;
  const parsed = parseSpindle(spindle);
  const isWrite = content !== undefined;
  const shape = deriveShape(parsed, pscale_attention, isWrite);

  const row = await loadBlock(agent_id, blockName);

  if (!isWrite) {
    if (!row) return { ok: true, shape, data: null, raw: null };
    const data = walkForShape(row.block, parsed, pscale_attention, shape);
    return { ok: true, shape, data, raw: row.block };
  }

  const lockErr = await checkLock(row, agent_id, blockName, secret);
  if (lockErr) return { ok: false, shape, error: lockErr };

  const baseBlock = row?.block ?? {};
  const newBlock = applyWrite(baseBlock, parsed, content as PscaleNode);
  const result = await saveBlock(agent_id, blockName, newBlock, row?.position_hashes ?? {});
  return result.ok ? { ok: true, shape } : { ok: false, shape, error: result.error };
}

// ── Helpers: presence (per docs/presence-via-marks.md) ──

export interface PresenceMark {
  agent_id: string;
  address: string;
  timestamp: string;
  summary?: string;
}

export interface PresenceRead {
  present: PresenceMark[];
  raw_marks_count: number;
}

const DEFAULT_STALENESS_MS = 30_000;

/**
 * Heartbeat: write or overwrite this agent's presence mark at digit `digit`
 * under `1` of the beach block. Caller maintains the digit across heartbeats
 * (claim once, reuse). Returns the digit used.
 */
export async function presenceHeartbeat(opts: {
  beach: string;
  digit: string;
  agent_id: string;
  address: string;
  summary?: string;
}): Promise<{ ok: boolean; digit: string; error?: string }> {
  const ts = new Date().toISOString();
  const summary = opts.summary ?? `${opts.agent_id} @ ${ts} — present at ${opts.address || '/'}`;
  const result = await bsp({
    agent_id: opts.beach,
    block: 'beach',
    spindle: '1.' + opts.digit,
    content: { _: summary, '1': opts.agent_id, '2': opts.address, '3': ts },
  });
  return result.ok
    ? { ok: true, digit: opts.digit }
    : { ok: false, digit: opts.digit, error: (result as BspWriteResult).error };
}

/**
 * Claim a presence digit. Strategy: read marks ring, find a digit where the
 * mark is either absent, ours (same agent_id), or stale. Returns the digit.
 * Falls back to '1' on any read failure.
 */
export async function presenceClaimDigit(opts: {
  beach: string;
  agent_id: string;
  stalenessMs?: number;
}): Promise<string> {
  const stalenessMs = opts.stalenessMs ?? DEFAULT_STALENESS_MS;
  const result = await bsp({ agent_id: opts.beach, block: 'beach', spindle: '1' });
  if (!result.ok || (result as BspReadResult).raw === null) return '1';
  const raw = (result as BspReadResult).raw;
  if (typeof raw !== 'object' || raw === null) return '1';
  const marks = (raw as Record<string, PscaleNode>)['1'];
  if (typeof marks !== 'object' || marks === null) return '1';
  const now = Date.now();
  const taken = new Set<string>();
  for (let d = 1; d <= 9; d++) {
    const k = String(d);
    const m = (marks as Record<string, PscaleNode>)[k];
    if (m === undefined) continue;
    if (typeof m !== 'object' || m === null) { taken.add(k); continue; }
    const obj = m as Record<string, PscaleNode>;
    const mAgent = obj['1'];
    const mTs = obj['3'];
    if (mAgent === opts.agent_id) return k;
    if (typeof mTs === 'string') {
      const age = now - Date.parse(mTs);
      if (Number.isFinite(age) && age < stalenessMs) taken.add(k);
    } else {
      taken.add(k);
    }
  }
  for (let d = 1; d <= 9; d++) {
    const k = String(d);
    if (!taken.has(k)) return k;
  }
  return '1';
}

/**
 * Read presence at an address: ring-read marks under `1`, filter by 3
 * required fields, prefix-match address, drop stale.
 */
export async function presenceRead(opts: {
  beach: string;
  address?: string;
  stalenessMs?: number;
}): Promise<PresenceRead> {
  const stalenessMs = opts.stalenessMs ?? DEFAULT_STALENESS_MS;
  const addressFilter = opts.address ?? '';
  const result = await bsp({ agent_id: opts.beach, block: 'beach', spindle: '1' });
  if (!result.ok || (result as BspReadResult).raw === null) return { present: [], raw_marks_count: 0 };
  const raw = (result as BspReadResult).raw;
  if (typeof raw !== 'object' || raw === null) return { present: [], raw_marks_count: 0 };
  const marks = (raw as Record<string, PscaleNode>)['1'];
  if (typeof marks !== 'object' || marks === null) return { present: [], raw_marks_count: 0 };
  const now = Date.now();
  const present: PresenceMark[] = [];
  let rawCount = 0;
  for (const k of Object.keys(marks as Record<string, PscaleNode>)) {
    if (k === '_') continue;
    rawCount++;
    const m = (marks as Record<string, PscaleNode>)[k];
    if (typeof m !== 'object' || m === null) continue;
    const obj = m as Record<string, PscaleNode>;
    const agentId = obj['1'];
    const address = obj['2'];
    const timestamp = obj['3'];
    if (typeof agentId !== 'string' || typeof address !== 'string' || typeof timestamp !== 'string') continue;
    if (!address.startsWith(addressFilter)) continue;
    const age = now - Date.parse(timestamp);
    if (!Number.isFinite(age) || age >= stalenessMs) continue;
    const summary = typeof obj._ === 'string' ? (obj._ as string) : undefined;
    present.push({ agent_id: agentId, address, timestamp, summary });
  }
  return { present, raw_marks_count: rawCount };
}

// ── Helpers: shell (per docs/protocol-agent-shell.md) ──

export interface ShellFace {
  digit: '1' | '2' | '3' | '4';
  canonical: Face;
  label: string;
  default_address: string;
  knowledge_gates: string;
  commit_gates: string;
  persona: string;
}

export interface AgentShell {
  description: string;
  faces: ShellFace[];
  watched_beaches: string[];
  block_manifest: string[];
  raw: PscaleNode;
}

const CADO_ORDER: Record<'1' | '2' | '3' | '4', Face> = {
  '1': 'character', '2': 'author', '3': 'designer', '4': 'observer',
};

function readField(obj: Record<string, PscaleNode>, key: string): string {
  const v = obj[key];
  if (typeof v === 'string') return v;
  if (typeof v === 'object' && v !== null) {
    const inner = collectUnderscore(v);
    return inner ?? '';
  }
  return '';
}

/** Read an agent's shell. Returns null if absent. */
export async function readShell(agent_id: string): Promise<AgentShell | null> {
  const result = await bsp({ agent_id, block: 'shell' });
  if (!result.ok) return null;
  const raw = (result as BspReadResult).raw;
  if (typeof raw !== 'object' || raw === null) return null;
  const block = raw as Record<string, PscaleNode>;
  const description = collectUnderscore(block) ?? '';

  const faces: ShellFace[] = [];
  const facesNode = block['1'];
  if (typeof facesNode === 'object' && facesNode !== null) {
    const fObj = facesNode as Record<string, PscaleNode>;
    for (const d of ['1', '2', '3', '4'] as const) {
      const f = fObj[d];
      if (typeof f === 'object' && f !== null) {
        const fo = f as Record<string, PscaleNode>;
        const label = (typeof fo._ === 'string') ? fo._ as string : (collectUnderscore(f) ?? '');
        faces.push({
          digit: d,
          canonical: CADO_ORDER[d],
          label,
          default_address: readField(fo, '1'),
          knowledge_gates: readField(fo, '2'),
          commit_gates: readField(fo, '3'),
          persona: readField(fo, '4'),
        });
      }
    }
  }

  const watched: string[] = [];
  const watchedNode = block['2'];
  if (typeof watchedNode === 'object' && watchedNode !== null) {
    const wo = watchedNode as Record<string, PscaleNode>;
    for (let d = 1; d <= 9; d++) {
      const v = wo[String(d)];
      if (typeof v === 'string') watched.push(v);
    }
  }

  const manifest: string[] = [];
  const manifestNode = block['3'];
  if (typeof manifestNode === 'object' && manifestNode !== null) {
    const mo = manifestNode as Record<string, PscaleNode>;
    for (let d = 1; d <= 9; d++) {
      const v = mo[String(d)];
      if (typeof v === 'string') manifest.push(v);
    }
  }

  return { description, faces, watched_beaches: watched, block_manifest: manifest, raw };
}

// ── Block reference resolution (per docs/protocol-block-references.md) ──

export type RefKind = 'url' | 'sed' | 'grain' | 'qualified' | 'qualified-spindle' | 'bare';

export interface ParsedRef {
  kind: RefKind;
  raw: string;
  agent_id: string;
  block: string;
  spindle?: string;
}

/** Canonicalise an HTTPS origin for use as agent_id. */
function canonicaliseOrigin(url: string): string {
  try {
    const u = new URL(url);
    const scheme = u.protocol.toLowerCase().replace(':', '');
    let host = u.host.toLowerCase();
    if ((scheme === 'https' && u.port === '443') || (scheme === 'http' && u.port === '80')) {
      host = u.hostname.toLowerCase();
    }
    return `${scheme}://${host}`;
  } catch {
    return url;
  }
}

/**
 * Parse a string block reference into its target address. Five forms:
 * URL, sed:, grain:, agent_id:block[:spindle], bare name.
 */
export function parseRef(ref: string, containing_agent_id: string): ParsedRef {
  if (ref.startsWith('http://') || ref.startsWith('https://')) {
    return { kind: 'url', raw: ref, agent_id: canonicaliseOrigin(ref), block: 'beach' };
  }
  if (ref.startsWith('sed:')) {
    const parts = ref.split(':');
    const collective = parts[1] ?? '';
    const position = parts.slice(2).join(':');
    return { kind: 'sed', raw: ref, agent_id: 'sed:' + collective, block: collective, spindle: position || undefined };
  }
  if (ref.startsWith('grain:')) {
    const parts = ref.split(':');
    const pair_id = parts[1] ?? '';
    const side = parts.slice(2).join(':');
    return { kind: 'grain', raw: ref, agent_id: 'grain:' + pair_id, block: 'grain', spindle: side || undefined };
  }
  if (ref.includes(':')) {
    const parts = ref.split(':');
    const agent_id = parts[0];
    const block = parts[1];
    if (parts.length === 2) {
      return { kind: 'qualified', raw: ref, agent_id, block };
    }
    return { kind: 'qualified-spindle', raw: ref, agent_id, block, spindle: parts.slice(2).join(':') };
  }
  return { kind: 'bare', raw: ref, agent_id: containing_agent_id, block: ref };
}

export interface ResolvedRef {
  ref: string;
  parsed: ParsedRef;
  block: PscaleNode | null;
}

/** Fetch and return the block addressed by a reference string. */
export async function resolveRef(ref: string, containing_agent_id: string): Promise<ResolvedRef> {
  const parsed = parseRef(ref, containing_agent_id);
  const result = await bsp({
    agent_id: parsed.agent_id,
    block: parsed.block,
    spindle: parsed.spindle,
  });
  const block = result.ok && 'raw' in result ? result.raw : null;
  return { ref, parsed, block };
}

/**
 * Walk the hidden directory at `address` of `block_name` belonging to `agent_id`,
 * and resolve every string entry per the reference forms. Returns one entry
 * per resolved ref; non-string entries (inline blocks) are skipped.
 */
export async function resolveStarRefs(opts: {
  agent_id: string;
  block_name: string;
  address?: string;
  containing_agent_id?: string;
}): Promise<Array<{ digit: string; ref: string; resolved: ResolvedRef }>> {
  const result = await bsp({
    agent_id: opts.agent_id,
    block: opts.block_name,
    spindle: (opts.address ?? '') + '*',
  });
  if (!result.ok || result.shape !== 'star') return [];
  const data = (result as BspReadResult).data as { hidden?: Record<string, PscaleNode> | null } | null;
  const hidden = data?.hidden;
  if (!hidden) return [];
  const containing = opts.containing_agent_id ?? opts.agent_id;
  const out: Array<{ digit: string; ref: string; resolved: ResolvedRef }> = [];
  for (const digit of ['1', '2', '3', '4', '5', '6', '7', '8', '9']) {
    const v = hidden[digit];
    if (typeof v !== 'string' || !v) continue;
    const resolved = await resolveRef(v, containing);
    out.push({ digit, ref: v, resolved });
  }
  return out;
}

/**
 * Write a minimal default shell for an agent — four CADO faces, the given
 * beach in shell:2, an empty block manifest at shell:3. Only writes if no
 * shell currently exists. Returns true on success or no-op.
 */
export async function bootstrapShell(opts: {
  agent_id: string;
  starting_beach: string;
  description?: string;
}): Promise<{ ok: boolean; bootstrapped: boolean; error?: string }> {
  const existing = await readShell(opts.agent_id);
  if (existing) return { ok: true, bootstrapped: false };

  const shell: PscaleNode = {
    _: opts.description ?? `${opts.agent_id} — operational shell.`,
    '1': {
      _: 'Faces — modes of engagement',
      '1': { _: 'Character — engage as yourself', '1': '', '4': `You are ${opts.agent_id}. Speak in first person.` },
      '2': { _: 'Author — edit your own blocks', '1': '', '3': opts.agent_id },
      '3': { _: 'Designer — edit your own faces', '1': '', '3': `${opts.agent_id}:shell` },
      '4': { _: 'Observer — read-only', '1': '' },
    },
    '2': {
      _: 'Watched beaches',
      '1': opts.starting_beach,
    },
    '3': {
      _: 'Block manifest — pointers to the agent\'s other named blocks',
    },
    '9': {
      _: 'Shell metadata',
      '1': 'v1',
    },
  };

  const result = await bsp({ agent_id: opts.agent_id, block: 'shell', content: shell });
  return result.ok
    ? { ok: true, bootstrapped: true }
    : { ok: false, bootstrapped: false, error: (result as BspWriteResult).error };
}

// ── Agent-block hidden-directory helpers ──

/**
 * Mutate an in-memory agent block to set position 0.<digit> (a hidden-directory
 * entry under the root underscore) to a string reference. The block underscore
 * must already be an object (with its own _.) holding a hidden directory.
 */
export function setHiddenRef(block: PscaleNode, digit: string, ref: string): void {
  if (typeof block !== 'object' || block === null) return;
  const root = block as Record<string, PscaleNode>;
  if (typeof root._ !== 'object' || root._ === null) return;
  (root._ as Record<string, PscaleNode>)[digit] = ref;
}

/** Coerce a beach identifier into a URL form for the resolver. */
export function beachToRef(beach: string): string {
  if (!beach) return '';
  if (beach.startsWith('http://') || beach.startsWith('https://')) return beach;
  if (beach.includes('://')) return beach;
  if (beach.includes('.')) return 'https://' + beach;
  return beach;
}
