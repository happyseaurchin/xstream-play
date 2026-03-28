/**
 * Hard-LLM — the world reader and frame builder.
 *
 * Walks world blocks via BSP, composes a perception prompt,
 * calls the LLM, returns a structured Frame.
 *
 * Hard is the external-to-internal translator: BSP addresses
 * (external structure) become context window content (internal experience).
 * It never invents — it extracts from blocks and events at S × T × I.
 */

import type { Block, Frame, GameEvent } from './types';
import { bsp } from './bsp';
import type { SpindleResult, RingResult, DirResult } from './bsp';
import { callClaude } from './claude-direct';
import hardAgent from '../../blocks/xstream/hard-agent.json';
import spatialThornkeep from '../../blocks/xstream/spatial-thornkeep.json';
import rulesThornkeep from '../../blocks/xstream/rules-thornkeep.json';

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
 * Build the Hard-LLM system instructions from hard-agent.json via BSP.
 */
function buildHardSystem(name: string): string {
  // Walk the entire block — role + rules + schema + format
  const lines = flattenNode(hardAgent);
  return lines.join('\n').replace(/{name}/g, name);
}

/**
 * Query 1: Spatial spindle — where you are, broad to specific.
 */
function querySpatialSpindle(addr: string): string {
  const result = bsp(spatialThornkeep as PscaleNode, addr) as SpindleResult;
  return result.nodes.map(n => n.text).join('\n');
}

/**
 * Query 2: Room contents — what's in this space.
 */
function queryRoomContents(addr: string): string {
  const result = bsp(spatialThornkeep as PscaleNode, addr, 'dir') as DirResult;
  if (!result.subtree) return 'Nothing notable.';
  const lines = flattenNode(result.subtree);
  // First line is the room description (already in spindle), skip it
  return lines.slice(1).join('\n') || 'Nothing notable.';
}

/**
 * Query 3: Adjacent spaces — what's nearby (exits).
 */
function queryAdjacentSpaces(addr: string): string {
  const result = bsp(spatialThornkeep as PscaleNode, addr, 'ring') as RingResult;
  if (result.siblings.length === 0) return 'No obvious exits.';
  return result.siblings
    .map(s => `[${s.digit}] ${s.text ?? '(unexplored)'}`)
    .join('\n');
}

/**
 * Query 4: Applicable rules — constraints at this location.
 * Includes location-specific norms + perception rules (always relevant).
 */
function queryRules(addr: string): string {
  const sections: string[] = [];

  // Location-specific norms: map spatial prefix to rules section 1
  // Spatial 11x = Salted Dog → rules 0.11
  // Spatial 12x = harbour road → rules 0.12
  // Spatial 13x = guard station → rules 0.12 (village norms)
  const spatialPrefix = addr.slice(0, 2);
  if (spatialPrefix === '11') {
    const norms = bsp(rulesThornkeep as PscaleNode, 0.11, 'dir') as DirResult;
    if (norms.subtree) sections.push(...flattenNode(norms.subtree));
  } else if (spatialPrefix === '12' || spatialPrefix === '13') {
    const norms = bsp(rulesThornkeep as PscaleNode, 0.12, 'dir') as DirResult;
    if (norms.subtree) sections.push(...flattenNode(norms.subtree));
  }
  // Dangerous terrain for headland/cliffs
  if (addr.startsWith('2') || spatialPrefix === '12') {
    const terrain = bsp(rulesThornkeep as PscaleNode, 0.13, 'dir') as DirResult;
    if (terrain.subtree) sections.push(...flattenNode(terrain.subtree));
  }

  // Perception rules — always relevant
  const perception = bsp(rulesThornkeep as PscaleNode, 0.3, 'dir') as DirResult;
  if (perception.subtree) sections.push(...flattenNode(perception.subtree));

  return sections.join('\n') || 'No specific rules.';
}

/**
 * Query 5: Recent events at this location.
 * Filters own event_log + peer event_logs for events at current S.
 */
function queryRecentEvents(
  block: Block,
  peerBlocks: Block[],
  addr: string
): string {
  // Collect events from own log and peer logs at this address
  const allEvents: GameEvent[] = [];

  // Own events
  for (const e of block.event_log) {
    if (e.S === addr) allEvents.push(e);
  }

  // Peer events at this location
  for (const peer of peerBlocks) {
    if (!peer.event_log) continue;
    for (const e of peer.event_log) {
      if (e.S === addr) allEvents.push(e);
    }
  }

  // Sort by T descending, take most recent 15
  allEvents.sort((a, b) => b.T - a.T);
  const recent = allEvents.slice(0, 15);

  if (recent.length === 0) return 'No recent events at this location.';
  return recent.map(e => `[${e.type}] ${e.text}`).join('\n');
}

