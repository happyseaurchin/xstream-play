/**
 * Soft-LLM prompt composition — face-aware BSP walks.
 *
 * Character face: walks soft-agent.json, shows spatial scene.
 * Author face: walks soft-author-agent.json, shows block content at edit address.
 * Designer face: walks soft-designer-agent.json, shows rules/agent config.
 */

import type { Block } from './types';
import type { Face } from '../types/xstream';
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

/** Character face: spatial scene from star-walked blocks */
function buildSceneForCharacter(block: Block): string {
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
    }
  }

  return sections.join('\n\n');
}

/** Author face: block content at edit address */
function buildContextForAuthor(block: Block): string {
  const editTarget = block.edit_target ?? 'spatial-thornkeep';
  const editAddr = block.edit_address ?? block.spatial_address;
  const targetBlock = getBlock(editTarget);
  if (!targetBlock) return `EDIT TARGET: "${editTarget}" (not found in store)`;

  const sections: string[] = [];
  sections.push(`EDIT TARGET: "${editTarget}" at address "${editAddr}"`);

  const spindle = bsp(targetBlock as PscaleNode, editAddr) as SpindleResult;
  sections.push(`CONTEXT CHAIN:\n${spindle.nodes.map(n => `  [${n.pscale}] ${n.text}`).join('\n')}`);

  const dir = bsp(targetBlock as PscaleNode, editAddr, 'dir') as DirResult;
  if (dir.subtree && typeof dir.subtree === 'object') {
    sections.push(`CURRENT CONTENT:\n${JSON.stringify(dir.subtree, null, 2).slice(0, 1000)}`);
  }

  const ring = bsp(targetBlock as PscaleNode, editAddr, 'ring') as RingResult;
  if (ring.siblings.length > 0) {
    const sibs = ring.siblings.map(s => `  [${s.digit}] ${s.text ?? '(branch)'}${s.branch ? ' +' : ''}`);
    sections.push(`SIBLINGS:\n${sibs.join('\n')}`);
  }

  return sections.join('\n\n');
}

/** Designer face: rules/agent config at edit address */
function buildContextForDesigner(block: Block): string {
  const editTarget = block.edit_target ?? 'rules-thornkeep';
  const editAddr = block.edit_address ?? '0';
  const targetBlock = getBlock(editTarget);
  if (!targetBlock) return `EDIT TARGET: "${editTarget}" (not found in store)`;

  const sections: string[] = [];
  sections.push(`EDIT TARGET: "${editTarget}" at address "${editAddr}"`);

  const spindle = bsp(targetBlock as PscaleNode, editAddr) as SpindleResult;
  sections.push(`CONTEXT CHAIN:\n${spindle.nodes.map(n => `  [${n.pscale}] ${n.text}`).join('\n')}`);

  const dir = bsp(targetBlock as PscaleNode, editAddr, 'dir') as DirResult;
  if (dir.subtree && typeof dir.subtree === 'object') {
    sections.push(`CURRENT CONTENT:\n${JSON.stringify(dir.subtree, null, 2).slice(0, 1000)}`);
  }

  // Also show star refs if present
  const star = bsp(targetBlock as PscaleNode, editAddr, '*') as StarResult;
  if (star.hidden) {
    const refs = Object.entries(star.hidden).map(([k, v]) =>
      `  ${k}: ${typeof v === 'string' ? v : '(embedded)'}`
    );
    sections.push(`STAR REFERENCES:\n${refs.join('\n')}`);
  }

  return sections.join('\n\n');
}

/** Resolve which soft-agent block to use per face */
function getSoftAgentName(face: Face): string {
  switch (face) {
    case 'author': return 'soft-author-agent';
    case 'designer': return 'soft-designer-agent';
    default: return 'soft-agent';
  }
}

export function buildSoftPrompt(block: Block, playerMessage: string, face: Face = 'character'): string {
  const name = block.character.name;
  const agentName = getSoftAgentName(face);
  const softAgent = getBlock(agentName);
  if (!softAgent) return '';

  // Identity via collectUnderscore (follows nested chain)
  const identity = collectUnderscore(softAgent as PscaleNode)?.replace(/{name}/g, name) ?? '';

  // 0.1 = role (dir walk)
  const roleDir = bsp(softAgent as PscaleNode, 0.1, 'dir') as DirResult;
  const roleLines = flattenNode(roleDir.subtree);
  const role = roleLines[0] + '\n' + roleLines.slice(1).map(l => `- ${l}`).join('\n');

  // 0.2 = knowledge (dir walk)
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

  // Context section: face-dependent
  let contextSection: string;
  if (face === 'author') {
    contextSection = buildContextForAuthor(block);
  } else if (face === 'designer') {
    contextSection = buildContextForDesigner(block);
  } else {
    contextSection = buildSceneForCharacter(block) || `SCENE:\n${block.scene}`;
  }

  // Character section only for character face
  const charSection = face === 'character'
    ? `CHARACTER — ${name}:\n${block.character.state}`
    : '';

  // History: character sees narrative, author/designer see edit history
  const history = block.character.solid_history.slice(-3);
  const historySection = history.length > 0
    ? (face === 'character'
      ? `RECENT EXPERIENCE:\n${history.map(s => `• ${s}`).join('\n')}`
      : `RECENT EDITS:\n${history.map(s => `• ${s}`).join('\n')}`)
    : '';

  const messageLabel = face === 'character' ? 'PLAYER IS THINKING' : face === 'author' ? 'AUTHOR IS ASKING' : 'DESIGNER IS ASKING';
  const messageSection = `${messageLabel}: "${playerMessage}"`;

  const prompt = `${identity}

${role}

${gating}

${style}

${format}

${contextSection}

${charSection}

${historySection}

${messageSection}`;

  return prompt.replace(/{name}/g, name);
}
