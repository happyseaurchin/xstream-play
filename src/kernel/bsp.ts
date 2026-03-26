/**
 * bsp.ts — pure-form BSP for pscale JSON blocks.
 *
 * Ported from https://github.com/pscale-commons/pscale/blob/main/bsp.js
 *
 * No tree wrapper, no tuning field, no metadata. The block IS the tree.
 * Floor derived from the underscore chain. Digit 0 maps to key '_'.
 *
 * Address conventions:
 *   0.x     Delineation (floor 1). Leading 0 is notation, not a key.
 *   100     Accumulation (floor 3). Digit 1 at top level, zeros = no branch taken.
 *   001.1   Floor 3. Two zeros walk underscore chain to floor, then digits below.
 *   Digit 0 always maps to key '_' — walking the underscore spine.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PscaleNode = string | { [key: string]: any };
type PscaleBlock = Record<string, PscaleNode>;

interface ChainEntry {
  text: string;
  depth: number;
}

interface WalkResult {
  chain: ChainEntry[];
  terminal: PscaleNode;
  parent: PscaleBlock | null;
  lastKey: string | null;
}

export interface SpindleResult {
  mode: 'spindle';
  nodes: { pscale: number; text: string }[];
}

export interface RingResult {
  mode: 'ring';
  siblings: { digit: string; text: string | null; branch: boolean }[];
}

export interface DirResult {
  mode: 'dir';
  tree?: PscaleNode;
  subtree?: PscaleNode;
}

export interface PointResult {
  mode: 'point';
  pscale: number;
  text: string | null;
}

export interface DiscResult {
  mode: 'disc';
  depth: number;
  nodes: { path: string; text: string | null }[];
}

type BspResult = SpindleResult | RingResult | DirResult | PointResult | DiscResult;

function floorDepth(block: PscaleNode): number {
  let node = block;
  let depth = 0;
  while (node && typeof node === 'object' && '_' in node) {
    depth++;
    node = (node as PscaleBlock)._;
    if (typeof node === 'string') return depth;
  }
  return depth;
}

function parseAddress(number: number | string): string[] {
  const s = typeof number === 'number' ? number.toFixed(10) : String(number);
  const [integer = '0', frac = ''] = s.split('.');
  const cleaned = frac.replace(/0+$/, '');
  if (integer === '0') return [...cleaned];
  return [...(integer + cleaned)];
}

function walk(block: PscaleNode, digits: string[]): WalkResult {
  const chain: ChainEntry[] = [];
  let node: PscaleNode = block;
  let parent: PscaleBlock | null = null;
  let lastKey: string | null = null;
  const depth = 0;

  // Collect root text: follow underscore chain to the floor string.
  if (node && typeof node === 'object' && '_' in node) {
    let inner: PscaleNode = (node as PscaleBlock)._;
    while (inner && typeof inner === 'object' && '_' in inner) inner = (inner as PscaleBlock)._;
    if (typeof inner === 'string') chain.push({ text: inner, depth });
  }

  let currentDepth = 0;
  for (const d of digits) {
    const key = d === '0' ? '_' : d;
    if (!node || typeof node !== 'object' || !(key in (node as PscaleBlock))) break;
    const target = (node as PscaleBlock)[key];
    // Walking '0' into a string '_' means we've hit the floor spine
    if (d === '0' && typeof target === 'string') break;
    parent = node as PscaleBlock;
    lastKey = key;
    node = target;
    currentDepth++;
    if (typeof node === 'string') {
      chain.push({ text: node, depth: currentDepth });
      break;
    }
    if (node && typeof node === 'object' && typeof (node as PscaleBlock)._ === 'string') {
      chain.push({ text: (node as PscaleBlock)._ as string, depth: currentDepth });
    }
  }

  return { chain, terminal: node, parent, lastKey };
}

export function bsp(
  block: PscaleNode,
  number?: number | string | null,
  point?: string | number | null,
  mode?: string | null
): BspResult {
  const fl = floorDepth(block);

  // Dir (full)
  if (number == null && point == null && mode == null) {
    return { mode: 'dir', tree: block };
  }

  // Disc
  if (mode === 'disc' && point != null) {
    const target = typeof point === 'string' ? parseInt(point) : point as number;
    const nodes: { path: string; text: string | null }[] = [];
    (function collect(node: PscaleNode, depth: number, path: string) {
      if (depth === target) {
        let text: string | null;
        if (typeof node === 'string') {
          text = node;
        } else if (node && typeof node === 'object') {
          let inner: PscaleNode = (node as PscaleBlock)._;
          while (inner && typeof inner === 'object' && '_' in inner) inner = (inner as PscaleBlock)._;
          text = typeof inner === 'string' ? inner : null;
        } else {
          text = null;
        }
        nodes.push({ path, text });
        return;
      }
      if (!node || typeof node !== 'object') return;
      if ('_' in (node as PscaleBlock) && typeof (node as PscaleBlock)._ === 'object') {
        collect((node as PscaleBlock)._, depth + 1, path ? `${path}.0` : '0');
      }
      for (let d = 1; d <= 9; d++) {
        const k = String(d);
        if (k in (node as PscaleBlock)) collect((node as PscaleBlock)[k], depth + 1, path ? `${path}.${k}` : k);
      }
    })(block, 0, '');
    return { mode: 'disc', depth: target, nodes };
  }

  const digits = parseAddress(number as number | string);
  const { chain, terminal, parent, lastKey } = walk(block, digits);

  function pscaleAt(depth: number): number {
    return (fl - 1) - depth;
  }

  // Ring
  if (point === 'ring') {
    if (!parent || typeof parent !== 'object') return { mode: 'ring', siblings: [] };
    const siblings: { digit: string; text: string | null; branch: boolean }[] = [];
    if (lastKey !== '_' && '_' in parent && typeof parent._ === 'object') {
      let inner: PscaleNode = parent._;
      while (inner && typeof inner === 'object' && '_' in inner && typeof (inner as PscaleBlock)._ === 'object') {
        inner = (inner as PscaleBlock)._;
      }
      const text = inner && typeof inner === 'object' && typeof (inner as PscaleBlock)._ === 'string'
        ? (inner as PscaleBlock)._ as string
        : null;
      siblings.push({ digit: '0', text, branch: true });
    }
    for (let d = 1; d <= 9; d++) {
      const k = String(d);
      if (k === lastKey || !(k in parent)) continue;
      const v = parent[k];
      const text = typeof v === 'string' ? v : (v && typeof v === 'object' && typeof (v as PscaleBlock)._ === 'string' ? (v as PscaleBlock)._ as string : null);
      siblings.push({ digit: k, text, branch: typeof v === 'object' });
    }
    return { mode: 'ring', siblings };
  }

  // Dir (subtree)
  if (point === 'dir') {
    return { mode: 'dir', subtree: terminal };
  }

  // Point
  if (mode === 'point' && point != null) {
    const ps = typeof point === 'string' ? parseInt(point) : point as number;
    for (const entry of chain) {
      if (pscaleAt(entry.depth) === ps) {
        return { mode: 'point', pscale: ps, text: entry.text };
      }
    }
    const last = chain[chain.length - 1];
    return { mode: 'point', pscale: ps, text: last ? last.text : null };
  }

  // Spindle (default)
  return {
    mode: 'spindle',
    nodes: chain.map(entry => ({ pscale: pscaleAt(entry.depth), text: entry.text })),
  };
}
