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
  supernestSlots,
  readSlot,
  type PresenceMark,
  type BspReadResult,
  type PscaleNode,
} from '../lib/bsp-client';
import { poolFromAddress } from './beach-session';
import type { BeachSession, MarkRow, FrameView, FrameEntity, PoolView, PoolContribution, LiquidPeer, Face } from './beach-session';
import { extractBeachSettings, resolveSetting, SETTINGS, type SettingsBlock } from './settings-reader';

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
  /** Beach-level settings sub-block (beach:5). Updated each cycle from the
   * existing per-cycle beach read — no extra substrate calls. Phase A: only
   * per-beach settings; Phase B will add per-user (shell) and per-rendezvous. */
  onSettings: (settings: SettingsBlock) => void;
  onError: (err: string) => void;
  onLog: (msg: string) => void;
}


// 1.5s — keeps the substrate echo within UI-feel time so "submit liquid →
// button morphs to commit●" round-trips fast enough that no local self-pending
// state is needed. Federated beach reads are cheap and the staleness windows
// (30s presence, 60s liquid) absorb the higher cadence comfortably.
const DEFAULT_POLL_MS = 1500;
// Built-in defaults for the substrate-resolvable staleness/cadence settings.
// The kernel reads these via getSetting(SETTINGS.<key>, <default>); when no
// per-user (shell:5) or per-beach (beach:5) value exists, these are used.
// Phase A/B introduced the references but not the constants — the cycle
// throws ReferenceError on every tick under strict-off tsconfig, killing
// presence/marks/liquid projection downstream of the heartbeat write.
const DEFAULT_PRESENCE_STALENESS_MS = 30_000;
const DEFAULT_LIQUID_STALENESS_MS = 60_000;
const DEFAULT_INBOX_WATCH_EVERY_N_CYCLES = 5;
const PRESENCE_DIGIT_CACHE = new Map<string, string>();

async function getPresenceDigit(beach: string, agentId: string): Promise<string> {
  const k = `${beach}::${agentId}`;
  const cached = PRESENCE_DIGIT_CACHE.get(k);
  if (cached) return cached;
  const d = await presenceClaimDigit({ beach, agent_id: agentId });
  PRESENCE_DIGIT_CACHE.set(k, d);
  return d;
}

// Presence vs substantive: per pscale__block-conventions:9.2, presence is the
// "absence of field 4" sub-shape. A presence mark carries the three required
// tag fields (1=agent, 2=address, 3=timestamp) and an optional human-readable
// underscore, but no field 4. Substantive marks carry field 4 (face or body).
// One block, one shape, one discriminator.
function isPresenceMark(node: PscaleNode): boolean {
  if (typeof node !== 'object' || node === null) return false;
  const obj = node as Record<string, PscaleNode>;
  if (typeof obj['1'] !== 'string' || typeof obj['2'] !== 'string' || typeof obj['3'] !== 'string') return false;
  return obj['4'] === undefined;
}

// Supernest write-slot finder for the marks block. Per pscale__block-conventions:9.3:
// writers pick the next free positive integer composed of digits 1-9 (no zeros);
// the bsp walker interprets the integer hierarchically (slot 11 → [1][1], slot
// 234 → [2][3][4]). After slot 9 the next slot is 11 (10 is the underscore-summary
// position and stays empty). A slot is free when it's absent, empty-string, or an
// object with no underscore content. Falls back to '9' if 819 slots are exhausted
// (vanishingly unlikely; tide cleanup handles long-term accumulation).
function findNextMarkSpindle(marksBlock: PscaleNode | null): string {
  for (const slot of supernestSlots()) {
    const m = readSlot(marksBlock, slot);
    if (m === null) return slot; // absent
    if (typeof m === 'string') {
      if (!m.trim()) return slot; // empty leaf
      continue;
    }
    if (typeof m === 'object') {
      const u = (m as Record<string, PscaleNode>)._;
      if (typeof u !== 'string' || !u.trim()) return slot; // empty
    }
  }
  return '9';
}

// Tide config — from beach:9.1.1.{1,2,3} (anonymous / handle / signed wipe
// seconds). Client-side soft-wipe filter; the actual substrate deletion
// is the beach owner's concern (out of client scope). When the substrate
// has no tide config, marks live indefinitely.
interface TideConfig {
  anonymous_secs: number | null;
  handle_secs: number | null;
  signed_secs: number | null;
}

