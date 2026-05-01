/**
 * Beach kernel — the runtime poll loop of an xstream beach client.
 *
 * No game state. No relay. Talks to the bsp-mcp commons / federated beach via
 * bsp-client only. Each cycle:
 *   1. Heartbeat presence at current_beach:1.<digit>
 *   2. Read presence at current_beach:1, filter by address prefix → live peers
 *   3. Read marks at current_beach:1 (filtered by address) — drives Solid in
 *      beachcombing mode.
 *   4. Pool mode (when session.current_pool is set — derived from address
 *      `2.<digit>`): project beach:2.<pool> from the same raw and surface
 *      purpose / synthesis / contributions.
 *   5. Frame mode (when session.current_frame is set): read the frame disc at
 *      current_beach:current_frame and surface entities + synthesis.
 *
 * The kernel never calls an LLM. Tier-2 paths (soft, medium, synthesise) are
 * fired by the UI on user action and write back via bsp() like any other
 * substrate write.
 */

import {
  bsp,
  presenceHeartbeat,
  presenceClaimDigit,
  presenceRead,
  type PresenceMark,
  type BspReadResult,
  type PscaleNode,
} from '../lib/bsp-client';
import { poolFromAddress } from './beach-session';
import type { BeachSession, MarkRow, FrameView, FrameEntity, PoolView, PoolContribution, LiquidPeer, Face } from './beach-session';

const FACE_VALUES: ReadonlyArray<Face> = ['character', 'author', 'designer', 'observer'];
function asFace(v: unknown): Face | null {
  return typeof v === 'string' && (FACE_VALUES as readonly string[]).includes(v) ? (v as Face) : null;
}

export interface InboxItem {
  beach: string;             // beach URL where the mark lives
  digit: string;             // position under beach:1
  agent_id: string | null;   // who left it
  address: string | null;    // pscale coord
  timestamp: string | null;
  text: string;              // the mark's underscore content
}

export interface BeachKernelCallbacks {
  onPresence: (peers: PresenceMark[]) => void;
  onMarks: (marks: MarkRow[]) => void;
  onFrame: (frame: FrameView | null) => void;
  onPool: (pool: PoolView | null) => void;
  onLiquid: (peers: LiquidPeer[]) => void;
  onInbox: (items: InboxItem[]) => void;
  onError: (err: string) => void;
  onLog: (msg: string) => void;
}

const LIQUID_STALENESS_MS = 60_000;

const DEFAULT_POLL_MS = 4000;
const PRESENCE_DIGIT_CACHE = new Map<string, string>();

async function getPresenceDigit(beach: string, agentId: string): Promise<string> {
  const k = `${beach}::${agentId}`;
  const cached = PRESENCE_DIGIT_CACHE.get(k);
  if (cached) return cached;
  const d = await presenceClaimDigit({ beach, agent_id: agentId });
  PRESENCE_DIGIT_CACHE.set(k, d);
  return d;
}

// A presence heartbeat is a structured mark whose underscore matches the
// canonical "<agent_id> @ <ts> — present at <addr>" form. Marks that share
// the three required tag fields (1=agent, 2=address, 3=timestamp) but carry
// substantive user-typed text in the underscore are NOT presence — they're
// the user's contribution and belong in the solid stream.
const PRESENCE_RE = /^\S+ @ \S+ — present at /;
function isPresenceMark(node: PscaleNode): boolean {
  if (typeof node !== 'object' || node === null) return false;
  const obj = node as Record<string, PscaleNode>;
  if (typeof obj['1'] !== 'string' || typeof obj['2'] !== 'string' || typeof obj['3'] !== 'string') return false;
  return typeof obj._ === 'string' && PRESENCE_RE.test(obj._ as string);
}

