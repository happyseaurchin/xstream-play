/**
 * Medium-LLM prompt composition — BSP walks of medium-agent.json + perception block.
 *
 * The medium-agent block holds the tested prompt text.
 * The perception block holds the world state (built by BSP walks, no LLM).
 * This function walks both and assembles the context window.
 */

import type { Block } from './types';
import { bsp } from './bsp';
import type { DirResult, SpindleResult } from './bsp';
import mediumAgent from '../../blocks/xstream/medium-agent.json';
import { resolveHarness } from './harness';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PscaleNode = string | { [key: string]: any };

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

/**
 * Walk the perception pscale block into text for Medium's context.
 * The block shape: _ = location, 1 = visible, 2 = characters, 3 = exits, 4 = rules, 5 = events.
 * Medium sees everything including rules and events.
 */
function formatPerception(perception: Record<string, unknown>): string {
  const sections: string[] = [];

  // Location from underscore
  if (typeof perception._ === 'string') {
    sections.push(`LOCATION: ${perception._}`);
  }

  // Walk each numbered section
  const labels: [string, string][] = [
    ['1', 'VISIBLE'],
    ['2', 'CHARACTERS PRESENT'],
    ['3', 'EXITS'],
    ['4', 'RULES IN EFFECT'],
    ['5', 'RECENT EVENTS'],
  ];

  for (const [key, label] of labels) {
    if (key in perception) {
      const lines = flattenNode(perception[key]);
      if (lines.length > 1) {
        sections.push(`${label}:\n${lines.slice(1).map(l => `- ${l}`).join('\n')}`);
      } else if (lines.length === 1) {
        sections.push(`${label}: ${lines[0]}`);
      }
    }
  }

  return sections.join('\n\n');
}

export function buildMediumPrompt(
  block: Block,
  triggerType: 'commit' | 'domino',
  dominoContext?: string
): string {
  const char = block.character;
  const name = char.name;

  // ── Role: spindle root ──
  const roleResult = bsp(mediumAgent as PscaleNode, 0) as SpindleResult;
  const role = roleResult.nodes[0].text.replace(/{name}/g, name);

  // ── Scene: perception block or static fallback ──
  const sceneSection = block.perception
    ? formatPerception(block.perception as Record<string, unknown>)
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

  // ── Rules: dir walk of section 1 → header + ring of constraints ──
  const rulesDir = bsp(mediumAgent as PscaleNode, 0.1, 'dir') as DirResult;
  const rulesLines = flattenNode(rulesDir.subtree);
  const rules = rulesLines[0] + '\n' + rulesLines.slice(1)
    .map(line => `- ${line}`)
    .join('\n');

  // ── Produce: dir walk of section 2 → header + ring of output fields ──
  const produceDir = bsp(mediumAgent as PscaleNode, 0.2, 'dir') as DirResult;
  const produceLines = flattenNode(produceDir.subtree);
  let produce = produceLines.join('\n');

  // ── Harness: inject solid constraint from pscale level ──
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

  // ── Few-shot examples from harness ──
  const fewShotSection = harness.few_shot.length > 0
    ? harness.few_shot.join('\n\n')
    : '';

  // Substitute {name} in rules and produce
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
