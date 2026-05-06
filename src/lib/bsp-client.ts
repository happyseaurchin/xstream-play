/**
 * bsp-client.ts — browser-side bsp() client for federated beaches.
 *
 * Implements the whetstone signature:
 *   bsp(agent_id, block, spindle, pscale_attention, content?, face?, tier?, secret?, gray?)
 *
 * Single dispatch path: every bsp() call routes to a federated beach via
 * /.well-known/pscale-beach.
 *   - URL agent_id (`https://…`) → that beach, with `block` as given.
 *   - Bare name (`alice`) → DEFAULT_BEACH, with block namespaced as
 *     `<handle>__<role>` (sibling-block convention; the beach hosts per-user
 *     blocks alongside its canonical `beach`).
 *   - sed:/grain: prefixes are NOT addressable via bsp() — use the MCP-HTTP
 *     primitives (`pscale_register`, `pscale_grain_reach`, etc.) which route
 *     through the bsp-mcp server. Calls with sed:/grain: agent_ids will be
 *     attempted at DEFAULT_BEACH for diagnostic purposes only.
 *
 * No central commons, no local apply-spindle, no local lock checks — write
 * semantics are the federated server's responsibility. Read when content is
 * omitted; write when content is provided.
 *
 * Higher-level helpers (presence heartbeat/read, shell read) sit on top of
 * the core bsp() function.
 */

import { bsp as walkBlock, collectUnderscore } from '../kernel/bsp';

// The default beach for bare-name agent_ids. Until per-user blocks are gated
// per-beach (paywall/membership), this is the public xstream beach. Override
// by passing a URL agent_id explicitly (the URL form takes precedence).
const DEFAULT_BEACH = 'https://happyseaurchin.com';

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
  /**
   * Set or rotate the write-lock at the addressed position. Per
   * bsp-mcp-server lock semantics:
   *   R1: block doesn't exist + new_lock          → create locked, no secret needed.
   *   R2: block unlocked       + new_lock          → set lock, no secret needed.
   *   R3: block locked         + secret            → secret proves authority for content writes.
   *   R4: block locked         + secret + new_lock → rotate lock (with optional content).
   * Currently honoured at the root underscore lock only (position '_').
   */
  new_lock?: string;
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

// ── Substrate I/O ──

interface BlockRow {
  owner_id: string;
  name: string;
  block: PscaleNode;
}

function isUrlAgent(agentId: string): boolean {
  return agentId.startsWith('http://') || agentId.startsWith('https://');
}

/** Resolve a (agent_id, block) request into a federated dispatch target.
 * URL agent_id → that beach, block unchanged. Bare/sed/grain agent_ids →
 * DEFAULT_BEACH with block namespaced as `<agent_id>__<block>` so each
 * caller's per-user blocks live as siblings of the beach's canonical block.
 */
function resolveDispatch(agentId: string, blockName: string): { agent_id: string; block: string } {
  if (isUrlAgent(agentId)) return { agent_id: agentId, block: blockName };
  return { agent_id: DEFAULT_BEACH, block: `${agentId}__${blockName}` };
}

/**
 * Federated beach loader — fetches `<agent_id>/.well-known/pscale-beach`
 * per protocol-pscale-beach-v2 §2.2. The endpoint returns a pscale block
 * (or a slice if ?spindle/pscale provided). Block name selectable via ?block=.
 */