function readTideConfig(rawBlock: PscaleNode | null): TideConfig {
  const empty: TideConfig = { anonymous_secs: null, handle_secs: null, signed_secs: null };
  if (typeof rawBlock !== 'object' || rawBlock === null) return empty;
  const meta = (rawBlock as Record<string, PscaleNode>)['9'];
  if (typeof meta !== 'object' || meta === null) return empty;
  const tides = (meta as Record<string, PscaleNode>)['1'];
  if (typeof tides !== 'object' || tides === null) return empty;
  const wipe = (tides as Record<string, PscaleNode>)['1'];
  if (typeof wipe !== 'object' || wipe === null) return empty;
  const wipeObj = wipe as Record<string, PscaleNode>;
  const readSecs = (key: string): number | null => {
    const node = wipeObj[key];
    if (typeof node === 'number') return node;
    if (typeof node === 'object' && node !== null) {
      const inner = (node as Record<string, PscaleNode>)['1'];
      if (typeof inner === 'number') return inner;
      const u = (node as Record<string, PscaleNode>)._;
      if (typeof u === 'number') return u;
    }
    return null;
  };
  return { anonymous_secs: readSecs('1'), handle_secs: readSecs('2'), signed_secs: readSecs('3') };
}

function markIsTideWiped(row: MarkRow, tide: TideConfig, hasSignature: boolean): boolean {
  if (!row.timestamp) return false;
  const ageMs = Date.now() - Date.parse(row.timestamp);
  if (Number.isNaN(ageMs)) return false;
  let limitSecs: number | null = null;
  if (!row.agent_id || row.agent_id === '(anon)' || row.agent_id.startsWith('anon-')) {
    limitSecs = tide.anonymous_secs;
  } else if (hasSignature) {
    limitSecs = tide.signed_secs;
  } else {
    limitSecs = tide.handle_secs;
  }
  return limitSecs !== null && ageMs > limitSecs * 1000;
}

// Read marks from the marks block (per pscale__block-conventions:9). Recursive
// supernest walk through digits 1-9 at every level. Tag fields live at digit
// positions {1: agent_id, 2: address, 3: ts, 4: face/body} for new canonical
// marks; legacy entries use underscore-prefixed keys (_a/_addr/_t/_f) and are
// read for backward-compat during the transition. Presence (absence-of-4) is
// flagged via is_presence and filtered out by callers (solid stream, etc.).
// Soft-wipe by tide config (passed in by caller — read from beach:9). Sorted
// newest-first by timestamp.
function readMarks(marksBlock: PscaleNode | null, addressFilter: string, tide: TideConfig): MarkRow[] {
  if (typeof marksBlock !== 'object' || marksBlock === null) return [];
  const out: MarkRow[] = [];
  walkMarkTree(marksBlock as Record<string, PscaleNode>, '', addressFilter, tide, out);
  out.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
  return out;
}

