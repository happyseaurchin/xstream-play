/**
 * Perception — build a pscale block from BSP walks of world blocks.
 *
 * No LLM call. Pure mechanical extraction. The block structure
 * carries the semantics. Medium and Soft walk this block via BSP.
 *
 * The perception block shape:
 *   _   = location spindle (broad to specific)
 *   1   = visible (room contents from spatial dir walk)
 *   2   = characters present (from peer blocks at same address)
 *   3   = exits (from spatial ring walk, with BSP addresses)
 *   4   = rules in effect (from rules block at this location)
 *   5   = recent events (from event_log filtered by address)
 */

import type { Block, GameEvent } from './types';
import { bsp } from './bsp';
import type { SpindleResult, RingResult, DirResult } from './bsp';
import spatialThornkeep from '../../blocks/xstream/spatial-thornkeep.json';
import rulesThornkeep from '../../blocks/xstream/rules-thornkeep.json';

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
 * Build a perception pscale block for a character at their current address.
 * Both Medium and Soft walk this block — different addresses, different views.
 */
export function buildPerception(
  block: Block,
  peerBlocks: Block[]
): Record<string, unknown> {
  const addr = block.spatial_address;

  // ── Location: spindle walk → broad to specific ──
  const spindle = bsp(spatialThornkeep as PscaleNode, addr) as SpindleResult;
  const location = spindle.nodes.map(n => n.text).join(' — ');

  // ── Visible: dir walk → room contents ──
  const dir = bsp(spatialThornkeep as PscaleNode, addr, 'dir') as DirResult;
  const contents = dir.subtree ? flattenNode(dir.subtree).slice(1) : [];
  const visible: Record<string, string> = { _: 'Visible.' };
  contents.forEach((item, i) => { visible[String(i + 1)] = item; });

  // ── Characters present: peers at same spatial address ──
  const present = peerBlocks.filter(
    p => p.spatial_address === addr && p.character.id !== block.character.id
  );
  const chars: Record<string, string> = { _: 'Characters present.' };
  if (present.length === 0) {
    chars['1'] = 'No other characters present.';
  } else {
    present.forEach((peer, i) => {
      const peerId = peer.character.id;
      const fam = block.familiarity[peerId] ?? 0;
      const name = peer.character.name;
      const state = peer.character.state;
      const activity = peer.outbox?.events?.slice(-2).join('. ') || 'present, no recent action';

      if (fam === 0) {
        chars[String(i + 1)] = `[id: ${peerId}] ${state}. Currently: ${activity}. (stranger)`;
      } else if (fam === 1) {
        chars[String(i + 1)] = `[id: ${peerId}] ${name}. ${state}. Currently: ${activity}. (introduced)`;
      } else {
        chars[String(i + 1)] = `[id: ${peerId}] ${name}. ${state}. Currently: ${activity}. (known)`;
      }
    });
  }

  // ── Exits: ring walk → siblings with BSP addresses ──
  const ring = bsp(spatialThornkeep as PscaleNode, addr, 'ring') as RingResult;
  const exits: Record<string, string> = { _: 'Exits.' };
  if (ring.siblings.length === 0) {
    exits['1'] = 'No obvious exits.';
  } else {
    ring.siblings.forEach((s, i) => {
      const exitAddr = addr.slice(0, -1) + s.digit;
      exits[String(i + 1)] = `[${exitAddr}] ${s.text ?? 'unexplored'}`;
    });
  }

  // ── Rules: location-specific norms + perception rules ──
  const ruleLines: string[] = [];
  const spatialPrefix = addr.slice(0, 2);
  if (spatialPrefix === '11') {
    const norms = bsp(rulesThornkeep as PscaleNode, 0.11, 'dir') as DirResult;
    if (norms.subtree) ruleLines.push(...flattenNode(norms.subtree));
  } else if (spatialPrefix === '12' || spatialPrefix === '13') {
    const norms = bsp(rulesThornkeep as PscaleNode, 0.12, 'dir') as DirResult;
    if (norms.subtree) ruleLines.push(...flattenNode(norms.subtree));
  }
  if (addr.startsWith('2') || spatialPrefix === '12') {
    const terrain = bsp(rulesThornkeep as PscaleNode, 0.13, 'dir') as DirResult;
    if (terrain.subtree) ruleLines.push(...flattenNode(terrain.subtree));
  }
  const perceptionRules = bsp(rulesThornkeep as PscaleNode, 0.3, 'dir') as DirResult;
  if (perceptionRules.subtree) ruleLines.push(...flattenNode(perceptionRules.subtree));
  const rules: Record<string, string> = { _: 'Rules in effect.' };
  ruleLines.forEach((line, i) => { rules[String(i + 1)] = line; });

  // ── Recent events at this location ──
  const allEvents: GameEvent[] = [];
  for (const e of block.event_log) {
    if (e.S === addr) allEvents.push(e);
  }
  for (const peer of peerBlocks) {
    if (!peer.event_log) continue;
    for (const e of peer.event_log) {
      if (e.S === addr) allEvents.push(e);
    }
  }
  allEvents.sort((a, b) => b.T - a.T);
  const recent = allEvents.slice(0, 15);
  const events: Record<string, string> = { _: 'Recent events.' };
  if (recent.length === 0) {
    events['1'] = 'No recent events at this location.';
  } else {
    recent.forEach((e, i) => { events[String(i + 1)] = `[${e.type}] ${e.text}`; });
  }

  return {
    _: location,
    1: visible,
    2: chars,
    3: exits,
    4: rules,
    5: events,
  };
}