function readMarks(rawBlock: PscaleNode | null, addressFilter: string): MarkRow[] {
  if (typeof rawBlock !== 'object' || rawBlock === null) return [];
  const block = rawBlock as Record<string, PscaleNode>;
  const marksNode = block['1'];
  if (typeof marksNode !== 'object' || marksNode === null) return [];
  const marks = marksNode as Record<string, PscaleNode>;
  const out: MarkRow[] = [];
  for (let d = 1; d <= 9; d++) {
    const k = String(d);
    const m = marks[k];
    if (m === undefined) continue;
    if (typeof m === 'string') {
      if (!m) continue;
      out.push({ digit: k, agent_id: null, address: null, timestamp: null, text: m, face: null, is_presence: false });
      continue;
    }
    if (typeof m === 'object' && m !== null) {
      const obj = m as Record<string, PscaleNode>;
      const aid = typeof obj['1'] === 'string' ? (obj['1'] as string) : null;
      const addr = typeof obj['2'] === 'string' ? (obj['2'] as string) : null;
      const ts = typeof obj['3'] === 'string' ? (obj['3'] as string) : null;
      const face = asFace(obj['4']);
      const text = typeof obj._ === 'string' ? (obj._ as string) : '(structured mark)';
      const presence = isPresenceMark(m);
      // Filter: keep marks whose address starts with the requested prefix
      // (or marks with no address at all, treated as beach-root).
      if (addressFilter && addr && !addr.startsWith(addressFilter)) continue;
      out.push({ digit: k, agent_id: aid, address: addr, timestamp: ts, text, face, is_presence: presence });
    }
  }
  return out;
}

// Read the pool sub-block at beach:2.<poolDigit> from the whole-beach raw.
// Same payload the marks read pulls — no extra substrate call needed.
// Returns null if the pool slot isn't present (user has navigated to a
// digit that hasn't been opened yet); the surface treats that as "empty
// pool" and shows just the address.
function readPool(rawBlock: PscaleNode | null, poolDigit: string): PoolView | null {
  if (typeof rawBlock !== 'object' || rawBlock === null) return null;
  const block = rawBlock as Record<string, PscaleNode>;
  const poolsNode = block['2'];
  if (typeof poolsNode !== 'object' || poolsNode === null) return null;
  const pool = (poolsNode as Record<string, PscaleNode>)[poolDigit];
  if (typeof pool !== 'object' || pool === null) return null;
  const po = pool as Record<string, PscaleNode>;
  const purpose = typeof po._ === 'string' ? (po._ as string) : '';
  let synthesis = '';
  let envelope: string | null = null;
  const synthNode = po._synthesis;
  if (typeof synthNode === 'object' && synthNode !== null) {
    const sn = synthNode as Record<string, PscaleNode>;
    if (typeof sn._ === 'string') synthesis = sn._ as string;
    if (typeof sn._envelope === 'string') envelope = sn._envelope as string;
  }
  const contributions: PoolContribution[] = [];
  for (let d = 1; d <= 9; d++) {
    const k = String(d);
    const c = po[k];
    if (c === undefined) continue;
    if (typeof c === 'string') {
      if (!c) continue;
      contributions.push({ digit: k, agent_id: null, text: c, timestamp: null, face: null });
      continue;
    }
    if (typeof c === 'object' && c !== null) {
      const co = c as Record<string, PscaleNode>;
      const aid = typeof co['1'] === 'string' ? (co['1'] as string) : null;
      const ts = typeof co['3'] === 'string' ? (co['3'] as string) : null;
      const face = asFace(co['4']);
      const text = typeof co._ === 'string' ? (co._ as string) : '(structured)';
      contributions.push({ digit: k, agent_id: aid, text, timestamp: ts, face });
    }
  }
  return { pool_digit: poolDigit, purpose, synthesis, synthesis_envelope: envelope, contributions };
}

/** Project the beach-root shared-liquid ring at beach:3 from the same raw
 * payload the marks/pool reads use. Filters by address prefix and staleness
 * so peers who have moved to another address or gone idle drop out. */
function readLiquid(
  rawBlock: PscaleNode | null,
  addressFilter: string,
  selfAgentId: string,
  now: number,
): LiquidPeer[] {
  if (typeof rawBlock !== 'object' || rawBlock === null) return [];
  const block = rawBlock as Record<string, PscaleNode>;
  const ringNode = block['3'];
  if (typeof ringNode !== 'object' || ringNode === null) return [];
  const ring = ringNode as Record<string, PscaleNode>;
  const out: LiquidPeer[] = [];
  for (let d = 1; d <= 9; d++) {
    const k = String(d);
    const slot = ring[k];
    if (typeof slot !== 'object' || slot === null) continue;
    const o = slot as Record<string, PscaleNode>;
    const text = typeof o._ === 'string' ? (o._ as string) : '';
    if (!text.trim()) continue; // empty slot — committed/cleared
    const aid = typeof o['1'] === 'string' ? (o['1'] as string) : null;
    const addr = typeof o['2'] === 'string' ? (o['2'] as string) : null;
    const ts = typeof o['3'] === 'string' ? (o['3'] as string) : null;
    const face = asFace(o['4']);
    if (addressFilter && addr && !addr.startsWith(addressFilter)) continue;
    if (ts) {
      const age = now - Date.parse(ts);
      if (Number.isFinite(age) && age > LIQUID_STALENESS_MS) continue;
    }
    out.push({
      digit: k, agent_id: aid, address: addr, timestamp: ts,
      text, face, is_self: !!aid && aid === selfAgentId,
    });
  }
  return out;
}

