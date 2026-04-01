#!/usr/bin/env node
/**
 * BSP CLI navigator — walks pscale JSON blocks from the command line.
 * Same logic as bsp.ts, same blocks as block-store.ts.
 *
 * Usage:
 *   node test-bsp.mjs spatial-thornkeep 111          # spindle
 *   node test-bsp.mjs spatial-thornkeep 111 ring     # ring (exits)
 *   node test-bsp.mjs spatial-thornkeep 111 dir      # subtree
 *   node test-bsp.mjs spatial-thornkeep 111 '*'      # star (hidden dir)
 *   node test-bsp.mjs medium-agent 0 '*'             # star refs from agent
 *   node test-bsp.mjs medium-agent 0.1 dir           # rules section
 *   node test-bsp.mjs                                # list all blocks
 */

import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BLOCKS_DIR = join(__dirname, 'blocks/xstream');

// ── Load blocks ──
const blocks = {};
for (const file of readdirSync(BLOCKS_DIR).filter(f => f.endsWith('.json'))) {
  const name = file.replace('.json', '');
  blocks[name] = JSON.parse(readFileSync(join(BLOCKS_DIR, file), 'utf-8'));
}

// ── BSP core (mirrors bsp.ts) ──

function collectUnderscore(node) {
  if (!node || typeof node !== 'object' || !('_' in node)) return null;
  const val = node._;
  if (typeof val === 'string') return val;
  if (val && typeof val === 'object' && '_' in val) return collectUnderscore(val);
  return null;
}

