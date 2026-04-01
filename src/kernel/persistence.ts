/**
 * persistence.ts — player-sovereign storage.
 *
 * localStorage auto-save after every commit.
 * Export/import as JSON files.
 * No Supabase. The player owns their data.
 */

import type { Block } from './types';
import { getBlock, setBlock, listBlocks } from './block-store';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PscaleNode = string | { [key: string]: any };

const GAMES_KEY = 'xstream:games';

function gameKey(gameId: string, suffix: string): string {
  return `xstream:game:${gameId}:${suffix}`;
}

// ── Save / Load ──

export interface SavedGame {
  gameId: string;
  charId: string;
  charName: string;
  savedAt: string;
}

export function saveGameState(gameId: string, block: Block): void {
  // Save kernel block
  localStorage.setItem(
    gameKey(gameId, `kernel:${block.character.id}`),
    JSON.stringify(block)
  );

  // Save all blocks from store (may have been edited by author/designer)
  const allBlocks: Record<string, PscaleNode> = {};
  for (const name of listBlocks()) {
    const b = getBlock(name);
    if (b) allBlocks[name] = b;
  }
  localStorage.setItem(gameKey(gameId, 'blocks'), JSON.stringify(allBlocks));

  // Update game list
  const games: SavedGame[] = JSON.parse(localStorage.getItem(GAMES_KEY) || '[]');
  const existing = games.findIndex(g => g.gameId === gameId && g.charId === block.character.id);
  const entry: SavedGame = {
    gameId,
    charId: block.character.id,
    charName: block.character.name,
    savedAt: new Date().toISOString(),
  };
  if (existing >= 0) games[existing] = entry;
  else games.push(entry);
  localStorage.setItem(GAMES_KEY, JSON.stringify(games));
}

export function loadGameState(gameId: string, charId: string): {
  block: Block | null;
  blocks: Record<string, PscaleNode> | null;
} {
  const blockJson = localStorage.getItem(gameKey(gameId, `kernel:${charId}`));
  const blocksJson = localStorage.getItem(gameKey(gameId, 'blocks'));
  return {
    block: blockJson ? JSON.parse(blockJson) : null,
    blocks: blocksJson ? JSON.parse(blocksJson) : null,
  };
}

export function listSavedGames(): SavedGame[] {
  return JSON.parse(localStorage.getItem(GAMES_KEY) || '[]');
}

export function clearSavedGame(gameId: string, charId: string): void {
  // Remove kernel + blocks
  localStorage.removeItem(gameKey(gameId, `kernel:${charId}`));
  localStorage.removeItem(gameKey(gameId, 'blocks'));

  // Remove from game list
  const games: SavedGame[] = JSON.parse(localStorage.getItem(GAMES_KEY) || '[]');
  const filtered = games.filter(g => !(g.gameId === gameId && g.charId === charId));
  localStorage.setItem(GAMES_KEY, JSON.stringify(filtered));
}

export function clearAllSaves(): void {
  const games = listSavedGames();
  for (const g of games) {
    localStorage.removeItem(gameKey(g.gameId, `kernel:${g.charId}`));
    localStorage.removeItem(gameKey(g.gameId, 'blocks'));
  }
  localStorage.removeItem(GAMES_KEY);
}

// ── Export / Import ──

interface ExportData {
  version: 1;
  gameId: string;
  charId: string;
  charName: string;
  exportedAt: string;
  block: Block;
  blocks: Record<string, PscaleNode>;
}

export function exportGameState(gameId: string, block: Block): string {
  const allBlocks: Record<string, PscaleNode> = {};
  for (const name of listBlocks()) {
    const b = getBlock(name);
    if (b) allBlocks[name] = b;
  }
  const data: ExportData = {
    version: 1,
    gameId,
    charId: block.character.id,
    charName: block.character.name,
    exportedAt: new Date().toISOString(),
    block,
    blocks: allBlocks,
  };
  return JSON.stringify(data, null, 2);
}

export function importGameState(json: string): {
  gameId: string;
  charId: string;
  block: Block;
  blocks: Record<string, PscaleNode>;
} {
  const data = JSON.parse(json) as ExportData;
  if (data.version !== 1) throw new Error('Unknown save format');
  if (!data.block || !data.blocks) throw new Error('Invalid save file');
  return {
    gameId: data.gameId,
    charId: data.charId,
    block: data.block,
    blocks: data.blocks,
  };
}
