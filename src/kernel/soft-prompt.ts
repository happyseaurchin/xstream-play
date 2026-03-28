/**
 * Soft-LLM prompt composition — BSP walks of soft-agent.json.
 *
 * Soft receives a restricted view: only what the character perceives.
 * No applicable_rules, no recent_traces the character wouldn't know about.
 */

import type { Block, Frame } from './types';
import { bsp } from './bsp';
import type { DirResult, SpindleResult } from './bsp';
import softAgent from '../../blocks/xstream/soft-agent.json';

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
 * Format frame for soft — restricted to what the character perceives.
 * No rules, no traces the character wouldn't consciously know.
 */
function formatFrameForSoft(frame: Frame): string {
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

  sections.push(`EXITS: ${frame.exits
    .map(e => `${e.direction} — ${e.description}`)
    .join('. ')}`);

  return sections.join('\n\n');
}

export function buildSoftPrompt(block: Block, playerMessage: string): string {
  const name = block.character.name;

  // 0._ = identity (spindle root)
  const identity = (bsp(softAgent as PscaleNode, 0) as SpindleResult).nodes[0].text;

  // 0.1 = role (dir walk)
  const roleDir = bsp(softAgent as PscaleNode, 0.1, 'dir') as DirResult;
  const roleLines = flattenNode(roleDir.subtree);
  const role = roleLines[0] + '\n' + roleLines.slice(1).map(l => `- ${l}`).join('\n');

  // 0.2 = knowledge gating (dir walk)
  const gatingDir = bsp(softAgent as PscaleNode, 0.2, 'dir') as DirResult;
  const gatingLines = flattenNode(gatingDir.subtree);
  const gating = gatingLines[0] + '\n' + gatingLines.slice(1).map(l => `- ${l}`).join('\n');

  // 0.3 = style (dir walk)
  const styleDir = bsp(softAgent as PscaleNode, 0.3, 'dir') as DirResult;
  const styleLines = flattenNode(styleDir.subtree);
  const style = styleLines[0] + '\n' + styleLines.slice(1).map(l => `- ${l}`).join('\n');

  // 0.5 = format (dir walk)
  const formatDir = bsp(softAgent as PscaleNode, 0.5, 'dir') as DirResult;
  const formatLines = flattenNode(formatDir.subtree);
  const format = formatLines.join('\n');

  // Scene: restricted frame or fallback to static scene
  const sceneSection = block.frame
    ? formatFrameForSoft(block.frame)
    : `SCENE:\n${block.scene}`;

  // Character state
  const charSection = `CHARACTER — ${name}:\n${block.character.state}`;

  // Recent solid history (last 3)
  const history = block.character.solid_history.slice(-3);
  const historySection = history.length > 0
    ? `RECENT EXPERIENCE:\n${history.map(s => `• ${s}`).join('\n')}`
    : '';

  // Player message
  const messageSection = `PLAYER IS THINKING: "${playerMessage}"`;

  const prompt = `${identity}

${role}

${gating}

${style}

${format}

${sceneSection}

${charSection}

${historySection}

${messageSection}`;

  return prompt.replace(/{name}/g, name);
}
