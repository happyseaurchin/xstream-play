/**
 * Medium-LLM prompt composition — BSP walks of medium-agent.json.
 *
 * Star references in the agent block's hidden directory name which
 * world blocks to walk. The kernel follows stars via the block store.
 * Runtime data (peers, events, familiarity) stays as kernel code.
 */

import type { Block, GameEvent } from './types';
import { bsp, collectUnderscore } from './bsp';
import type { DirResult, SpindleResult, StarResult, RingResult } from './bsp';
import { getBlock } from './block-store';
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
  const mediumAgent = getBlock('medium-agent');
  if (!mediumAgent) return '';
  const star = bsp(mediumAgent as PscaleNode, 0, '*') as StarResult;
  const sections: string[] = [];

  // Compute present peers early — needed for S×I familiarity gating
  const present = peerBlocks.filter(
    p => p.spatial_address === addr && p.character.id !== block.character.id
  );

  if (star.hidden) {
    for (const key of Object.keys(star.hidden).sort()) {
      const ref = star.hidden[key];
      if (typeof ref !== 'string') continue;

      const worldBlock = getBlock(ref);
      if (!worldBlock) continue;

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

      // Follow star refs at the walk address (room-level hidden directories)
      const spatialStar = bsp(worldBlock as PscaleNode, addr, '*') as StarResult;
      if (spatialStar.hidden) {
        // S×I: knowledge overlay gated by familiarity depth (hidden key "1")
        // Depth 0 = stranger (root only), 1 = introduced, 2+ = known
        const knowledgeOverlay = spatialStar.hidden['1'];
        if (knowledgeOverlay && typeof knowledgeOverlay === 'object') {
          const maxFam = Math.max(0, ...present.map(p => block.familiarity[p.character.id] ?? 0));
          const depthAddr = '1'.repeat(Math.min(maxFam, 2));
          const knowledgeSpindle = bsp(knowledgeOverlay as PscaleNode, depthAddr || 0) as SpindleResult;
          const knowledgeLines = knowledgeSpindle.nodes.map(n => n.text);
          if (knowledgeLines.length > 0) {
            sections.push(`KNOWN ABOUT THIS PLACE:\n${knowledgeLines.map(k => `- ${k}`).join('\n')}`);
          }
        }

        // S×rules: follow block reference (hidden key "3" or any string ref)
        for (const sk of Object.keys(spatialStar.hidden).sort()) {
          const ref = spatialStar.hidden[sk];
          if (typeof ref !== 'string') continue;
          const rulesBlock = getBlock(ref);
          if (!rulesBlock) continue;

          // Spindle at same spatial address → location-specific rules
          const rulesSpindle = bsp(rulesBlock as PscaleNode, addr) as SpindleResult;
          const ruleLines = rulesSpindle.nodes.map(n => n.text);

          // Hidden directory at rules root → universal detail (perception, conflict, time)
          const rulesRootStar = bsp(rulesBlock as PscaleNode, 0, '*') as StarResult;
          if (rulesRootStar.hidden) {
            for (const rk of Object.keys(rulesRootStar.hidden).sort()) {
              const detail = rulesRootStar.hidden[rk];
              if (detail && typeof detail === 'object') ruleLines.push(...flattenNode(detail));
            }
          }

          if (ruleLines.length > 0) {
            sections.push(`RULES IN EFFECT:\n${ruleLines.map(r => `- ${r}`).join('\n')}`);
          }
        }
      }
    }
  }

  // Runtime data: characters present (from peer blocks)
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
  const mediumAgent = getBlock('medium-agent');
  if (!mediumAgent) return '';

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

  // ── Nearby intentions: peer liquid at same location ──
  if (peerBlocks) {
    const nearbyLiquid = peerBlocks
      .filter(p => p.spatial_address === block.spatial_address && p.pending_liquid && p.character.id !== block.character.id)
      .map(p => `- [${p.character.id}] is forming: "${p.pending_liquid}"`);
    if (nearbyLiquid.length > 0) {
      intentSection += `\n\nNEARBY INTENTIONS:\n${nearbyLiquid.join('\n')}`;
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

// ============================================================
// AUTHOR PROMPT — block editing via natural language
// ============================================================

export function buildAuthorPrompt(
  block: Block,
  peerBlocks?: Block[]
): string {
  const name = block.character.name;
  const editTarget = block.edit_target ?? 'spatial-thornkeep';
  const editAddr = block.edit_address ?? block.spatial_address;

  const authorAgent = getBlock('author-agent');
  if (!authorAgent) return '';

  // ── Identity from agent root ──
  const identity = collectUnderscore(authorAgent as PscaleNode)?.replace(/{name}/g, name) ?? '';

  // ── Target block content at edit address ──
  const targetBlock = getBlock(editTarget);
  const contentSections: string[] = [];

  if (targetBlock) {
    // Spindle → context chain (broad to specific)
    const spindle = bsp(targetBlock as PscaleNode, editAddr) as SpindleResult;
    contentSections.push(`TARGET: ${editTarget} at address ${editAddr}`);
    contentSections.push(`CONTEXT CHAIN:\n${spindle.nodes.map(n => `  [${n.pscale}] ${n.text}`).join('\n')}`);

    // Dir → current contents at this address
    const dir = bsp(targetBlock as PscaleNode, editAddr, 'dir') as DirResult;
    if (dir.subtree && typeof dir.subtree === 'object') {
      contentSections.push(`CURRENT CONTENT AT ${editAddr}:\n${JSON.stringify(dir.subtree, null, 2)}`);
    }

    // Ring → siblings (what else is at this level)
    const ring = bsp(targetBlock as PscaleNode, editAddr, 'ring') as RingResult;
    if (ring.siblings.length > 0) {
      const sibs = ring.siblings.map(s => `  [${s.digit}] ${s.text ?? '(branch)'}${s.branch ? ' +' : ''}`);
      contentSections.push(`SIBLINGS:\n${sibs.join('\n')}`);
    }

    // Star → hidden directories at this address
    const star = bsp(targetBlock as PscaleNode, editAddr, '*') as StarResult;
    if (star.hidden) {
      const refs = Object.entries(star.hidden).map(([k, v]) =>
        `  ${k}: ${typeof v === 'string' ? v : '(embedded)'}`
      );
      contentSections.push(`HIDDEN DIRECTORY:\n${refs.join('\n')}`);
    }
  }

  // ── Author's intention ──
  const intention = block.pending_liquid ?? '';

  // ── Nearby author liquid (peers editing same target) ──
  let nearbySection = '';
  if (peerBlocks) {
    const nearbyAuthors = peerBlocks
      .filter(p => p.edit_target === editTarget && p.pending_liquid && p.character.id !== block.character.id)
      .map(p => `- [${p.character.id}] editing at ${p.edit_address ?? '?'}: "${p.pending_liquid}"`);
    if (nearbyAuthors.length > 0) {
      nearbySection = `\nNEARBY AUTHORS:\n${nearbyAuthors.join('\n')}`;
    }
  }

  // ── Rules: dir walk of section 1 ──
  const rulesDir = bsp(authorAgent as PscaleNode, 0.1, 'dir') as DirResult;
  const rulesLines = flattenNode(rulesDir.subtree);
  const rules = rulesLines[0] + '\n' + rulesLines.slice(1).map(l => `- ${l}`).join('\n');

  // ── Produce: dir walk of section 2 ──
  const produceDir = bsp(authorAgent as PscaleNode, 0.2, 'dir') as DirResult;
  const produceLines = flattenNode(produceDir.subtree);
  const produce = produceLines.join('\n');

  // ── Format: spindle of section 3 ──
  const formatResult = bsp(authorAgent as PscaleNode, 0.3) as SpindleResult;
  const format = formatResult.nodes[formatResult.nodes.length - 1]?.text ?? '';

  return `${identity}

${contentSections.join('\n\n')}

AUTHOR'S INTENTION:
${intention}
${nearbySection}

${rules}

${produce}

${format}`.replace(/{name}/g, name);
}

// ============================================================
// DESIGNER PROMPT — system rule changes
// ============================================================

export function buildDesignerPrompt(
  block: Block,
  peerBlocks?: Block[]
): string {
  const name = block.character.name;
  const editTarget = block.edit_target ?? 'rules-thornkeep';
  const editAddr = block.edit_address ?? '0';

  const designerAgent = getBlock('designer-agent');
  if (!designerAgent) return '';

  // ── Identity from agent root ──
  const identity = collectUnderscore(designerAgent as PscaleNode)?.replace(/{name}/g, name) ?? '';

  // ── Show all star-referenced system blocks ──
  const star = bsp(designerAgent as PscaleNode, 0, '*') as StarResult;
  const contentSections: string[] = [];

  if (star.hidden) {
    for (const key of Object.keys(star.hidden).sort()) {
      const ref = star.hidden[key];
      if (typeof ref !== 'string') continue;
      const sysBlock = getBlock(ref);
      if (!sysBlock) continue;

      // Show block overview: root identity + section summaries
      const blockIdentity = collectUnderscore(sysBlock as PscaleNode) ?? ref;
      const dir = bsp(sysBlock as PscaleNode, editAddr, 'dir') as DirResult;
      contentSections.push(`SYSTEM BLOCK "${ref}":\n  ${blockIdentity}\n  Content at ${editAddr}: ${dir.subtree ? JSON.stringify(dir.subtree, null, 2).slice(0, 500) : '(none)'}`);
    }
  }

  // ── Target block detail (the one being edited) ──
  const targetBlock = getBlock(editTarget);
  if (targetBlock) {
    const spindle = bsp(targetBlock as PscaleNode, editAddr) as SpindleResult;
    contentSections.push(`EDIT TARGET: ${editTarget} at address ${editAddr}\nCONTEXT CHAIN:\n${spindle.nodes.map(n => `  [${n.pscale}] ${n.text}`).join('\n')}`);

    const dir = bsp(targetBlock as PscaleNode, editAddr, 'dir') as DirResult;
    if (dir.subtree && typeof dir.subtree === 'object') {
      contentSections.push(`CURRENT CONTENT:\n${JSON.stringify(dir.subtree, null, 2)}`);
    }
  }

  // ── Designer's intention ──
  const intention = block.pending_liquid ?? '';

  // ── Rules: dir walk of section 1 ──
  const rulesDir = bsp(designerAgent as PscaleNode, 0.1, 'dir') as DirResult;
  const rulesLines = flattenNode(rulesDir.subtree);
  const rules = rulesLines[0] + '\n' + rulesLines.slice(1).map(l => `- ${l}`).join('\n');

  // ── Produce: dir walk of section 2 ──
  const produceDir = bsp(designerAgent as PscaleNode, 0.2, 'dir') as DirResult;
  const produceLines = flattenNode(produceDir.subtree);
  const produce = produceLines.join('\n');

  // ── Format: spindle of section 3 ──
  const formatResult = bsp(designerAgent as PscaleNode, 0.3) as SpindleResult;
  const format = formatResult.nodes[formatResult.nodes.length - 1]?.text ?? '';

  return `${identity}

${contentSections.join('\n\n')}

DESIGNER'S INTENTION:
${intention}

${rules}

${produce}

${format}`.replace(/{name}/g, name);
}
