/**
 * Browser Kernel — faithful port of kernel.py
 *
 * One instance per character. Runs in the browser via setInterval.
 * Writes its own block to the relay. Reads peer blocks from the relay.
 * Fires the medium-LLM when triggered. Never calls another character's medium.
 *
 * Sovereignty: this kernel only writes to its own block, only fires its own LLM.
 * Coordination is stigmergic — ants read the environment, not each other.
 */

import { callClaude } from './claude-direct';
import { buildMediumPrompt, buildAuthorPrompt, buildDesignerPrompt } from './prompt';
import { applyBlockEdit } from './block-store';
import type { Block, MediumResult, AuthorResult, DesignerResult, AccumulatedEvent, DominoSignal } from './types';
import type { Face } from '../types/xstream';

// ============================================================
// RELAY ABSTRACTION — swap backing store here only
// ============================================================

async function writeBlock(gameId: string, charId: string, block: Block): Promise<void> {
  const res = await fetch(`/api/relay/${gameId}/${charId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(block),
  });
  if (!res.ok) {
    const err = await res.text();
    console.error(`[relay PUT] ${res.status}:`, err);
    throw new Error(`Relay PUT failed: ${res.status} — ${err.substring(0, 200)}`);
  }
}

async function readPeerBlocks(gameId: string, myCharId: string): Promise<Block[]> {
  const res = await fetch(`/api/relay/${gameId}?exclude=${myCharId}`);
  if (!res.ok) return [];
  return res.json();
}

// ============================================================
// MEDIUM-LLM CALL — direct from browser to Anthropic
// ============================================================

async function callMedium(
  block: Block,
  triggerType: 'commit' | 'domino',
  dominoContext?: string,
  peerBlocks?: Block[]
): Promise<MediumResult | null> {
  const prompt = buildMediumPrompt(block, triggerType, dominoContext, peerBlocks);
  const config = block.medium;

  try {
    const text = await callClaude(config.api_key, config.model, prompt, config.max_tokens);
    // Parse JSON from response — strip markdown fences if present
    const cleaned = text.trim()
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();
    return JSON.parse(cleaned);
  } catch (e) {
    console.error('[kernel] Medium call failed:', e);
    return null;
  }
}

// ============================================================
// AUTHOR-MEDIUM CALL — author face commit
// ============================================================

async function callAuthorMedium(
  block: Block,
  peerBlocks?: Block[]
): Promise<AuthorResult | null> {
  const prompt = buildAuthorPrompt(block, peerBlocks);
  const config = block.medium;

  try {
    // Author edits need Sonnet for structured output precision
    const model = 'claude-sonnet-4-20250514';
    const text = await callClaude(config.api_key, model, prompt, config.max_tokens);
    const cleaned = text.trim()
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();
    return JSON.parse(cleaned);
  } catch (e) {
    console.error('[kernel] Author medium call failed:', e);
    return null;
  }
}

// ============================================================
// DESIGNER-MEDIUM CALL — designer face commit
// ============================================================

async function callDesignerMedium(
  block: Block,
  peerBlocks?: Block[]
): Promise<DesignerResult | null> {
  const prompt = buildDesignerPrompt(block, peerBlocks);
  const config = block.medium;

  try {
    const model = 'claude-sonnet-4-20250514';
    const text = await callClaude(config.api_key, model, prompt, config.max_tokens);
    const cleaned = text.trim()
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();
    return JSON.parse(cleaned);
  } catch (e) {
    console.error('[kernel] Designer medium call failed:', e);
    return null;
  }
}

// ============================================================
// FAMILIARITY DETECTION — scan events for introduction patterns
// ============================================================

const INTRO_PATTERNS = [
  /introduces?\s+(himself|herself|themselves|themself)\s+as\s+/i,
  /tells?\s+you\s+(his|her|their)\s+name\s+is\s+/i,
  /my\s+name\s+is\s+/i,
  /I'm\s+[A-Z]/,
  /call\s+me\s+[A-Z]/i,
];

function checkIntroduction(events: string[]): boolean {
  return events.some(e => INTRO_PATTERNS.some(p => p.test(e)));
}

// ============================================================
// POLL PEERS — discover events and dominos
// ============================================================

function pollPeers(
  block: Block,
  peerBlocks: Block[]
): { newEvents: AccumulatedEvent[]; newDominos: DominoSignal[] } {
  const myId = block.character.id;
  const newEvents: AccumulatedEvent[] = [];
  const newDominos: DominoSignal[] = [];

  for (const peer of peerBlocks) {
    const peerId = peer.character?.id;
    if (!peerId || peerId === myId) continue;

    const peerSeq = peer.outbox?.sequence ?? 0;
    const lastSeen = block.last_seen[peerId] ?? 0;

    if (peerSeq <= lastSeen) continue; // Nothing new

    // Accumulate events
    const events = peer.outbox?.events ?? [];
    if (events.length > 0) {
      newEvents.push({
        source: peerId,
        events,
        sequence: peerSeq,
      });
    }

    // Check dominos addressed to us
    for (const d of peer.outbox?.domino ?? []) {
      const target = (d.target ?? '').toLowerCase();
      if (target === myId.toLowerCase()) {
        newDominos.push({
          source: peerId,
          context: d.context ?? '',
          urgency: d.urgency ?? 'soon',
          sequence: peerSeq,
        });
      }
    }

    // Update tracking
    block.last_seen[peerId] = peerSeq;
  }

  return { newEvents, newDominos };
}

// ============================================================
// PROCESS MEDIUM OUTPUT — write to outbox
// ============================================================

function processMediumOutput(block: Block, result: MediumResult, triggerType: string): void {
  // Update outbox (this is what peers will read)
  block.outbox.solid = result.solid ?? null;
  block.outbox.events = result.events ?? [];
  block.outbox.domino = result.domino ?? [];
  block.outbox.sequence += 1;
  block.outbox.timestamp = new Date().toISOString();

  // ── Event filing: tag events with S × T × I coordinates ──
  if (result.events) {
    for (const eventText of result.events) {
      block.event_log.push({
        S: block.spatial_address,
        T: block.event_log.length + 1,
        I: block.character.id,
        text: eventText,
        type: 'action',
      });
    }
  }

  // ── Movement: handle location_change ──
  if (result.location_change) {
    // File departure at old location
    block.event_log.push({
      S: block.spatial_address,
      T: block.event_log.length + 1,
      I: block.character.id,
      text: `${block.character.name} leaves.`,
      type: 'departure',
    });

    // Update address
    block.spatial_address = result.location_change;

    // File arrival at new location
    block.event_log.push({
      S: block.spatial_address,
      T: block.event_log.length + 1,
      I: block.character.id,
      text: `${block.character.name} arrives.`,
      type: 'arrival',
    });

  }

  // Add to own solid history
  if (result.solid) {
    block.character.solid_history.push(result.solid);
    // Keep last 10
    block.character.solid_history = block.character.solid_history.slice(-10);
  }

  // Clear accumulated (it's been incorporated)
  block.accumulated = [];

  // Clear liquid after any successful medium call — it's been consumed
  block.pending_liquid = null;

  block.status = 'idle';
}

// ============================================================
// THE KERNEL — the loop
// ============================================================

export interface KernelCallbacks {
  onSolid: (solid: string) => void;
  onStatusChange: (status: string) => void;
  onAccumulate: (source: string, count: number) => void;
  onDomino: (source: string, context: string) => void;
  onPeerLiquid: (peers: { id: string; label: string; liquid: string }[]) => void;
  onError: (error: string) => void;
  onLog: (message: string) => void;
}

export class Kernel {
  block: Block;
  gameId: string;
  face: Face = 'character';
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private callbacks: KernelCallbacks;
  private running = false;

  constructor(block: Block, gameId: string, callbacks: KernelCallbacks) {
    this.block = block;
    this.gameId = gameId;
    this.callbacks = callbacks;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const pollInterval = (this.block.trigger?.poll_interval_s ?? 3) * 1000;

    this.callbacks.onLog(
      `🦀 Kernel started: ${this.block.character.name} in game ${this.gameId}`
    );

    // Initial write so peers can see us
    writeBlock(this.gameId, this.block.character.id, this.block);

    // The loop
    this.intervalId = setInterval(() => this.cycle(), pollInterval);
  }

  stop(): void {
    if (this.intervalId) clearInterval(this.intervalId);
    this.running = false;
    this.callbacks.onLog(`🛑 Kernel stopped: ${this.block.character.name}`);
  }

  // Player types text
  submitLiquid(text: string): void {
    this.block.pending_liquid = text;
    this.block.status = 'waiting';
    this.callbacks.onLog(`  ✏️  Liquid: ${text.slice(0, 60)}...`);
    // Write immediately so peers can see the forming intention
    writeBlock(this.gameId, this.block.character.id, this.block);
  }

  // Player hits commit
  commit(face?: Face): void {
    if (!this.block.pending_liquid) {
      this.callbacks.onLog('  ⚠️  Nothing to commit');
      return;
    }
    if (face) this.face = face;
    this.block.status = 'resolving';
    this.callbacks.onLog(`  ⚡ Commit (${this.face}) — medium will fire on next cycle`);
    this.callbacks.onStatusChange('resolving');
  }

  private cycling = false;

  private async cycle(): Promise<void> {
    if (!this.running || this.cycling) return;
    this.cycling = true;

    try {
      // ── STEP 0: Read peers ──
      const peerBlocks = await readPeerBlocks(this.gameId, this.block.character.id);

      // ── STEP 1: Poll peers ──
      const { newEvents, newDominos } = pollPeers(this.block, peerBlocks);

      // Surface peer liquid — proximity-scoped by face
      const peerLiquid = peerBlocks
        .filter(p => {
          if (!p.pending_liquid) return false;
          if (this.face === 'character') {
            // Same room
            return p.spatial_address === this.block.spatial_address;
          }
          if (this.face === 'author') {
            // Same edit target + shared address prefix (spindle overlap)
            if (p.edit_target !== this.block.edit_target) return false;
            const myAddr = this.block.edit_address ?? '';
            const peerAddr = p.edit_address ?? '';
            return myAddr.startsWith(peerAddr) || peerAddr.startsWith(myAddr);
          }
          // Designer: same edit target
          return p.edit_target === this.block.edit_target;
        })
        .map(p => {
          const fam = this.block.familiarity[p.character.id] ?? 0;
          const label = fam > 0 ? p.character.name : (p.character.state || 'a stranger');
          return { id: p.character.id, label, liquid: p.pending_liquid! };
        });
      this.callbacks.onPeerLiquid(peerLiquid);

      // Accumulate events + check for introductions
      for (const ev of newEvents) {
        this.block.accumulated.push({
          source: ev.source,
          events: ev.events,
        });
        this.callbacks.onAccumulate(ev.source, ev.events.length);
        this.callbacks.onLog(
          `  📥 Events from ${ev.source}: ${ev.events.length} accumulated`
        );

        // Familiarity gating: detect introductions in peer events
        if (checkIntroduction(ev.events)) {
          const currentFam = this.block.familiarity[ev.source] ?? 0;
          if (currentFam < 1) {
            this.block.familiarity[ev.source] = 1;
            this.callbacks.onLog(
              `  👋 Introduction detected from ${ev.source} — familiarity → 1`
            );
          }
        }
      }

      // ── STEP 2: Process dominos ──
      const dominoMode = this.block.trigger?.domino_mode ?? 'auto';
      const shouldFireDomino = this.block.trigger?.domino_fires_medium && dominoMode !== 'silent';
      if (newDominos.length > 0 && shouldFireDomino) {
        for (const domino of newDominos) {
          this.callbacks.onDomino(domino.source, domino.context);
          this.callbacks.onLog(
            `  💥 DOMINO from ${domino.source}: ${domino.context.slice(0, 60)}...`
          );
          this.callbacks.onStatusChange('domino_responding');

          const result = await callMedium(this.block, 'domino', domino.context, peerBlocks);
          if (result) {
            processMediumOutput(this.block, result, 'domino');
            this.callbacks.onSolid(result.solid ?? '');
            this.callbacks.onLog(
              `  ✅ Solid: ${(result.solid ?? '').slice(0, 80)}...`
            );
            this.callbacks.onLog(
              `     Events: ${(result.events ?? []).length} deposited`
            );
            await writeBlock(this.gameId, this.block.character.id, this.block);
          }
        }
      }

      // ── STEP 3: Process player commit ──
      if (this.block.status === 'resolving' && this.block.pending_liquid) {
        if (this.face === 'author' || this.face === 'designer') {
          // ── AUTHOR/DESIGNER FACE: produce block edit ──
          const label = this.face;
          this.callbacks.onLog(`  🎯 ${label} committed. Firing ${label}-medium...`);

          const result = this.face === 'designer'
            ? await callDesignerMedium(this.block, peerBlocks)
            : await callAuthorMedium(this.block, peerBlocks);

          if (result?.edit) {
            const applied = applyBlockEdit({
              block: result.edit.block,
              address: result.edit.address,
              operation: result.edit.operation,
              key: result.edit.key,
              content: result.edit.content as string,
            });
            const summary = result.summary ?? (applied ? 'Edit applied.' : 'Edit failed.');
            const rationale = 'rationale' in result && result.rationale ? ` (${result.rationale})` : '';
            this.callbacks.onSolid(`[${label}] ${summary}${rationale}`);
            this.callbacks.onLog(`  ✏️  ${applied ? 'Applied' : 'Failed'}: ${summary}`);
          } else {
            const summary = result?.summary ?? 'No edit produced.';
            this.callbacks.onSolid(`[${label}] ${summary}`);
            this.callbacks.onLog(`  ⚠️  ${label} result: ${summary}`);
          }

          this.block.pending_liquid = null;
          this.block.status = 'idle';
          this.callbacks.onStatusChange('idle');
          await writeBlock(this.gameId, this.block.character.id, this.block);

        } else {
          // ── CHARACTER FACE: produce narrative ──
          this.callbacks.onLog(`  🎯 Player committed. Firing medium...`);

          const result = await callMedium(this.block, 'commit', undefined, peerBlocks);
          if (result) {
            processMediumOutput(this.block, result, 'commit');
            this.callbacks.onSolid(result.solid ?? '');
            this.callbacks.onStatusChange('idle');
            this.callbacks.onLog(
              `  ✅ Solid: ${(result.solid ?? '').slice(0, 80)}...`
            );
            this.callbacks.onLog(
              `     Events: ${(result.events ?? []).length} deposited`
            );
            const dominoTargets = (result.domino ?? [])
              .map((d: { target?: string }) => d.target ?? '?');
            if (dominoTargets.length > 0) {
              this.callbacks.onLog(`     Domino targets: ${dominoTargets.join(', ')}`);
            }
            await writeBlock(this.gameId, this.block.character.id, this.block);
          } else {
            this.block.status = 'idle';
            this.callbacks.onStatusChange('idle');
            this.callbacks.onError('Medium call failed');
          }
        }
      }
    } catch (e) {
      console.error('[kernel] Cycle error:', e);
      this.callbacks.onError(e instanceof Error ? e.message : 'Cycle error');
    } finally {
      this.cycling = false;
    }
  }
}
