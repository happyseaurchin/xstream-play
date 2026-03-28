/**
 * Soft-LLM prompt composition — BSP walks of soft-agent.json + perception block.
 *
 * Soft receives a restricted view of perception: location, visible,
 * characters, exits. No rules, no event traces the character wouldn't
 * consciously know about.
 */

import type { Block } from './types';
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
 * Walk perception block — restricted for Soft.
 * Only: location (_), visible (1), characters (2), exits (3).
 * Omits: rules (4), recent events (5).
 */
function formatPerceptionForSoft(perception: Record<string, unknown>): string {
  const sections: string[] = [];

  if (typeof perception._ === 'string') {
    sections.push(`LOCATION: ${perception._}`);
  }

  const labels: [string, string][] = [
    ['1', 'VISIBLE'],
    ['2', 'CHARACTERS PRESENT'],
    ['3', 'EXITS'],
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

  // Scene: restricted perception or fallback
  const sceneSection = block.perception
    ? formatPerceptionForSoft(block.perception as Record<string, unknown>)
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