/**
 * Build the CHARACTERS PRESENT section.
 * Familiarity gates what information is included.
 */
function queryCharactersPresent(
  block: Block,
  peerBlocks: Block[]
): string {
  const addr = block.spatial_address;
  const present = peerBlocks.filter(
    p => p.spatial_address === addr && p.character.id !== block.character.id
  );

  if (present.length === 0) return 'No other characters present.';

  return present.map(peer => {
    const peerId = peer.character.id;
    const fam = block.familiarity[peerId] ?? 0;
    const name = peer.character.name;
    const state = peer.character.state;

    // Recent activity from their outbox
    const activity = peer.outbox?.events?.slice(-2).join('. ') || 'present, no recent action';

    if (fam === 0) {
      // Appearance only — no name
      return `- [id: ${peerId}] ${state}. Currently: ${activity}. (familiarity: 0, stranger)`;
    } else if (fam === 1) {
      // Name + appearance
      return `- [id: ${peerId}] ${name}. ${state}. Currently: ${activity}. (familiarity: 1, introduced)`;
    } else {
      // Name + known traits
      return `- [id: ${peerId}] ${name}. ${state}. Currently: ${activity}. (familiarity: ${fam}, known)`;
    }
  }).join('\n');
}

/**
 * Run the Hard-LLM: walk world blocks, call LLM, return Frame.
 */
export async function runHard(
  block: Block,
  peerBlocks: Block[]
): Promise<Frame> {
  const name = block.character.name;
  const addr = block.spatial_address;

  // Build system instructions from hard-agent.json
  const system = buildHardSystem(name);

  // Compose user message from five BSP queries
  const userMessage = `CHARACTER: ${name} at spatial address ${addr}

SPATIAL SPINDLE (where you are — broad to specific):
${querySpatialSpindle(addr)}

ROOM CONTENTS (what's in this space):
${queryRoomContents(addr)}

ADJACENT SPACES (what's nearby):
${queryAdjacentSpaces(addr)}

APPLICABLE RULES (what constrains action here):
${queryRules(addr)}

RECENT EVENTS AT THIS LOCATION:
${queryRecentEvents(block, peerBlocks, addr)}

CHARACTERS PRESENT:
${queryCharactersPresent(block, peerBlocks)}

Produce the frame as JSON matching the schema in your instructions.`;

  // Full prompt = system + user (callClaude sends as single user message)
  const prompt = `${system}\n\n---\n\n${userMessage}`;

  try {
    const text = await callClaude(
      block.medium.api_key,
      'claude-haiku-4-5-20251001',  // Hard uses Haiku — structured extraction
      prompt,
      2048
    );

    // Parse JSON from response — strip markdown fences if present
    const cleaned = text.trim()
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();

    const frame = JSON.parse(cleaned) as Frame;

    // Validate minimum structure
    if (!frame.location || !Array.isArray(frame.visible)) {
      throw new Error('Frame missing required fields');
    }

    // Ensure arrays exist
    frame.visible = frame.visible ?? [];
    frame.audible = frame.audible ?? [];
    frame.characters_present = frame.characters_present ?? [];
    frame.recent_traces = frame.recent_traces ?? [];
    frame.applicable_rules = frame.applicable_rules ?? [];
    frame.exits = frame.exits ?? [];

    return frame;
  } catch (e) {
    console.error('[hard] Frame build failed:', e);
    // Return a minimal fallback frame from spatial data alone
    return buildFallbackFrame(addr);
  }
}

/**
 * Fallback frame from spatial data when LLM call fails.
 * Pure BSP extraction, no LLM.
 */
function buildFallbackFrame(addr: string): Frame {
  const spindle = bsp(spatialThornkeep as PscaleNode, addr) as SpindleResult;
  const location = spindle.nodes.map(n => n.text).join(' — ');

  const dir = bsp(spatialThornkeep as PscaleNode, addr, 'dir') as DirResult;
  const contents = dir.subtree ? flattenNode(dir.subtree).slice(1) : [];

  const ring = bsp(spatialThornkeep as PscaleNode, addr, 'ring') as RingResult;
  const exits = ring.siblings.map(s => ({
    direction: s.text ?? `exit ${s.digit}`,
    description: s.text ?? '',
    spatial_address: addr.slice(0, -1) + s.digit,
  }));

  return {
    location,
    visible: contents.length > 0 ? contents : ['Nothing notable.'],
    audible: [],
    atmosphere: 'No atmosphere data available.',
    characters_present: [],
    recent_traces: [],
    applicable_rules: [],
    exits,
  };
}
