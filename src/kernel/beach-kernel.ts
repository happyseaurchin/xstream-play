/**
 * Beach kernel — the runtime poll loop of an xstream beach client.
 *
 * No game state. No relay. Talks to the bsp-mcp commons / federated beach via
 * bsp-client only. Each cycle:
 *   1. Heartbeat presence at current_beach:1.<digit>
 *   2. Read presence at current_beach:1, filter by address prefix → live peers
 *   3. Beachcombing mode: read marks at current_beach:1 (filtered by address)
 *      → render in the SOLID stream of the panel.
 *   4. Frame mode (when session.current_frame is set): read the frame disc at
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
import type { BeachSession, MarkRow, FrameView, FrameEntity } from './beach-session';

export interface BeachKernelCallbacks {
  onPresence: (peers: PresenceMark[]) => void;
  onMarks: (marks: MarkRow[]) => void;
  onFrame: (frame: FrameView | null) => void;
  onError: (err: string) => void;
  onLog: (msg: string) => void;
}

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

function isPresenceMark(node: PscaleNode): boolean {
  if (typeof node !== 'object' || node === null) return false;
  const obj = node as Record<string, PscaleNode>;
  return typeof obj['1'] === 'string' && typeof obj['2'] === 'string' && typeof obj['3'] === 'string';
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
      out.push({ digit: k, agent_id: null, address: null, timestamp: null, text: m, is_presence: false });
      continue;
    }
    if (typeof m === 'object' && m !== null) {
      const obj = m as Record<string, PscaleNode>;
      const aid = typeof obj['1'] === 'string' ? (obj['1'] as string) : null;
      const addr = typeof obj['2'] === 'string' ? (obj['2'] as string) : null;
      const ts = typeof obj['3'] === 'string' ? (obj['3'] as string) : null;
      const text = typeof obj._ === 'string' ? (obj._ as string) : '(structured mark)';
      const presence = isPresenceMark(m);
      // Filter: keep marks whose address starts with the requested prefix
      // (or marks with no address at all, treated as beach-root).
      if (addressFilter && addr && !addr.startsWith(addressFilter)) continue;
      out.push({ digit: k, agent_id: aid, address: addr, timestamp: ts, text, is_presence: presence });
    }
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

  constructor(session: BeachSession, callbacks: BeachKernelCallbacks) {
    this.session = session;
    this.cb = callbacks;
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

  /** Update the address; next cycle will re-read marks/presence. */
  setAddress(addr: string): void {
    this.session.current_address = addr;
  }

  /** Update the beach — next cycle re-targets. */
  setBeach(beach: string): void {
    this.session.current_beach = beach;
  }

  /** Enter / leave a frame. */
  setFrame(frame: string | null, position: string | null = null): void {
    this.session.current_frame = frame;
    this.session.entity_position = position;
  }

  /** Drop a free-form mark at current_beach:1.<next free>. Tier-1, no LLM. */
  async dropMark(text: string): Promise<{ ok: boolean; error?: string }> {
    if (!text.trim()) return { ok: false, error: 'empty' };
    const beach = this.session.current_beach;
    const ts = new Date().toISOString();
    // Find next-free digit by reading the marks ring.
    const r = await bsp({ agent_id: beach, block: 'beach', spindle: '1' });
    let nextDigit = '1';
    if (r.ok && 'raw' in r && r.raw && typeof r.raw === 'object') {
      const root = r.raw as Record<string, PscaleNode>;
      const m = root['1'];
      if (typeof m === 'object' && m !== null) {
        for (let d = 1; d <= 9; d++) {
          if (!(String(d) in (m as Record<string, PscaleNode>))) { nextDigit = String(d); break; }
          if (d === 9) nextDigit = '9'; // overflow — overwrite last
        }
      }
    }
    const result = await bsp({
      agent_id: beach,
      block: 'beach',
      spindle: '1.' + nextDigit,
      content: {
        _: text,
        '1': this.session.agent_id || '(anon)',
        '2': this.session.current_address,
        '3': ts,
      },
    });
    if (result.ok) {
      this.cb.onLog(`📍 mark dropped at ${beach}:1.${nextDigit}`);
      // Trigger an immediate read to refresh the panel
      this.cycle();
    } else {
      const err = 'error' in result ? result.error : 'unknown';
      this.cb.onError(`mark write failed: ${err ?? 'unknown'}`);
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

      // 3. Marks read (beachcombing + non-presence marks at this address)
      const ringResult = await bsp({ agent_id: beach, block: 'beach', spindle: '1' });
      const ringRaw = ringResult.ok && 'raw' in ringResult ? ringResult.raw : null;
      const marks = readMarks(ringRaw, address);
      this.cb.onMarks(marks);

      // 4. Frame read (when in a frame)
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
    } catch (e) {
      this.cb.onError(e instanceof Error ? e.message : String(e));
    } finally {
      this.cycling = false;
    }
  }
}