async function loadBlockFederated(agentId: string, name: string): Promise<BlockRow | null> {
  const base = agentId.replace(/\/+$/, '') + '/.well-known/pscale-beach';
  const params = new URLSearchParams();
  if (name && name !== 'beach') params.set('block', name);
  // Cache-buster: federated beaches are mutable; the browser will happily
  // serve stale 304s otherwise and our poll loop never sees new marks.
  params.set('_t', String(Date.now()));
  const url = base + '?' + params.toString();
  try {
    // cache: 'no-store' instructs the browser cache to skip storing/matching
    // this request. We deliberately do NOT add a Cache-Control header — that
    // would turn the GET into a non-simple CORS request and trip preflight on
    // servers that don't allowlist the header. The ?_t= query param plus
    // 'no-store' is enough.
    const r = await fetch(url, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (!r.ok) {
      if (r.status !== 404) console.warn('[bsp federated] non-OK:', r.status, url);
      return null;
    }
    const block = await r.json() as PscaleNode;
    return { owner_id: agentId, name, block };
  } catch (e) {
    console.warn('[bsp federated] fetch failed:', e);
    return null;
  }
}

async function saveBlockFederated(agentId: string, name: string, block: PscaleNode, params: { spindle?: string; pscale_attention?: number; secret?: string; new_lock?: string }): Promise<{ ok: boolean; error?: string }> {
  const url = agentId.replace(/\/+$/, '') + '/.well-known/pscale-beach';
  const body: Record<string, unknown> = {
    block: name,
    spindle: params.spindle ?? '',
    content: block,
  };
  if (params.pscale_attention !== undefined) body.pscale_attention = params.pscale_attention;
  if (params.secret) body.secret = params.secret;
  if (params.new_lock) body.new_lock = params.new_lock;
  try {
    const r = await fetch(url, {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
    const respText = await r.text().catch(() => '');
    if (!r.ok) {
      console.warn('[bsp federated] write rejected:', r.status, respText.slice(0, 300));
      return { ok: false, error: `HTTP ${r.status}: ${respText.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (e) {
    console.warn('[bsp federated] write threw:', e);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
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

// ── Core bsp() ──

export async function bsp(params: BspParams): Promise<BspReadResult | BspWriteResult> {
  const { agent_id, block: blockName, spindle, pscale_attention, content, secret, new_lock } = params;
  const parsed = parseSpindle(spindle);
  const isWrite = content !== undefined || new_lock !== undefined;
  const shape = deriveShape(parsed, pscale_attention, isWrite);

  // Single dispatch path: URL → that beach; bare → default beach sibling.
  // No central commons, no local apply, no local lock-check — federated
  // server owns all write semantics including spindle apply and locks.
  const dispatch = resolveDispatch(agent_id, blockName);

  if (isWrite) {
    const r = await saveBlockFederated(dispatch.agent_id, dispatch.block, (content ?? null) as PscaleNode, {
      spindle: spindle ?? '',
      pscale_attention,
      secret,
      new_lock,
    });
    return r.ok ? { ok: true, shape } : { ok: false, shape, error: r.error };
  }

  // Read.
  const row = await loadBlockFederated(dispatch.agent_id, dispatch.block);
  if (!row) return { ok: true, shape, data: null, raw: null };
  const data = walkForShape(row.block, parsed, pscale_attention, shape);
  return { ok: true, shape, data, raw: row.block };
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

export interface GrainEntry {
  partner: string;
  pair_id: string;
}

export interface AgentShell {
  description: string;
  faces: ShellFace[];
  watched_beaches: string[];
  block_manifest: string[];
  /** Grains the user has reached or formed — stored at shell:6.<digit> as
   * "<partner>|<pair_id>" strings. Click in the home view to switch the
   * column to this grain. */
  grains: GrainEntry[];
  raw: PscaleNode;
}

/** Compute a pair_id from two agent_ids — sha256(sort(A,B).join('|'))[:16].
 * Verified against the bsp-mcp substrate via a synthetic grain_reach
 * (claude-pairtest-alice + claude-pairtest-bob → pair_id 240260a4dc35a01b
 * matches sha256("claude-pairtest-alice|claude-pairtest-bob")[:16]).
 * Sort order is JS string-default; separator is the pipe character. */
export async function computePairId(a: string, b: string): Promise<string> {
  const sorted = [a, b].sort();
  const data = new TextEncoder().encode(sorted.join('|'));
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 16);
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

  const grains: GrainEntry[] = [];
  const grainsNode = block['6'];
  if (typeof grainsNode === 'object' && grainsNode !== null) {
    const go = grainsNode as Record<string, PscaleNode>;
    for (let d = 1; d <= 9; d++) {
      const v = go[String(d)];
      if (typeof v === 'string' && v.includes('|')) {
        const [partner, pair_id] = v.split('|', 2);
        if (partner && pair_id) grains.push({ partner, pair_id });
      }
    }
  }

  return { description, faces, watched_beaches: watched, block_manifest: manifest, grains, raw };
}

/** Write a grain entry to shell:6.<next-free>. Used after a successful
 * engage to remember the bilateral channel so the home view can offer
 * one-click switch to the grain. v0.3 grain switching. */
export async function addGrainToShell(opts: {
  agent_id: string;
  secret: string;
  partner: string;
  pair_id: string;
}): Promise<{ ok: boolean; message: string }> {
  const { agent_id, secret, partner, pair_id } = opts;
  // Read current shell to find a free slot at 6.<digit> and avoid duplicates.
  const shell = await readShell(agent_id);
  if (shell?.grains.some(g => g.pair_id === pair_id)) {
    return { ok: true, message: 'grain already in shell:6' };
  }
  let nextDigit: string | null = null;
  if (shell) {
    const block = shell.raw as Record<string, PscaleNode>;
    const grainsNode = block['6'];
    const ring = (typeof grainsNode === 'object' && grainsNode !== null)
      ? grainsNode as Record<string, PscaleNode>
      : {};
    for (let d = 1; d <= 9; d++) {
      if (!(String(d) in ring) || typeof ring[String(d)] !== 'string') {
        nextDigit = String(d);
        break;
      }
    }
  } else {
    nextDigit = '1';
  }
  if (!nextDigit) return { ok: false, message: 'shell:6 is full (9 grains max)' };
  const result = await bsp({
    agent_id,
    block: 'shell',
    spindle: '6.' + nextDigit,
    content: `${partner}|${pair_id}`,
    secret,
  });
  if (result.kind !== 'write') return { ok: false, message: 'unexpected result kind' };
  const w = result as BspWriteResult;
  return w.ok
    ? { ok: true, message: `grain stored at shell:6.${nextDigit}` }
    : { ok: false, message: 'error' in w && w.error ? w.error : 'shell write failed' };
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

// ── Five non-geometric primitives via MCP-over-HTTP to bsp.hermitcrab.me ──
//
// bsp() handles read/write geometry; these five are substrate state machines
// (lock allocation, key derivation, signature verification) that bsp() alone
// cannot subsume per whetstone:5. The bsp-mcp server implements them; we call
// it directly from the browser via mcp-client.ts.
//
// The server's CORS allows any origin and exposes mcp-session-id, so the
// browser path works directly. Each helper returns { ok, ... } with the
// human-readable summary surfaced from the tool result for UI feedback.

import { mcpCallTool, mcpExtractText } from './mcp-client';

export interface PrimitiveResult {
  ok: boolean;
  message: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  raw?: any;
  error?: string;
}

async function dispatchPrimitive(name: string, args: Record<string, unknown>): Promise<PrimitiveResult> {
  try {
    const result = await mcpCallTool(name, args);
    const message = mcpExtractText(result) || JSON.stringify(result.structuredContent ?? {}).slice(0, 200);
    return { ok: !result.isError, message, raw: result };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e), error: e instanceof Error ? e.message : String(e) };
  }
}

export async function pscaleRegister(opts: { collective: string; declaration: string; passphrase: string; shell_ref?: string }): Promise<PrimitiveResult> {
  return dispatchPrimitive('pscale_register', opts);
}

export async function pscaleGrainReach(opts: { agent_id: string; partner_agent_id: string; description: string; my_side_content: string; my_passphrase: string }): Promise<PrimitiveResult> {
  return dispatchPrimitive('pscale_grain_reach', opts);
}

export async function pscaleKeyPublish(opts: { agent_id: string; secret: string; prior_secret?: string; signature?: string }): Promise<PrimitiveResult> {
  return dispatchPrimitive('pscale_key_publish', opts);
}

export async function pscaleCreateCollective(opts: { collective: string; conventions: string; creator_passphrase: string }): Promise<PrimitiveResult> {
  return dispatchPrimitive('pscale_create_collective', opts);
}

export async function pscaleVerifyRider(opts: { sender_agent_id: string; rider?: string; probe_id?: string; chain?: string; topic_coordinate?: string }): Promise<PrimitiveResult> {
  return dispatchPrimitive('pscale_verify_rider', opts);
}