function readFrame(rawBlock: PscaleNode | null): FrameView | null {
  if (typeof rawBlock !== 'object' || rawBlock === null) return null;
  const block = rawBlock as Record<string, PscaleNode>;
  const sceneU = typeof block._ === 'string' ? (block._ as string) : '';
  const synthNode = block._synthesis;
  let synthesis = '';
  let envelope: string | null = null;
  if (typeof synthNode === 'object' && synthNode !== null) {
    const sn = synthNode as Record<string, PscaleNode>;
    if (typeof sn._ === 'string') synthesis = sn._ as string;
    if (typeof sn._envelope === 'string') envelope = sn._envelope as string;
  }
  const entities: FrameEntity[] = [];
  for (let d = 1; d <= 9; d++) {
    const k = String(d);
    const e = block[k];
    if (typeof e !== 'object' || e === null) continue;
    const eo = e as Record<string, PscaleNode>;
    const u = typeof eo._ === 'string' ? (eo._ as string) : '';
    const liquid = typeof eo['1'] === 'string' ? (eo['1'] as string) : '';
    const solid = typeof eo['2'] === 'string' ? (eo['2'] as string) : '';
    if (!u && !liquid && !solid) continue;
    entities.push({ position: k, underscore: u, liquid, solid });
  }
  return { scene_underscore: sceneU, synthesis, synthesis_envelope: envelope, entities };
}

export class BeachKernel {
  session: BeachSession;
  private cb: BeachKernelCallbacks;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private cycling = false;
  private running = false;

  // Watched beaches — the inbox-replacement layer. Scanned at a slower
  // cadence than current_beach (every nth cycle). A mark is "for me" if
  // its underscore mentions the user's agent_id (cold-contact convention).
  private watchedBeaches: string[] = [];
  private cycleN = 0;
  private static WATCH_EVERY_N_CYCLES = 5;       // 5 × 4s = 20s

  constructor(session: BeachSession, callbacks: BeachKernelCallbacks) {
    this.session = session;
    this.cb = callbacks;
  }

  /** Update the watched-beach list; next watch tick uses these. */
  setWatchedBeaches(beaches: string[]): void {
    this.watchedBeaches = beaches.filter(b => !!b && b !== this.session.current_beach);
  }

  start(pollMs: number = DEFAULT_POLL_MS): void {
    if (this.running) return;
    this.running = true;
    this.cb.onLog(`🌊 Beach kernel started — beach=${this.session.current_beach} address=${this.session.current_address || '(root)'}`);
    // Run one cycle immediately so the first paint isn't empty.
    this.cycle();
    this.intervalId = setInterval(() => this.cycle(), pollMs);
  }

  stop(): void {
    if (this.intervalId) clearInterval(this.intervalId);
    this.intervalId = null;
    this.running = false;
    this.cb.onLog(`🛑 Beach kernel stopped`);
  }

  /** Update the address; next cycle will re-read marks/presence. Also
   * derives current_pool — when the address points into beach:2.<digit>,
   * the surface flips to pool mode (Solid shows pool contributions, dropMark
   * writes to the pool ring instead of the marks ring). */
  setAddress(addr: string): void {
    this.session.current_address = addr;
    this.session.current_pool = poolFromAddress(addr);
  }

  /** Update the beach — next cycle re-targets. */
  setBeach(beach: string): void {
    this.session.current_beach = beach;
  }

  /** Update the active face — tagged into structured marks (position 4) so
   * the trace carries which operational mode each contribution was made
   * from. v0.1: not enforced by substrate. */
  setFace(face: Face): void {
    this.session.face = face;
  }

  /** Enter / leave a frame. */
  setFrame(frame: string | null, position: string | null = null): void {
    this.session.current_frame = frame;
    this.session.entity_position = position;
  }