function findHiddenLevel(node) {
  if (!node || typeof node !== 'object' || !('_' in node)) return null;
  const val = node._;
  if (!val || typeof val !== 'object') return null;
  let current = val;
  while (current && typeof current === 'object') {
    if ('123456789'.split('').some(k => k in current)) return current;
    if ('_' in current && current._ && typeof current._ === 'object') {
      current = current._;
    } else break;
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
  let node = block, depth = 0;
  while (node && typeof node === 'object' && '_' in node) {
    depth++;
    node = node._;
    if (typeof node === 'string') return depth;
  }
  return depth;
}

function parseAddress(number) {
  const s = typeof number === 'number' ? number.toFixed(10) : String(number);
  const [integer = '0', frac = ''] = s.split('.');
  const cleaned = frac.replace(/0+$/, '');
  if (integer === '0') return [...cleaned];
  return [...(integer + cleaned)];
}

function walk(block, digits) {
  const chain = [];
  let node = block, parent = null, lastKey = null, currentDepth = 0;
  const rootText = collectUnderscore(node);
  if (rootText !== null) chain.push({ text: rootText, depth: 0 });
  for (const d of digits) {
    const key = d === '0' ? '_' : d;
    if (!node || typeof node !== 'object' || !(key in node)) break;
    const target = node[key];
    if (d === '0' && typeof target === 'string') break;
    parent = node; lastKey = key; node = target; currentDepth++;
    if (typeof node === 'string') { chain.push({ text: node, depth: currentDepth }); break; }
    const text = collectUnderscore(node);
    if (text !== null) chain.push({ text, depth: currentDepth });
  }
  return { chain, terminal: node, parent, lastKey };
}

function bsp(block, number, point, mode) {
  const fl = floorDepth(block);
  if (number == null && point == null && mode == null) return { mode: 'dir', tree: block };

  if (mode === 'disc' && point != null) {
    const target = typeof point === 'string' ? parseInt(point) : point;
    const nodes = [];
    (function collect(node, depth, path) {
      if (depth === target) {
        let text = null;
        if (typeof node === 'string') text = node;
        else if (node && typeof node === 'object') {
          let inner = node._;
          while (inner && typeof inner === 'object' && '_' in inner) inner = inner._;
          text = typeof inner === 'string' ? inner : null;
        }
        nodes.push({ path, text });
        return;
      }
      if (!node || typeof node !== 'object') return;
      if ('_' in node && typeof node._ === 'object') collect(node._, depth + 1, path ? `${path}.0` : '0');
      for (let d = 1; d <= 9; d++) {
        const k = String(d);
        if (k in node) collect(node[k], depth + 1, path ? `${path}.${k}` : k);
      }
    })(block, 0, '');
    return { mode: 'disc', depth: target, nodes };
  }

  const digits = parseAddress(number);
  const { chain, terminal, parent, lastKey } = walk(block, digits);
  const pscaleAt = (depth) => (fl - 1) - depth;

  if (point === '*') {
    const hd = getHiddenDirectory(terminal);
    const semantic = (typeof terminal === 'object') ? collectUnderscore(terminal) : null;
    return { mode: 'star', address: String(number), semantic, hidden: hd };
  }

  if (point === 'ring') {
    if (!parent || typeof parent !== 'object') return { mode: 'ring', siblings: [] };
    const siblings = [];
    if (lastKey !== '_' && '_' in parent && typeof parent._ === 'object') {
      siblings.push({ digit: '0', text: collectUnderscore(parent), branch: true });
    }
    for (let d = 1; d <= 9; d++) {
      const k = String(d);
      if (k === lastKey || !(k in parent)) continue;
      const v = parent[k];
      const text = typeof v === 'string' ? v : collectUnderscore(v);
      siblings.push({ digit: k, text, branch: typeof v === 'object' });
    }
    return { mode: 'ring', siblings };
  }

  if (point === 'dir') return { mode: 'dir', subtree: terminal };

  if (mode === 'point' && point != null) {
    const ps = typeof point === 'string' ? parseInt(point) : point;
    for (const entry of chain) {
      if (pscaleAt(entry.depth) === ps) return { mode: 'point', pscale: ps, text: entry.text };
    }
    const last = chain[chain.length - 1];
    return { mode: 'point', pscale: ps, text: last ? last.text : null };
  }

  return { mode: 'spindle', nodes: chain.map(e => ({ pscale: pscaleAt(e.depth), text: e.text })) };
}

// ── CLI ──

function truncate(s, max = 150) {
  if (!s) return '(none)';
  return s.length > max ? s.slice(0, max) + '...' : s;
}

const args = process.argv.slice(2);

if (args.length === 0) {
  console.log('Available blocks:');
  for (const name of Object.keys(blocks).sort()) {
    const fl = floorDepth(blocks[name]);
    const us = collectUnderscore(blocks[name]);
    console.log(`  ${name}  (floor ${fl})  ${truncate(us, 80)}`);
  }
  console.log(`\nUsage: node test-bsp.mjs <block> [address] [mode]`);
  console.log(`Modes: (default=spindle), ring, dir, *, point, disc`);
  process.exit(0);
}

const blockName = args[0];
const block = blocks[blockName];
if (!block) { console.error(`Block not found: ${blockName}`); process.exit(1); }

let number = args[1] != null ? (args[1] === '_' ? null : isNaN(+args[1]) ? args[1] : +args[1]) : undefined;
let point = null, mode = null;

if (args[2]) {
  const a = args[2];
  if (a === 'ring' || a === 'dir' || a === '*') point = a;
  else if (a === 'disc') mode = 'disc';
  else if (!isNaN(+a)) point = +a;
  else point = a;
}
if (args[3]) {
  if (args[3] === 'point' || args[3] === 'disc') mode = args[3];
}

if (number === undefined) {
  // No address — show dir
  const result = bsp(block);
  console.log(`[${blockName} dir]`);
  const root = block._ ;
  if (typeof root === 'string') console.log(`  _: ${truncate(root)}`);
  else if (root && typeof root === 'object') console.log(`  _: ${truncate(collectUnderscore(block))}`);
  for (const k of Object.keys(block).filter(k => k !== '_').sort()) {
    const v = block[k];
    const text = typeof v === 'string' ? v : collectUnderscore(v);
    console.log(`  ${k}: ${truncate(text)}`);
  }
  process.exit(0);
}

const result = bsp(block, number, point, mode);

switch (result.mode) {
  case 'spindle':
    console.log(`[${blockName} ${number}] spindle`);
    for (const n of result.nodes) console.log(`  [${n.pscale}] ${truncate(n.text, 200)}`);
    break;
  case 'star':
    console.log(`[${blockName} ${number} *]`);
    if (result.semantic) console.log(`  semantic: ${truncate(result.semantic)}`);
    if (result.hidden) {
      for (const [k, v] of Object.entries(result.hidden).sort()) {
        const text = typeof v === 'string' ? v : collectUnderscore(v);
        console.log(`  ${k}: ${truncate(text)}`);
      }
      // Follow star refs into loaded blocks
      for (const [k, v] of Object.entries(result.hidden).sort()) {
        if (typeof v === 'string' && blocks[v]) {
          console.log(`  --> ${k} resolves to block "${v}" (${floorDepth(blocks[v])} floors)`);
        }
      }
    } else console.log('  (no hidden directory)');
    break;
  case 'ring':
    console.log(`[${blockName} ${number} ring]`);
    for (const s of result.siblings) {
      const addr = String(number).slice(0, -1) + s.digit;
      console.log(`  [${addr}] ${truncate(s.text)}${s.branch ? ' +' : ''}`);
    }
    break;
  case 'dir':
    console.log(`[${blockName} ${number} dir]`);
    const tree = result.subtree || result.tree;
    console.log(JSON.stringify(tree, null, 2).slice(0, 2000));
    break;
  case 'point':
    console.log(`[${blockName} ${number} point @ pscale ${result.pscale}]`);
    console.log(`  ${truncate(result.text, 300)}`);
    break;
  case 'disc':
    console.log(`[${blockName} disc @ depth ${result.depth}]`);
    for (const n of result.nodes) console.log(`  [${n.path}] ${truncate(n.text)}`);
    break;
}
