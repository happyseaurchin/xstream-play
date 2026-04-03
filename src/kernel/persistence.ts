/**
 * persistence.ts — player-sovereign storage.
 *
 * Per-block localStorage keys. When an author edits spatial-thornkeep,
 * only spatial-thornkeep writes. When a character commits, only their
 * kernel block writes. Two tabs can't overwrite each other's work
 * because they write to different keys.
 *
 * Key scheme:
 *   xstream:games                          — list of saved games
 *   xstream:game:{code}:kernel:{charId}    — one character's kernel block
 *   xstream:game:{code}:block:{blockName}  — one pscale block
 */

import type { Block } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PscaleNode = string | { [key: string]: any };

const GAMES_KEY = 'xstream:games';

// ── Current game context (set once on create/join/resume) ──

let currentGameId: string | null = null;

export function setCurrentGame(gameId: string): void {
  currentGameId = gameId;
}

// ── Individual saves ──

export function saveKernelBlock(block: Block): void {
  if (!currentGameId) return;
  localStorage.setItem(
    `xstream:game:${currentGameId}:kernel:${block.character.id}`,
    JSON.stringify(block)
  );
  // Update game list
  updateGameList(currentGameId, block.character.id, block.character.name);
}

export function saveBlock(name: string, block: PscaleNode): void {
  if (!currentGameId) return;
  localStorage.setItem(
    `xstream:game:${currentGameId}:block:${name}`,
    JSON.stringify(block)
  );
}

// ── Load ──

export function loadKernelBlock(gameId: string, charId: string): Block | null {
  const json = localStorage.getItem(`xstream:game:${gameId}:kernel:${charId}`);
  return json ? JSON.parse(json) : null;
}

export function loadBlock(gameId: string, name: string): PscaleNode | null {
  const json = localStorage.getItem(`xstream:game:${gameId}:block:${name}`);
  return json ? JSON.parse(json) : null;
}

/** Load all individually-saved blocks for a game */
export function loadAllBlocks(gameId: string): Record<string, PscaleNode> {
  const result: Record<string, PscaleNode> = {};
  const prefix = `xstream:game:${gameId}:block:`;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(prefix)) {
      const name = key.slice(prefix.length);
      const json = localStorage.getItem(key);
      if (json) result[name] = JSON.parse(json);
    }
  }
  return result;
}

// ── Game list ──

export interface SavedGame {
  gameId: string;
  charId: string;
  charName: string;
  savedAt: string;
}

function updateGameList(gameId: string, charId: string, charName: string): void {
  const games: SavedGame[] = JSON.parse(localStorage.getItem(GAMES_KEY) || '[]');
  const existing = games.findIndex(g => g.gameId === gameId && g.charId === charId);
  const entry: SavedGame = {
    gameId, charId, charName,
    savedAt: new Date().toISOString(),
  };
  if (existing >= 0) games[existing] = entry;
  else games.push(entry);
  localStorage.setItem(GAMES_KEY, JSON.stringify(games));
}

export function listSavedGames(): SavedGame[] {
  return JSON.parse(localStorage.getItem(GAMES_KEY) || '[]');
}

export function clearAllSaves(): void {
  const toRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && (key.startsWith('xstream:game:') || key === GAMES_KEY)) {
      toRemove.push(key);
    }
  }
  for (const key of toRemove) {
    localStorage.removeItem(key);
  }
}

// ── Export / Import (still bundles everything — it's a file) ──

interface ExportData {
  version: 2;
  gameId: string;
  charId: string;
  charName: string;
  exportedAt: string;
  block: Block;
  blocks: Record<string, PscaleNode>;
}

export function exportGameState(gameId: string, block: Block, allBlocks: Record<string, PscaleNode>): string {
  const data: ExportData = {
    version: 2,
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
  const data = JSON.parse(json);
  if (!data.version || data.version < 1) throw new Error('Unknown save format');
  if (!data.block || !data.blocks) throw new Error('Invalid save file');
  return {
    gameId: data.gameId,
    charId: data.charId,
    block: data.block,
    blocks: data.blocks,
  };
}

// ── Cloud saves (Supabase) ──

export async function cloudSave(gameId: string, block: Block, allBlocks: Record<string, PscaleNode>): Promise<{ ok: boolean; error?: string }> {
  const { getSupabase } = await import('../lib/supabase');
  const sb = getSupabase();
  if (!sb) return { ok: false, error: 'Supabase not configured' };
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { ok: false, error: 'Not signed in' };

  const saveData = JSON.parse(exportGameState(gameId, block, allBlocks));

  const { error } = await sb
    .from('saved_games')
    .upsert({
      user_id: user.id,
      game_id: gameId,
      char_id: block.character.id,
      save_data: saveData,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,game_id,char_id' });

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export interface CloudSaveEntry {
  game_id: string;
  char_id: string;
  save_data: ExportData;
  updated_at: string;
}

export async function cloudList(): Promise<CloudSaveEntry[]> {
  const { getSupabase } = await import('../lib/supabase');
  const sb = getSupabase();
  if (!sb) return [];
  const { data } = await sb
    .from('saved_games')
    .select('game_id, char_id, save_data, updated_at')
    .order('updated_at', { ascending: false });
  return (data ?? []) as CloudSaveEntry[];
}

export async function cloudLoad(gameId: string, charId: string): Promise<ExportData | null> {
  const { getSupabase } = await import('../lib/supabase');
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb
    .from('saved_games')
    .select('save_data')
    .eq('game_id', gameId)
    .eq('char_id', charId)
    .single();
  return data?.save_data as ExportData | null;
}