  /** Drop a free-form mark or pool contribution. Tier-1, no LLM.
   *
   * Branching: when current_pool is set (current_address starts `2.<digit>`),
   * the write lands at beach:2.<pool>.<next-free> as a pool contribution.
   * Otherwise it lands at beach:1.<next-free> as a beach mark. Both shapes
   * are structured marks ({_, 1=agent, 2=address, 3=ts}) — pool contributions
   * are marks at a different ring, not a different shape. */
  async dropMark(text: string): Promise<{ ok: boolean; error?: string }> {
    if (!text.trim()) return { ok: false, error: 'empty' };
    const beach = this.session.current_beach;
    const ts = new Date().toISOString();
    const pool = this.session.current_pool;

    // Read the beach block once; the existing pattern uses raw to walk the
    // ring, so we can reach either marks (root.1) or pool (root.2.<pool>)
    // off the same payload.
    const r = await bsp({ agent_id: beach, block: 'beach', spindle: '1' });
    const root = (r.ok && 'raw' in r && typeof r.raw === 'object' && r.raw !== null)
      ? r.raw as Record<string, PscaleNode>
      : null;

    let ring: Record<string, PscaleNode> | null = null;
    if (root) {
      if (pool) {
        const poolsNode = root['2'];
        if (typeof poolsNode === 'object' && poolsNode !== null) {
          const pn = (poolsNode as Record<string, PscaleNode>)[pool];
          if (typeof pn === 'object' && pn !== null) ring = pn as Record<string, PscaleNode>;
        }
      } else {
        const m = root['1'];
        if (typeof m === 'object' && m !== null) ring = m as Record<string, PscaleNode>;
      }
    }

    let nextDigit = '1';
    if (ring) {
      for (let d = 1; d <= 9; d++) {
        if (!(String(d) in ring)) { nextDigit = String(d); break; }
        if (d === 9) nextDigit = '9'; // overflow — overwrite last
      }
    }

    const spindle = pool ? `2.${pool}.${nextDigit}` : `1.${nextDigit}`;
    const result = await bsp({
      agent_id: beach,
      block: 'beach',
      spindle,
      content: {
        _: text,
        '1': this.session.agent_id || '(anon)',
        '2': this.session.current_address,
        '3': ts,
        '4': this.session.face,
      },
    });
    if (result.ok) {
      this.cb.onLog(`${pool ? '🌀' : '📍'} ${pool ? 'pool contribution' : 'mark'} written at ${beach}:${spindle}`);
      // Trigger an immediate read to refresh the panel
      this.cycle();
    } else {
      const err = 'error' in result ? result.error : 'unknown';
      this.cb.onError(`${pool ? 'contribution' : 'mark'} write failed: ${err ?? 'unknown'}`);
    }
    return result.ok ? { ok: true } : { ok: false, error: 'error' in result ? result.error : 'unknown' };
  }

  /** Write the user's vapor as liquid into the current frame at entity_position.1. */
  async commitLiquid(text: string): Promise<{ ok: boolean; error?: string }> {
    if (!this.session.current_frame || !this.session.entity_position) {
      return { ok: false, error: 'no active frame' };
    }
    const result = await bsp({
      agent_id: this.session.current_beach,
      block: this.session.current_frame,
      spindle: this.session.entity_position + '.1',
      content: text,
    });
    if (result.ok) {
      this.session.liquid_pending = text;
      this.cb.onLog(`💧 liquid committed — ${text.slice(0, 60)}`);
      this.cycle();
    } else {
      this.cb.onError(`liquid write failed: ${'error' in result ? result.error : 'unknown'}`);
    }
    return result.ok ? { ok: true } : { ok: false, error: 'error' in result ? result.error : 'unknown' };
  }

  /** Write the user's current liquid into the beach-root shared layer at
   * beach:3.<presence-digit>. Overwrites the same slot each call (the user's
   * liquid is always one current state, not an append). Empty text clears
   * the slot — used after commit so the liquid stops rendering for peers. */
  async writeBeachLiquid(text: string): Promise<{ ok: boolean; error?: string }> {
    const beach = this.session.current_beach;
    const aid = this.session.agent_id || '(anon)';
    const digit = await getPresenceDigit(beach, aid);
    const ts = new Date().toISOString();
    const result = await bsp({
      agent_id: beach,
      block: 'beach',
      spindle: '3.' + digit,
      content: {
        _: text,
        '1': aid,
        '2': this.session.current_address,
        '3': ts,
        '4': this.session.face,
      },
    });
    if (!result.ok) {
      this.cb.onError(`liquid write failed: ${'error' in result ? result.error : 'unknown'}`);
      return { ok: false, error: 'error' in result ? result.error : 'unknown' };
    }
    this.cb.onLog(text.trim() ? `💧 liquid → beach:3.${digit}` : `💧 liquid cleared (beach:3.${digit})`);
    this.cycle();
    return { ok: true };
  }

