/**
 * Medium-LLM prompt composition — BSP walks of medium-agent.json.
 *
 * The block holds the tested prompt text from the Python kernel.
 * This function walks it and assembles the context window.
 * Same output as kernel.py build_medium_prompt, different source.
 *
 * Returns { system, user } for proper Claude API message separation.
 * System = role + rules + schema + format (stable per-agent content)
 * User = scene + character + history + accumulated + intention (per-call content)
 */

import type { Block, Frame } from './types';
import { bsp } from './bsp';
import type { DirResult, SpindleResult } from './bsp';
import mediumAgent from '../../blocks/xstream/medium-agent.json';

/**
 * Format a Hard-LLM frame into text for Medium's context window.
 * The frame replaces the static scene string.
 */
export function formatFrame(frame: Frame): string {
  const sections = [
    `LOCATION: ${frame.location}`,
    `VISIBLE: ${frame.visible.join('. ')}`,
    `AUDIBLE: ${frame.audible.join('. ')}`,
    `ATMOSPHERE: ${frame.atmosphere}`,
  ];

  if (frame.characters_present.length > 0) {
    sections.push(`CHARACTERS PRESENT:\n${frame.characters_present
      .map(c => `- ${c.description}. ${c.current_activity}`)
      .join('\n')}`);
  }

  if (frame.recent_traces.length > 0) {
    sections.push(`RECENT TRACES: ${frame.recent_traces.join('. ')}`);
  }

  if (frame.applicable_rules.length > 0) {
    sections.push(`RULES IN EFFECT:\n${frame.applicable_rules
      .map(r => `- ${r}`)
      .join('\n')}`);
  }

  sections.push(`EXITS: ${frame.exits
    .map(e => `${e.direction} — ${e.description}`)
    .join('. ')}`);

  return sections.join('\n\n');
}

/**
 * Flatten a pscale subtree into lines of text.
 * Underscore first, then digits 1-9, recursively.
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

export interface MediumPrompt {
  system: string;
  user: string;
}

export function buildMediumPrompt(
  block: Block,
  triggerType: 'commit' | 'domino',
  dominoContext?: string
): MediumPrompt {
  const char = block.character;
  const name = char.name;

  // ══════════════════════════════════════════════
  // SYSTEM — stable per-agent content
  // ══════════════════════════════════════════════

  // ── Role: spindle root ──
  const roleResult = bsp(mediumAgent, 0) as SpindleResult;
  const role = roleResult.nodes[0].text.replace(/{name}/g, name);

  // ── Rules: dir walk of section 1 → header + ring of constraints ──
  const rulesDir = bsp(mediumAgent, 0.1, 'dir') as DirResult;
  const rulesLines = flattenNode(rulesDir.subtree);
  const rules = rulesLines[0] + '\n' + rulesLines.slice(1)
    .map(line => `- ${line}`)
    .join('\n');

  // ── Produce: dir walk of section 2 → header + ring of output fields ──
  const produceDir = bsp(mediumAgent, 0.2, 'dir') as DirResult;
  const produceLines = flattenNode(produceDir.subtree);
  const produce = produceLines.join('\n');

  // ── Format: point at section 3 ──
  const formatResult = bsp(mediumAgent, 0.3) as SpindleResult;
  const format = formatResult.nodes[formatResult.nodes.length - 1].text;

  const system = `${role}\n\n${rules}\n\n${produce}\n\n${format}`
    .replace(/{name}/g, name);

  // ══════════════════════════════════════════════
  // USER — per-call content
  // ══════════════════════════════════════════════

  // ── Scene: use Hard frame when available, fallback to static scene ──
  const sceneSection = block.frame
    ? formatFrame(block.frame)
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

  const user = `${sceneSection}\n\n${charSection}\n\n${historySection}\n\n${accSection}\n\n${intentSection}`
    .replace(/{name}/g, name);

  return { system, user };
}