function walkMarkTree(
  node: Record<string, PscaleNode>,
  digitPath: string,
  addressFilter: string,
  tide: TideConfig,
  out: MarkRow[],
): void {
  // Read THIS node as a potential leaf mark — tag fields at digit positions 1-4
  // (new canonical) with underscore-prefixed fallback (_a/_addr/_t/_f) for legacy.
  // The typeof check disambiguates leaf-vs-parent: at a leaf, fields 1-4 are
  // strings; at a parent, position 1-9 are sub-mark objects.
  const aid = typeof node['1'] === 'string' ? (node['1'] as string)
            : typeof node._a === 'string' ? (node._a as string) : null;
  const addr = typeof node['2'] === 'string' ? (node['2'] as string)
             : typeof node._addr === 'string' ? (node._addr as string) : null;
  const ts = typeof node['3'] === 'string' ? (node['3'] as string)
           : typeof node._t === 'string' ? (node._t as string) : null;
  const face = asFace(node['4']) ?? asFace(node._f);
  const text = typeof node._ === 'string' ? (node._ as string) : '';
  if (text && digitPath) { // root node has no path; skip emitting it as a mark
    const passesAddress = !addressFilter || !addr || addr.startsWith(addressFilter);
    if (passesAddress) {
      const presence = isPresenceMark(node);
      const row: MarkRow = { digit: digitPath, agent_id: aid, address: addr, timestamp: ts, text, face, is_presence: presence };
      const hasSig = !!aid && aid !== '(anon)' && !aid.startsWith('anon-');
      if (!markIsTideWiped(row, tide, hasSig)) out.push(row);
    }
  }
  // Recurse into supernest children — only object children at digit positions.
  for (let d = 1; d <= 9; d++) {
    const k = String(d);
    const child = node[k];
    if (typeof child === 'object' && child !== null) {
      const path = digitPath ? `${digitPath}.${k}` : k;
      walkMarkTree(child as Record<string, PscaleNode>, path, addressFilter, tide, out);
    }
  }
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

/** Detect whether a node is a structured liquid/mark slot (has the canonical
 * {_, 1, 2, 3} shape). Used to recognise leaf slots while walking the
 * address-rooted liquid tree at any depth. */
function isLiquidSlot(node: PscaleNode): node is Record<string, PscaleNode> {
  if (typeof node !== 'object' || node === null) return false;
  const o = node as Record<string, PscaleNode>;
  return typeof o._ === 'string'
    && typeof o['1'] === 'string'
    && typeof o['2'] === 'string'
    && typeof o['3'] === 'string';
}

/** Walk a sub-tree collecting every liquid-slot we encounter. Recurses into
 * digit children only (numeric keys 1–9); never crosses into named child
 * directories. Slots themselves are NOT recursed into — their content is
 * terminal. */
function collectLiquidSlots(node: PscaleNode, out: Array<{ digit: string; slot: Record<string, PscaleNode> }>): void {
  if (typeof node !== 'object' || node === null) return;
  const obj = node as Record<string, PscaleNode>;
  for (const k of Object.keys(obj)) {
    if (!/^[1-9]$/.test(k)) continue;
    const child = obj[k];
    if (isLiquidSlot(child)) {
      out.push({ digit: k, slot: child as Record<string, PscaleNode> });
    } else if (typeof child === 'object' && child !== null) {
      collectLiquidSlots(child, out);
    }
  }
}

/** Project location-keyed liquid (beach:7.<address>.<digit>) — the ephemeral
 * coordination ring sharded by address. Each present agent occupies one
 * <digit> slot under their current_address. Visibility is address-prefix:
 * a viewer at address X sees every slot whose stored address starts with X
 * (so a root viewer sees everyone; a deep viewer sees only their region).
 * The 60s staleness filter drops idle peers. */
function readLiquid(
  rawBlock: PscaleNode | null,
  addressFilter: string,
  selfAgentId: string,
  now: number,
  stalenessMs: number,
): LiquidPeer[] {
  if (typeof rawBlock !== 'object' || rawBlock === null) return [];
  const block = rawBlock as Record<string, PscaleNode>;
  const root = block['7'];
  if (typeof root !== 'object' || root === null) return [];
  const slots: Array<{ digit: string; slot: Record<string, PscaleNode> }> = [];
  collectLiquidSlots(root, slots);
  const out: LiquidPeer[] = [];
  for (const { digit, slot } of slots) {
    const text = typeof slot._ === 'string' ? (slot._ as string) : '';
    if (!text.trim()) continue; // empty slot — committed/cleared
    const aid = typeof slot['1'] === 'string' ? (slot['1'] as string) : null;
    const addr = typeof slot['2'] === 'string' ? (slot['2'] as string) : null;
    const ts = typeof slot['3'] === 'string' ? (slot['3'] as string) : null;
    const face = asFace(slot['4']);
    if (addressFilter && addr && !addr.startsWith(addressFilter)) continue;
    if (ts) {
      const age = now - Date.parse(ts);
      if (Number.isFinite(age) && age > stalenessMs) continue;
    }
    out.push({
      digit, agent_id: aid, address: addr, timestamp: ts,
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

  // Cached settings for substrate-as-program resolution. Updated each cycle
  // from beach:5 (synchronously, from the existing beach read) and on each
  // identity change from shell:5 (via setUserSettings). Read internally via
  // getSetting which walks user → beach → built-in default.
  private cachedBeachSettings: SettingsBlock = null;
  private cachedUserSettings: SettingsBlock = null;

  constructor(session: BeachSession, callbacks: BeachKernelCallbacks) {
    this.session = session;
    this.cb = callbacks;
  }

  /** Plug in the user's settings sub-block (shell:5). Caller invokes when the
   * shell loads (App.tsx) and on identity change. Phase B: per-user settings. */
  setUserSettings(settings: SettingsBlock): void {
    this.cachedUserSettings = settings;
  }

  private getSetting<T>(spindle: string, defaultValue: T): T {
    return resolveSetting(
      { beach_settings: this.cachedBeachSettings, user_settings: this.cachedUserSettings },
      spindle,
      defaultValue,
    );
  }

  /** Update the watched-beach list; next watch tick uses these. */
  setWatchedBeaches(beaches: string[]): void {
    this.watchedBeaches = beaches.filter(b => !!b && b !== this.session.current_beach);
  }

  // Focus-gated polling cadence (v0.3 polling-disarm). Focused columns pull
  // liquid/marks/etc. at DEFAULT_POLL_MS (1.5s — live-reader). Unfocused
  // columns drop to BACKGROUND_POLL_MS (30s — heartbeat-only effectively;
  // the cycle still runs so presence stays fresh and vapour remains
  // subscribed, but substrate reads slow to a trickle). Vapour subscription
  // itself lives outside the kernel and stays alive whenever the column is
  // open — see Column.tsx joinVapourChannel.
  private isFocused: boolean = true;
  private pollMsFocused: number = DEFAULT_POLL_MS;

  start(pollMs: number = DEFAULT_POLL_MS): void {
    if (this.running) return;
    this.running = true;
    this.pollMsFocused = pollMs;
    this.cb.onLog(`🌊 Beach kernel started — beach=${this.session.current_beach} address=${this.session.current_address || '(root)'}`);
    // Run one cycle immediately so the first paint isn't empty.
    this.cycle();
    this.intervalId = setInterval(() => this.cycle(), this.currentInterval());
  }

  stop(): void {
    if (this.intervalId) clearInterval(this.intervalId);
    this.intervalId = null;
    this.running = false;
    this.cb.onLog(`🛑 Beach kernel stopped`);
  }

  /** Focus-gate the polling cadence. Focused: DEFAULT_POLL_MS (1.5s).
   * Unfocused: 30s — keeps presence heartbeating without thrashing the
   * substrate for unfocused columns. v0.3 polling-disarm — see
   * docs/DESIGN-CHANNELS.md § "Triggers — everything is attention-driven". */
  setFocused(focused: boolean): void {
    if (this.isFocused === focused) return;
    this.isFocused = focused;
    if (!this.running) return;
    if (this.intervalId) clearInterval(this.intervalId);
    this.intervalId = setInterval(() => this.cycle(), this.currentInterval());
    this.cb.onLog(`🌊 kernel cadence → ${focused ? 'focused (live)' : 'background (slow)'}`);
  }

  private currentInterval(): number {
    return this.isFocused ? this.pollMsFocused : 30000;
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

  /** Hand off from one agent_id to another — typically logout (handle →
   * anon-XXXXXX) or handle-switch. Writes empty to the previous agent_id's
   * presence digit and liquid slot at the current address so peers see the
   * old identity disappear immediately rather than waiting for the 30s
   * staleness window. The new identity will claim a fresh presence digit on
   * the next cycle naturally. Best-effort — failures are logged but never
   * block the handoff. */
  async releasePresence(prevAgentId: string): Promise<void> {
    if (!prevAgentId) return;
    const beach = this.session.current_beach;
    const address = this.session.current_address;
    try {
      const digit = await getPresenceDigit(beach, prevAgentId);
      const ts = new Date().toISOString();
      // Empty presence mark at the marks block — peers' read-side filter (staleness
      // + non-empty underscore) treats this as "departed" until the slot ages out.
      await bsp({
        agent_id: beach, block: 'marks', spindle: digit,
        content: { _: '', '1': prevAgentId, '2': address, '3': ts },
      });
      // Empty liquid slot at beach:7.<address>.<digit> so peers stop seeing
      // any in-flight liquid from the old identity.
      const liquidSpindle = address ? `7.${address}.${digit}` : `7.${digit}`;
      await bsp({
        agent_id: beach, block: 'beach', spindle: liquidSpindle,
        content: { _: '', '1': prevAgentId, '2': address, '3': ts },
      });
      // Drop the cached digit so any future heartbeats by the same id
      // re-claim cleanly rather than re-using the now-empty slot.
      PRESENCE_DIGIT_CACHE.delete(`${beach}::${prevAgentId}`);
      this.cb.onLog(`👋 released ${prevAgentId} presence at beach:1.${digit} and liquid:${liquidSpindle}`);
    } catch (e) {
      this.cb.onError(`presence release failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** Enter / leave a frame. */
  setFrame(frame: string | null, position: string | null = null): void {
    this.session.current_frame = frame;
    this.session.entity_position = position;
  }

  /** Drop a free-form mark or pool contribution. Tier-1, no LLM.
   *
   * Pool contributions land at beach:2.<pool>.<next-free> on the beach
   * block (9-slot ring; pools are bounded by design). Beach marks live in
   * a dedicated (beach, 'marks') block — super-nested at digits 1-9 of any
   * level; tagged metadata at underscore-prefixed keys (_a/_addr/_t/_f) so
   * positions 1-9 are pure sub-mark addresses. Marks accumulate; tide is
   * the only cleanup. */
  async dropMark(text: string): Promise<{ ok: boolean; error?: string }> {
    if (!text.trim()) return { ok: false, error: 'empty' };
    const beach = this.session.current_beach;
    const ts = new Date().toISOString();
    const pool = this.session.current_pool;

    let ring: Record<string, PscaleNode> | null = null;
    let root: Record<string, PscaleNode> | null = null;
    if (pool) {
      const r = await bsp({ agent_id: beach, block: 'beach', spindle: '2' });
      root = (r.ok && 'raw' in r && typeof r.raw === 'object' && r.raw !== null)
        ? r.raw as Record<string, PscaleNode>
        : null;
      if (root) {
        const poolsNode = root['2'];
        if (typeof poolsNode === 'object' && poolsNode !== null) {
          const pn = (poolsNode as Record<string, PscaleNode>)[pool];
          if (typeof pn === 'object' && pn !== null) ring = pn as Record<string, PscaleNode>;
        }
      }
    } else {
      const r = await bsp({ agent_id: beach, block: 'marks' });
      ring = (r.ok && 'raw' in r && typeof r.raw === 'object' && r.raw !== null)
        ? r.raw as Record<string, PscaleNode>
        : null;
    }

    // Pool contributions: 9-slot ring (bounded by design). Beach marks:
    // super-nest into the dedicated (beach, 'marks') block, accumulating
    // indefinitely. Tide is the only cleanup.
    let blockName: string;
    let spindle: string;
    let content: Record<string, PscaleNode>;
    if (pool && ring) {
      let nextDigit = '9';
      let bestFree: string | null = null;
      let bestEmpty: string | null = null;
      let oldestNonPresence: { digit: string; ts: string } | null = null;
      for (let d = 1; d <= 9; d++) {
        const dk = String(d);
        if (!(dk in ring)) { if (bestFree === null) bestFree = dk; continue; }
        const slot = ring[dk];
        const u = (typeof slot === 'object' && slot !== null) ? (slot as Record<string, PscaleNode>)._ : slot;
        if (typeof u !== 'string' || !u.trim()) { if (bestEmpty === null) bestEmpty = dk; continue; }
        if (typeof slot === 'object' && slot !== null && isPresenceMark(slot as PscaleNode)) continue;
        const ts2 = (typeof slot === 'object' && slot !== null) ? (slot as Record<string, PscaleNode>)['3'] : null;
        const tsStr = typeof ts2 === 'string' ? ts2 : '';
        if (!oldestNonPresence || tsStr < oldestNonPresence.ts) oldestNonPresence = { digit: dk, ts: tsStr };
      }
      nextDigit = bestFree ?? bestEmpty ?? oldestNonPresence?.digit ?? '9';
      if (!bestFree && !bestEmpty) {
        this.cb.onLog(`💧 pool ring full at beach:2.${pool} — overwriting digit ${nextDigit}`);
      }
      blockName = 'beach';
      spindle = `2.${pool}.${nextDigit}`;
      content = {
        _: text,
        '1': this.session.agent_id || '(anon)',
        '2': this.session.current_address,
        '3': ts,
        '4': this.session.face,
      };
    } else {
      blockName = 'marks';
      spindle = findNextMarkSpindle(ring);
      content = {
        _: text,
        '1': this.session.agent_id || '(anon)',
        '2': this.session.current_address,
        '3': ts,
        '4': this.session.face,
      };
    }

    const result = await bsp({
      agent_id: beach,
      block: blockName,
      spindle,
      content,
      secret: this.session.secret || undefined,
    });
    if (result.ok) {
      this.cb.onLog(`${pool ? '🌀' : '📍'} ${pool ? 'pool contribution' : 'mark'} written at ${beach}:${blockName}:${spindle}`);
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

  /** Write the user's current liquid at beach:7.<address>.<presence-digit> —
   * the location-keyed shared layer. Sharded by address: peers at the same
   * address share a 9-slot ring; peers elsewhere are out of scope. Overwrites
   * the same slot each call (one current state, not append). Empty text
   * clears the slot — used after commit so peers stop rendering it.
   *
   * Position 7 is unallocated by protocol-pscale-beach-v2 (1=marks, 2=pools,
   * 3=reaches, 8=conventions, 9=metadata), so this convention is xstream's
   * own without conflicting with the canonical beach shape. */
  async writeBeachLiquid(text: string): Promise<{ ok: boolean; error?: string }> {
    const beach = this.session.current_beach;
    const aid = this.session.agent_id || '(anon)';
    const digit = await getPresenceDigit(beach, aid);
    const address = this.session.current_address;
    const ts = new Date().toISOString();
    // Spindle: 7.<address-segments>.<digit> — root liquid is just 7.<digit>.
    const spindle = address ? `7.${address}.${digit}` : `7.${digit}`;
    const result = await bsp({
      agent_id: beach,
      block: 'beach',
      spindle,
      content: {
        _: text,
        '1': aid,
        '2': address,
        '3': ts,
        '4': this.session.face,
      },
      // Pass session secret when present so handle+passphrase users can
      // overwrite their own slot (federated beach may set a per-slot lock
      // on first write under a secret-bearing identity; subsequent writes
      // without it are rejected silently — exactly the bug observed for
      // the post-commit clearMyBeachLiquid path).
      secret: this.session.secret || undefined,
    });
    if (!result.ok) {
      this.cb.onError(`liquid write failed: ${'error' in result ? result.error : 'unknown'}`);
      return { ok: false, error: 'error' in result ? result.error : 'unknown' };
    }
    this.cb.onLog(text.trim() ? `💧 liquid → beach:${spindle}` : `💧 liquid cleared (beach:${spindle})`);
    this.cycle();
    return { ok: true };
  }

  /** Clear our slot — used after commit so peers stop seeing the liquid we
   * just promoted to a mark. */
  async clearMyBeachLiquid(): Promise<{ ok: boolean; error?: string }> {
    return this.writeBeachLiquid('');
  }

  /** Phase D collective clear — wipes every liquid slot at beach:7.<address>.
   * Used by recipes with `clear_policy: all` (brainstorm / collective absorbed
   * into solid). One write per occupied slot; missing slots are no-ops. The
   * liquid presence cache supplies the slot list, so this requires a recent
   * cycle's view (no extra read).
   *
   * NOTE: This is a polite-collision API — peers writing concurrently may have
   * their fresh liquid clobbered. Recipes that use `clear_all` accept that;
   * recipes that don't want it stay on the default `clear_self_only`. */
  async clearLiquidAtAddress(slots: Array<{ digit: string }>): Promise<{ ok: boolean; cleared: number; errors: number }> {
    const beach = this.session.current_beach;
    const address = this.session.current_address;
    let cleared = 0; let errors = 0;
    for (const { digit } of slots) {
      const spindle = address ? `7.${address}.${digit}` : `7.${digit}`;
      const r = await bsp({
        agent_id: beach,
        block: 'beach',
        spindle,
        content: { _: '', '1': '', '2': address, '3': new Date().toISOString(), '4': null },
        secret: this.session.secret || undefined,
      });
      if (r.ok) cleared++; else errors++;
    }
    if (cleared > 0) this.cb.onLog(`💧 cleared ${cleared} liquid slot(s) at beach:7.${address || ''}`);
    if (errors > 0) this.cb.onError(`liquid clear had ${errors} error(s)`);
    return { ok: errors === 0, cleared, errors };
  }

  private async cycle(): Promise<void> {
    if (!this.running || this.cycling) return;
    this.cycling = true;
    try {
      const beach = this.session.current_beach;
      const address = this.session.current_address;
      const aid = this.session.agent_id || '(anon)';

      // 1. Heartbeat presence. Anonymous tabs heartbeat too (using their
      //    anon-XXXXXX pseudo-handle) so peers see them as live participants.
      if (this.session.agent_id) {
        const digit = await getPresenceDigit(beach, aid);
        await presenceHeartbeat({
          beach, digit, agent_id: aid, address,
          summary: `${aid} @ ${new Date().toISOString()} — present at ${address || '/'}`,
        });
      }

      // 2. Presence read — staleness resolved from settings (beach:5 / shell:5)
      const presenceStaleness = this.getSetting(SETTINGS.PRESENCE_STALENESS, DEFAULT_PRESENCE_STALENESS_MS);
      const { present } = await presenceRead({ beach, address, stalenessMs: presenceStaleness });
      this.cb.onPresence(present);

      // 3. Marks read from the dedicated (beach, 'marks') block. Tide
      //    config from beach:9 drives soft-wipe filtering. Separate from
      //    the beach block read which carries pools / liquid / settings.
      const ringResult = await bsp({ agent_id: beach, block: 'beach', spindle: '1' });
      const ringRaw = ringResult.ok && 'raw' in ringResult ? ringResult.raw : null;
      const tide = readTideConfig(ringRaw);
      const marksResult = await bsp({ agent_id: beach, block: 'marks' });
      const marksRaw = marksResult.ok && 'raw' in marksResult ? marksResult.raw : null;
      const marks = readMarks(marksRaw, address, tide);
      this.cb.onMarks(marks);

      // 3b. Location-keyed shared liquid (beach:7.<address>.<digit>). Same
      //     raw payload — position 7 is part of the beach block. Address-
      //     prefix filtered (so a viewer at root sees every slot, a viewer
      //     at 5.3 sees slots at 5.3.* etc.) and staled per setting.
      const liquidStaleness = this.getSetting(SETTINGS.LIQUID_STALENESS, DEFAULT_LIQUID_STALENESS_MS);
      const liquidPeers = readLiquid(ringRaw, address, aid, Date.now(), liquidStaleness);
      this.cb.onLiquid(liquidPeers);

      // 3c. xstream client settings (beach:5). Same raw payload — extracted
      //     synchronously, no extra call. Cache locally for kernel use, AND
      //     surface to the column for component-side resolveSetting calls.
      const beachSettings = extractBeachSettings(ringRaw);
      this.cachedBeachSettings = beachSettings;
      this.cb.onSettings(beachSettings);

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

      // 6. Watched-beach inbox scan — every Nth cycle (resolved from settings).
      //    Anonymous tabs skip the scan: there's no durable handle for marks
      //    to be tagged "for me" against, and the anon-XXXXXX pseudo isn't
      //    communicated to other agents who'd need it to direct messages.
      this.cycleN++;
      const watchEveryN = this.getSetting(SETTINGS.INBOX_WATCH_EVERY, DEFAULT_INBOX_WATCH_EVERY_N_CYCLES);
      if (!this.session.is_anonymous && this.session.agent_id && this.cycleN % watchEveryN === 0 && this.watchedBeaches.length > 0) {
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
        const beachRead = await bsp({ agent_id: watchedBeach, block: 'beach', spindle: '1' });
        const beachRaw = beachRead.ok && 'raw' in beachRead ? beachRead.raw : null;
        const tideForWatched = readTideConfig(beachRaw);
        const r = await bsp({ agent_id: watchedBeach, block: 'marks' });
        if (!r.ok || !('raw' in r) || !r.raw) continue;
        const rows = readMarks(r.raw, '', tideForWatched);
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
