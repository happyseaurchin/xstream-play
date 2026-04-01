/**
 * Mutable block store — replaces static block-registry.ts.
 *
 * Initialised from static imports via structuredClone.
 * getBlock/setBlock are the only interface. Star references
 * in agent blocks name these blocks. The kernel follows.
 *
 * All blocks are mutable at runtime: author edits, designer
 * rule changes, and Hard reconciliation write here.
 *
 * Write-through: when a block changes, that one block saves
 * to localStorage. No wholesale dumps.
 */

import spatialThornkeep from '../../blocks/xstream/spatial-thornkeep.json';
import rulesThornkeep from '../../blocks/xstream/rules-thornkeep.json';
import mediumAgent from '../../blocks/xstream/medium-agent.json';
import softAgent from '../../blocks/xstream/soft-agent.json';
import hardAgent from '../../blocks/xstream/hard-agent.json';
import harness from '../../blocks/xstream/harness.json';
import characterEssa from '../../blocks/xstream/character-essa.json';
import characterHarren from '../../blocks/xstream/character-harren.json';
import characterKael from '../../blocks/xstream/character-kael.json';
import characterTemplate from '../../blocks/xstream/character-template.json';
import authorAgent from '../../blocks/xstream/author-agent.json';
import designerAgent from '../../blocks/xstream/designer-agent.json';
import softAuthorAgent from '../../blocks/xstream/soft-author-agent.json';
import softDesignerAgent from '../../blocks/xstream/soft-designer-agent.json';
import hardAuthorAgent from '../../blocks/xstream/hard-author-agent.json';
import hardDesignerAgent from '../../blocks/xstream/hard-designer-agent.json';
import { saveBlock } from './persistence';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PscaleNode = string | { [key: string]: any };

const store = new Map<string, PscaleNode>();

// Seed from static imports — structuredClone so edits don't mutate originals
const seeds: Record<string, PscaleNode> = {
  'spatial-thornkeep': spatialThornkeep,
  'rules-thornkeep': rulesThornkeep,
  'medium-agent': mediumAgent,
  'soft-agent': softAgent,
  'hard-agent': hardAgent,
  'harness': harness,
  'character-essa': characterEssa,
  'character-harren': characterHarren,
  'character-kael': characterKael,
  'character-template': characterTemplate,
  'author-agent': authorAgent,
  'designer-agent': designerAgent,
  'soft-author-agent': softAuthorAgent,
  'soft-designer-agent': softDesignerAgent,
  'hard-author-agent': hardAuthorAgent,
  'hard-designer-agent': hardDesignerAgent,
};

for (const [name, block] of Object.entries(seeds)) {
  store.set(name, structuredClone(block));
}

/**
 * Replace the block store with saved state.
 * Used when resuming from localStorage or importing a save file.
 */
export function hydrateFromSaved(blocks: Record<string, PscaleNode>): void {
  // Start with seeds (so new blocks added since save are present)
  store.clear();
  for (const [name, block] of Object.entries(seeds)) {
    store.set(name, structuredClone(block));
  }
  // Overlay saved blocks
  for (const [name, block] of Object.entries(blocks)) {
    store.set(name, structuredClone(block));
  }
}

export function getBlock(name: string): PscaleNode | null {
  return store.get(name) ?? null;
}

export function setBlock(name: string, block: PscaleNode): void {
  store.set(name, block);
  saveBlock(name, block);
}

export function listBlocks(): string[] {
  return [...store.keys()];
}

/**
 * Snapshot a block for rollback before applying edits.
 */
export function getBlockSnapshot(name: string): PscaleNode | null {
  const block = store.get(name);
  return block ? structuredClone(block) : null;
}

// ── Block edits — how author/designer faces modify blocks ──

export interface BlockEdit {
  block: string;                           // block name in store
  address: string;                         // BSP address (walk to parent)
  operation: 'add' | 'replace' | 'delete';
  key?: string;                            // digit key at target
  content?: PscaleNode;                    // new content
}

/**
 * Walk a BSP address to find the target node.
 * Returns the node at that address, or null.
 * Address "0" or "" returns the root block itself.
 * Decimal points are notation, not structure — stripped before walking.
 * Digit 0 maps to key '_' (underscore spine).
 */
function walkToNode(block: PscaleNode, address: string): PscaleNode | null {
  const cleaned = address.replace('.', '');
  // Empty address or "0" alone = root node
  if (!cleaned || cleaned === '0') return block;
  const digits = cleaned.split('');
  let node = block;
  for (const d of digits) {
    const key = d === '0' ? '_' : d;
    if (!node || typeof node !== 'object' || !(key in node)) return null;
    node = (node as Record<string, PscaleNode>)[key];
  }
  return node;
}

/**
 * Apply a structured edit to a block in the store.
 * Snapshots before editing for rollback safety.
 * Write-through: saves just this one block to localStorage on success.
 * Returns true if the edit was applied successfully.
 */
export function applyBlockEdit(edit: BlockEdit): boolean {
  const block = store.get(edit.block);
  if (!block || typeof block !== 'object') return false;

  // Snapshot for rollback
  const snapshot = structuredClone(block);

  try {
    // Walk to the target node at the address
    const target = walkToNode(block, edit.address);
    if (!target || typeof target !== 'object') return false;
    const obj = target as Record<string, PscaleNode>;

    const key = edit.key ?? '_';

    switch (edit.operation) {
      case 'add':
        if (key in obj) return false; // key already exists
        obj[key] = edit.content ?? '';
        break;
      case 'replace':
        obj[key] = edit.content ?? '';
        break;
      case 'delete':
        if (!(key in obj)) return false;
        delete obj[key];
        break;
      default:
        return false;
    }

    // Write-through: save just this block
    saveBlock(edit.block, block);
    return true;
  } catch {
    // Rollback on any error
    store.set(edit.block, snapshot);
    return false;
  }
}
