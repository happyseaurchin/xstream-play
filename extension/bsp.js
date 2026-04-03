/**
 * bsp.js — pure-form BSP for pscale JSON blocks.
 *
 * Ported from pscale/starstone/bsp-star.py — the canonical reference.
 * No tree wrapper, no metadata. The block IS the tree.
 * Floor derived from the underscore chain. Digit 0 maps to key '_'.
 *
 * Modes:
 *   bsp(block)                    → dir: full tree
 *   bsp(block, number)            → spindle: root-to-target chain
 *   bsp(block, number, 'ring')    → ring: siblings at terminal
 *   bsp(block, number, 'dir')     → dir: subtree from target
 *   bsp(block, number, '*')       → star: hidden directory at terminal
 *   bsp(block, _, depth, 'disc')  → disc: all nodes at a depth
 *   bsp(block, number, ps, 'point') → point: single node at pscale
 */

function collectUnderscore(node) {
  if (typeof node !== 'object' || node === null || !('_' in node)) return null;
  const val = node._;
  if (typeof val === 'string') return val;
  if (typeof val === 'object' && val !== null) {
    if ('_' in val) return collectUnderscore(val);
    return null; // zero-position interior
  }
  return null;
}

function findHiddenLevel(node) {
  if (typeof node !== 'object' || node === null || !('_' in node)) return null;
  let current = node._;
  if (typeof current !== 'object' || current === null) return null;
  while (typeof current === 'object' && current !== null) {
    for (const k of '123456789') {
      if (k in current) return current;
    }
    if ('_' in current && typeof current._ === 'object') {
      current = current._;
    } else {
      break;
    }
  }
  return null;
}

function getHiddenDirectory(node) {
  const level = findHiddenLevel(node);
  if (!level) return null;
  const result = {};
  for (const k of '123456789') {
    if (k in level) result[k] = level[k];
  }
  return Object.keys(result).length > 0 ? result : null;
}

function floorDepth(block) {
  let node = block;
  let depth = 0;
  while (typeof node === 'object' && node !== null && '_' in node) {
    depth++;
    node = node._;
    if (typeof node === 'string') return depth;
  }
  return depth;
}

function parseAddress(number) {
  const s = String(number);
  const [integer = '0', frac = ''] = s.split('.');
  const cleaned = frac.replace(/0+$/, '');
  if (integer === '0') return [...cleaned]; // address 0 → empty array (stay at root)
  return [...(integer + cleaned)];
}

function walk(block, digits) {
  const chain = [];
  let node = block;
  let parent = null;
  let lastKey = null;
  let depth = 0;

  const rootText = collectUnderscore(node);
  if (rootText !== null) chain.push({ text: rootText, depth });

  for (const d of digits) {
    const key = d === '0' ? '_' : d;
    if (typeof node !== 'object' || node === null || !(key in node)) break;
    const target = node[key];
    if (d === '0' && typeof target === 'string') break;
    parent = node;
    lastKey = key;
    node = target;
    depth++;
    if (typeof node === 'string') {
      chain.push({ text: node, depth });
      break;
    } else if (typeof node === 'object' && node !== null) {
      const text = collectUnderscore(node);
      if (text !== null) chain.push({ text, depth });
    }
  }

  return { chain, terminal: node, parent, lastKey };
}

function bsp(block, number, point, mode) {
  const fl = floorDepth(block);

  // Dir (full) — no args
  if (number == null && point == null && mode == null) {
    return { mode: 'dir', tree: block };
  }

  // Disc
  if (mode === 'disc' && point != null) {
    const target = typeof point === 'string' ? parseInt(point) : point;
    const nodes = [];
    function collect(node, depth, path) {
      if (depth === target) {
        let text = null;
        if (typeof node === 'string') text = node;
        else if (typeof node === 'object' && node !== null) {
          let inner = node._ || null;
          while (typeof inner === 'object' && inner !== null && '_' in inner) inner = inner._;
          if (typeof inner === 'string') text = inner;
        }
        nodes.push({ path, text });
        return;
      }
      if (typeof node !== 'object' || node === null) return;
      if ('_' in node && typeof node._ === 'object') {
        collect(node._, depth + 1, path ? path + '.0' : '0');
      }
      for (const d of '123456789') {
        if (d in node) collect(node[d], depth + 1, path ? path + '.' + d : d);
      }
    }
    collect(block, 0, '');
    return { mode: 'disc', depth: target, nodes };
  }

  // Parse address and walk
  const digits = parseAddress(number);
  const { chain, terminal, parent, lastKey } = walk(block, digits);

  // Star — hidden directory at terminal
  if (point === '*') {
    const hd = typeof terminal === 'object' ? getHiddenDirectory(terminal) : null;
    const semantic = typeof terminal === 'object' ? collectUnderscore(terminal) : null;
    return { mode: 'star', address: String(number), semantic, hidden: hd };
  }

  // Ring — siblings at terminal
  if (point === 'ring') {
    if (!parent || typeof parent !== 'object') return { mode: 'ring', siblings: [] };
    const siblings = [];
    if (lastKey !== '_' && '_' in parent && typeof parent._ === 'object') {
      siblings.push({ digit: '0', text: collectUnderscore(parent), branch: true });
    }
    for (const d of '123456789') {
      if (d === lastKey || !(d in parent)) continue;
      const v = parent[d];
      const text = typeof v === 'string' ? v : collectUnderscore(v);
      siblings.push({ digit: d, text, branch: typeof v === 'object' });
    }
    return { mode: 'ring', siblings };
  }

  // Dir (subtree)
  if (point === 'dir') return { mode: 'dir', subtree: terminal };

  // pscale annotation
  const pscaleAt = (depth) => (fl - 1) - depth;

  // Point
  if (mode === 'point' && point != null) {
    const ps = typeof point === 'string' ? parseInt(point) : point;
    for (const entry of chain) {
      if (pscaleAt(entry.depth) === ps) return { mode: 'point', pscale: ps, text: entry.text };
    }
    const last = chain[chain.length - 1];
    return { mode: 'point', pscale: ps, text: last ? last.text : null };
  }

  // Spindle (default)
  const nodes = chain.map(entry => ({ pscale: pscaleAt(entry.depth), text: entry.text }));
  return { mode: 'spindle', nodes };
}

export { bsp, collectUnderscore, getHiddenDirectory };
