/**
 * Medium-LLM prompt composition — BSP walks of medium-agent.json.
 *
 * All prompt intelligence lives in the pscale block (layer 2).
 * This function just walks the block and assembles context.
 * Change behaviour by editing the block, not this code.
 */

import type { Block } from './types';
import { bsp } from './bsp';
import type { DirResult } from './bsp';
import mediumAgent from '../../blocks/xstream/medium-agent.json';

/**
 * Flatten a pscale subtree into lines of text.
 * Walks underscore-first, then digits 1-9, recursively.
 */
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

/** Walk a block address and flatten the subtree at that point into joined text. */
function walkText(address: number): string {
  const result = bsp(mediumAgent, address, 'dir') as DirResult;
  return flattenNode(result.subtree).join('\n');
}

/** Walk a block address and return each node as a separate bullet. */
function walkBullets(address: number, name: string): string {
  const result = bsp(mediumAgent, address, 'dir') as DirResult;
  return flattenNode(result.subtree)
    .map(line => `- ${line.replace(/this character/gi, name).replace(/the character/gi, name)}`)
    .join('\n');
}

export function buildMediumPrompt(
  block: Block,
  triggerType: 'commit' | 'domino',
  dominoContext?: string
): string {
  const char = block.character;
  const name = char.name;

  // ── Role (from block 0.1) ──
  const roleText = walkText(0.1).replace(/this character/gi, name).replace(/the character/gi, name);
  const role = `You are the medium-LLM for ${name}.\n${roleText}`;

  // ── Scene (from character block — dynamic) ──
  const sceneSection = `SCENE:\n${block.scene}`;

  // ── Character (from character block — dynamic) ──
  const charSection = `CHARACTER — ${name}:\n${char.state}`;

  // ── Solid history (last 3 for continuity) ──
  const history = char.solid_history.slice(-3);
  const historySection = history.length > 0
    ? `PREVIOUS NARRATIVE (canon for ${name}):\n${history.map(s => `• ${s}`).join('\n')}`
    : '';

  // ── Accumulated context (from character block — dynamic) ──
  const acc = block.accumulated;
  const accSection = acc.length > 0
    ? `ACCUMULATED CONTEXT (CANON — already happened):\n${acc.map(a =>
        `[Established by ${a.source}'s resolution]\n${a.events.map(e => `• ${e}`).join('\n')}`
      ).join('\n\n')}`
    : 'ACCUMULATED CONTEXT: Nothing accumulated from other characters.';

  // ── Intention / domino trigger (dynamic + block-walked mode instructions) ──
  let intentSection: string;
  const dominoMode = block.trigger?.domino_mode ?? 'auto';

  if (triggerType === 'commit') {
    intentSection = `${name}'S COMMITTED INTENTION (liquid):\n${block.pending_liquid ?? ''}`;
  } else {
    intentSection = `DOMINO TRIGGER (what just happened to ${name}):\n${dominoContext ?? ''}`;
    if (block.pending_liquid) {
      intentSection += `\n\n${name}'S PENDING LIQUID (submitted before domino — may be used or overridden by events):\n${block.pending_liquid}`;
    }

    // Mode-specific domino instruction from block 0.52 (informed) or 0.51 (auto)
    if (dominoMode === 'informed') {
      const informedText = walkText(0.52).replace(/this character/gi, name).replace(/the character/gi, name);
      intentSection += `\n\nDOMINO MODE: PERCEPTION ONLY.\n${informedText}`;
    }
    // 'auto' mode: no extra instruction, medium narrates freely
  }

  // ── Constraints (from block 0.2) ──
  const constraints = walkBullets(0.2, name);

  // ── Output schema (from block 0.3) ──
  const outputSchema = walkText(0.3).replace(/this character/gi, name).replace(/the character/gi, name);

  // ── Response format (from block 0.7) ──
  const responseFormat = walkText(0.7);

  return `${role}

${sceneSection}

${charSection}

${historySection}

${accSection}

${intentSection}

RULES:
${constraints}

OUTPUT:
${outputSchema}

${responseFormat}
{"solid":"narrative","events":["event"],"domino":[],"internal":"state"}`;
}
