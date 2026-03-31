/**
 * Medium-LLM prompt composition — BSP walks of medium-agent.json.
 *
 * Star references in the agent block's hidden directory name which
 * world blocks to walk. The kernel follows stars via the block registry.
 * Runtime data (peers, events, familiarity) stays as kernel code.
 */

import type { Block, GameEvent } from './types';
import { bsp, collectUnderscore } from './bsp';
import type { DirResult, SpindleResult, StarResult, RingResult } from './bsp';
import mediumAgent from '../../blocks/xstream/medium-agent.json';
import { blockRegistry } from './block-registry';
import { resolveHarness } from './harness';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PscaleNode = string | { [key: string]: any };

function flattenNode(node: unknown): string[] {
  if (typeof node === 'string') return [node];
  if (!node || typeof node !== 'object') return [];
  const obj = node as Record<string, unknown>;
  const lines: string[] = [];
  if ('_' in obj && typeof obj._ === 'string') lines.push(obj._);
  for (let d = 1; d <= 9; d++) {
    const k = String(d);
    if (k in obj) lines.push(...flattenNode(obj[k]));
  }
  return lines;
}

/**
 * Follow star references from an agent block to compose scene context.
 * Star references name blocks in the registry. The kernel walks them
 * at the character's spatial_address.
 */
function buildSceneFromStars(block: Block, peerBlocks: Block[]): string {
  const addr = block.spatial_address;
  const star = bsp(mediumAgent as PscaleNode, 0, '*') as StarResult;
  const sections: string[] = [];

  if (star.hidden) {
    for (const key of Object.keys(star.hidden).sort()) {
      const ref = star.hidden[key];
      if (typeof ref !== 'string') continue;

      const worldBlock = blockRegistry[ref];
      if (!worldBlock) continue;

      if (ref.startsWith('spatial-')) {
        // Spindle → location context (broad to specific)
        const spindle = bsp(worldBlock as PscaleNode, addr) as SpindleResult;
        sections.push(`LOCATION: ${spindle.nodes.map(n => n.text).join(' — ')}`);

        // Dir → room contents
        const dir = bsp(worldBlock as PscaleNode, addr, 'dir') as DirResult;
        if (dir.subtree) {
          const contents = flattenNode(dir.subtree).slice(1);
          if (contents.length > 0) {
            sections.push(`VISIBLE:\n${contents.map(c => `- ${c}`).join('\n')}`);
          }
        }

        // Ring → exits with BSP addresses
        const ring = bsp(worldBlock as PscaleNode, addr, 'ring') as RingResult;
        if (ring.siblings.length > 0) {
          const exits = ring.siblings.map(s => {
            const exitAddr = addr.slice(0, -1) + s.digit;
            return `- [${exitAddr}] ${s.text ?? 'unexplored'}`;
          });
          sections.push(`EXITS:\n${exits.join('\n')}`);
        }
      } else if (ref.startsWith('rules-')) {
        // Rules: location-specific + perception
        const ruleLines: string[] = [];
        const spatialPrefix = addr.slice(0, 2);
        if (spatialPrefix === '11') {
          const norms = bsp(worldBlock as PscaleNode, 0.11, 'dir') as DirResult;
          if (norms.subtree) ruleLines.push(...flattenNode(norms.subtree));
        } else if (spatialPrefix === '12' || spatialPrefix === '13') {
          const norms = bsp(worldBlock as PscaleNode, 0.12, 'dir') as DirResult;
          if (norms.subtree) ruleLines.push(...flattenNode(norms.subtree));
        }
        if (addr.startsWith('2') || spatialPrefix === '12') {
          const terrain = bsp(worldBlock as PscaleNode, 0.13, 'dir') as DirResult;
          if (terrain.subtree) ruleLines.push(...flattenNode(terrain.subtree));
        }
        const perception = bsp(worldBlock as PscaleNode, 0.3, 'dir') as DirResult;
        if (perception.subtree) ruleLines.push(...flattenNode(perception.subtree));
        if (ruleLines.length > 0) {
          sections.push(`RULES IN EFFECT:\n${ruleLines.map(r => `- ${r}`).join('\n')}`);
        }
      }
    }
  }

  // Runtime data: characters present (from peer blocks)
  const present = peerBlocks.filter(
    p => p.spatial_address === addr && p.character.id !== block.character.id
  );
  if (present.length > 0) {
    const charLines = present.map(peer => {
      const peerId = peer.character.id;
      const fam = block.familiarity[peerId] ?? 0;
      const name = peer.character.name;
      const state = peer.character.state;
      const activity = peer.outbox?.events?.slice(-2).join('. ') || 'present, no recent action';
      if (fam === 0) return `- [id: ${peerId}] ${state}. Currently: ${activity}. (stranger)`;
      if (fam === 1) return `- [id: ${peerId}] ${name}. ${state}. Currently: ${activity}. (introduced)`;
      return `- [id: ${peerId}] ${name}. ${state}. Currently: ${activity}. (known)`;
    });
    sections.push(`CHARACTERS PRESENT:\n${charLines.join('\n')}`);
  }

  // Runtime data: recent events at this location
  const allEvents: GameEvent[] = [];
  for (const e of block.event_log) { if (e.S === addr) allEvents.push(e); }
  for (const peer of peerBlocks) {
    if (!peer.event_log) continue;
    for (const e of peer.event_log) { if (e.S === addr) allEvents.push(e); }
  }
  allEvents.sort((a, b) => b.T - a.T);
  const recent = allEvents.slice(0, 15);
  if (recent.length > 0) {
    sections.push(`RECENT EVENTS:\n${recent.map(e => `- [${e.type}] ${e.text}`).join('\n')}`);
  }

  return sections.join('\n\n');
}

