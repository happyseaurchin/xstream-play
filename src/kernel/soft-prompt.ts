/**
 * Soft-LLM prompt composition — BSP walks of soft-agent.json.
 *
 * Star references in soft-agent's hidden directory name which
 * world blocks to walk. Soft gets a restricted view: spatial only,
 * no rules block. Runtime peer data not included — soft knows
 * only what the character perceives directly.
 */

import type { Block } from './types';
import { bsp, collectUnderscore } from './bsp';
import type { DirResult, SpindleResult, StarResult, RingResult } from './bsp';
import { getBlock } from './block-store';

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
 * Follow star references from soft-agent to compose scene context.
 * Soft only gets spatial — no rules.
 */
function buildSceneForSoft(block: Block): string {
  const addr = block.spatial_address;
  const softAgent = getBlock('soft-agent');
  if (!softAgent) return '';
  const star = bsp(softAgent as PscaleNode, 0, '*') as StarResult;
  const sections: string[] = [];

  if (star.hidden) {
    for (const key of Object.keys(star.hidden).sort()) {
      const ref = star.hidden[key];
      if (typeof ref !== 'string') continue;

      const worldBlock = getBlock(ref);
      if (!worldBlock) continue;

      if (ref.startsWith('spatial-')) {
        const spindle = bsp(worldBlock as PscaleNode, addr) as SpindleResult;
        sections.push(`LOCATION: ${spindle.nodes.map(n => n.text).join(' — ')}`);

        const dir = bsp(worldBlock as PscaleNode, addr, 'dir') as DirResult;
        if (dir.subtree) {
          const contents = flattenNode(dir.subtree).slice(1);
          if (contents.length > 0) {
            sections.push(`VISIBLE:\n${contents.map(c => `- ${c}`).join('\n')}`);
          }
        }

        const ring = bsp(worldBlock as PscaleNode, addr, 'ring') as RingResult;
        if (ring.siblings.length > 0) {
          const exits = ring.siblings.map(s => {
            const exitAddr = addr.slice(0, -1) + s.digit;
            return `- [${exitAddr}] ${s.text ?? 'unexplored'}`;
          });
          sections.push(`EXITS:\n${exits.join('\n')}`);
        }
      }
      // Soft does NOT follow rules- references
    }
  }

  return sections.join('\n\n');
}

export function buildSoftPrompt(block: Block, playerMessage: string): string {
  const name = block.character.name;
  const softAgent = getBlock('soft-agent');
  if (!softAgent) return '';

  // Identity via collectUnderscore (follows nested chain)
  const identity = collectUnderscore(softAgent as PscaleNode)?.replace(/{name}/g, name) ?? '';

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

  // Scene: star-walked spatial block or fallback
  const sceneSection = buildSceneForSoft(block) || `SCENE:\n${block.scene}`;

  const charSection = `CHARACTER — ${name}:\n${block.character.state}`;

  const history = block.character.solid_history.slice(-3);
  const historySection = history.length > 0
    ? `RECENT EXPERIENCE:\n${history.map(s => `• ${s}`).join('\n')}`
    : '';

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