  /** Clear our slot in beach:3 — used after commit so peers stop seeing the
   * liquid we just promoted to solid. */
  async clearMyBeachLiquid(): Promise<{ ok: boolean; error?: string }> {
    return this.writeBeachLiquid('');
  }

  private async cycle(): Promise<void> {
    if (!this.running || this.cycling) return;
    this.cycling = true;
    try {
      const beach = this.session.current_beach;
      const address = this.session.current_address;
      const aid = this.session.agent_id || '(anon)';

      // 1. Heartbeat presence (only if we have a non-anonymous agent_id)
      if (this.session.agent_id) {
        const digit = await getPresenceDigit(beach, aid);
        await presenceHeartbeat({
          beach, digit, agent_id: aid, address,
          summary: `${aid} @ ${new Date().toISOString()} — present at ${address || '/'}`,
        });
      }

      // 2. Presence read
      const { present } = await presenceRead({ beach, address });
      this.cb.onPresence(present);

      // 3. Marks read (beachcombing + non-presence marks at this address).
      //    Same raw response feeds the pool view below — no extra call.
      const ringResult = await bsp({ agent_id: beach, block: 'beach', spindle: '1' });
      const ringRaw = ringResult.ok && 'raw' in ringResult ? ringResult.raw : null;
      const marks = readMarks(ringRaw, address);
      this.cb.onMarks(marks);

      // 3b. Beach-root shared liquid (beach:3). Same raw payload — no extra
      //     network call. Address-filtered and staled at 60s.
      const liquidPeers = readLiquid(ringRaw, address, aid, Date.now());
      this.cb.onLiquid(liquidPeers);

      // 4. Pool read — when current_pool is set, project beach:2.<pool> from
      //    the same raw the marks read pulled. The substrate determines the
      //    surface: navigate to 2.<digit> and Solid flips to pool view.
      if (this.session.current_pool) {
        this.cb.onPool(readPool(ringRaw, this.session.current_pool));
      } else {
        this.cb.onPool(null);
      }

      // 5. Frame read (when in a frame)
      if (this.session.current_frame) {
        const frameResult = await bsp({
          agent_id: beach,
          block: this.session.current_frame,
        });
        const frameRaw = frameResult.ok && 'raw' in frameResult ? frameResult.raw : null;
        this.cb.onFrame(readFrame(frameRaw));
      } else {
        this.cb.onFrame(null);
      }

      // 6. Watched-beach inbox scan — every Nth cycle.
      this.cycleN++;
      if (this.session.agent_id && this.cycleN % BeachKernel.WATCH_EVERY_N_CYCLES === 0 && this.watchedBeaches.length > 0) {
        await this.scanInbox();
      }
    } catch (e) {
      this.cb.onError(e instanceof Error ? e.message : String(e));
    } finally {
      this.cycling = false;
    }
  }

  /** Scan watched beaches for marks tagged for this agent. */
  private async scanInbox(): Promise<void> {
    const me = this.session.agent_id;
    if (!me) return;
    const items: InboxItem[] = [];
    // Tag conventions a mark uses to address us: bare handle, @handle,
    // qualified <handle>:..., or our beach URL prefix.
    const needles = [me, '@' + me];
    for (const watchedBeach of this.watchedBeaches) {
      try {
        const r = await bsp({ agent_id: watchedBeach, block: 'beach', spindle: '1' });
        if (!r.ok || !('raw' in r) || !r.raw) continue;
        const rows = readMarks(r.raw, '');
        for (const row of rows) {
          if (row.is_presence) continue;
          if (row.agent_id === me) continue; // skip our own marks
          const blob = (row.text || '') + ' ' + (row.address || '');
          if (!needles.some(n => blob.includes(n))) continue;
          items.push({
            beach: watchedBeach,
            digit: row.digit,
            agent_id: row.agent_id,
            address: row.address,
            timestamp: row.timestamp,
            text: row.text,
          });
        }
      } catch {
        // skip this beach this tick
      }
    }
    // Sort newest first.
    items.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
    this.cb.onInbox(items);
  }
}