export function buildMediumPrompt(
  block: Block,
  triggerType: 'commit' | 'domino',
  dominoContext?: string,
  peerBlocks?: Block[]
): string {
  const char = block.character;
  const name = char.name;

  // ── Role: spindle root (collectUnderscore follows nested chain) ──
  const role = collectUnderscore(mediumAgent as PscaleNode)?.replace(/{name}/g, name) ?? '';

  // ── Scene: star-walked world blocks or static fallback ──
  const sceneSection = peerBlocks
    ? buildSceneFromStars(block, peerBlocks)
    : `SCENE:\n${block.scene}`;

  // ── Character ──
  const charSection = `CHARACTER — ${name}:\n${char.state}`;

  // ── Solid history (last 3 for continuity) ──
  const history = char.solid_history.slice(-3);
  const historySection = history.length > 0
    ? `PREVIOUS NARRATIVE (canon for ${name}):\n${history.map(s => `• ${s}`).join('\n')}`
    : '';

  // ── Accumulated context ──
  const acc = block.accumulated;
  const accSection = acc.length > 0
    ? `ACCUMULATED CONTEXT (CANON — already happened):\n${acc.map(a =>
        `[Established by ${a.source}'s resolution]\n${a.events.map(e => `• ${e}`).join('\n')}`
      ).join('\n\n')}`
    : 'ACCUMULATED CONTEXT: Nothing accumulated from other characters.';

  // ── Intention / domino trigger ──
  let intentSection: string;
  const dominoMode = block.trigger?.domino_mode ?? 'auto';

  if (triggerType === 'commit') {
    intentSection = `${name}'S COMMITTED INTENTION (liquid):\n${block.pending_liquid ?? ''}`;
  } else {
    intentSection = `DOMINO TRIGGER (what just happened to ${name}):\n${dominoContext ?? ''}`;
    if (block.pending_liquid) {
      intentSection += `\n\n${name}'S PENDING LIQUID (submitted before domino — may be used or overridden by events):\n${block.pending_liquid}`;
    }
    if (dominoMode === 'informed') {
      intentSection += `\n\nDOMINO MODE: PERCEPTION ONLY. Narrate what ${name} perceives — sights, sounds, sensations. ${name} does NOT act, speak, decide, or respond. Produce empty domino list.`;
    }
  }

  // ── Rules: dir walk of section 1 ──
  const rulesDir = bsp(mediumAgent as PscaleNode, 0.1, 'dir') as DirResult;
  const rulesLines = flattenNode(rulesDir.subtree);
  const rules = rulesLines[0] + '\n' + rulesLines.slice(1)
    .map(line => `- ${line}`)
    .join('\n');

  // ── Produce: dir walk of section 2 ──
  const produceDir = bsp(mediumAgent as PscaleNode, 0.2, 'dir') as DirResult;
  const produceLines = flattenNode(produceDir.subtree);
  let produce = produceLines.join('\n');

  // ── Harness: inject solid constraint ──
  const harness = resolveHarness(block.harness_pscale ?? -2);
  if (harness.constraint) {
    produce = produce.replace(
      /\(a\) SOLID — [^.]+\./,
      `(a) SOLID — ${harness.constraint}`
    );
  }

  // ── Format: point at section 3 ──
  const formatResult = bsp(mediumAgent as PscaleNode, 0.3) as SpindleResult;
  const format = formatResult.nodes[formatResult.nodes.length - 1].text;

  // ── Few-shot from harness ──
  const fewShotSection = harness.few_shot.length > 0
    ? harness.few_shot.join('\n\n')
    : '';

  const prompt = `${role}
${fewShotSection ? `\n${fewShotSection}\n` : ''}
${sceneSection}

${charSection}

${historySection}

${accSection}

${intentSection}

${rules}

${produce}

${format}`;

  return prompt.replace(/{name}/g, name);
}
