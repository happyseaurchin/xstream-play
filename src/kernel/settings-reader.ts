/**
 * Settings reader — pscale-native: digit-spindle resolution.
 *
 * The settings BLOCK lives at `beach:5` (per-beach default) and `shell:5`
 * (per-user override). Internally it is a digit-keyed pscale block — every
 * meaningful position is a digit child, every string is an underscore. No
 * named JS keys; no ad-hoc JSON. The geometry IS the schema.
 *
 * Block shape inside `beach:5` / `shell:5`:
 *
 *   { _: "xstream client settings",
 *     1: { _: "vapour",   1: <staleness_ms>,  2: <debounce_ms> },
 *     2: { _: "liquid",   1: <staleness_ms> },
 *     3: { _: "presence", 1: <staleness_ms> },
 *     4: { _: "inbox",    1: <watch_every_n_cycles> },
 *     5: { _: "recipes",
 *          1: { _: "soft",   1: <character>, 2: <author>, 3: <designer>, 4: <observer> },
 *          2: { _: "medium", 1: <character>, 2: <author>, 3: <designer>, 4: <observer> },
 *          3: { _: "hard",   1: <character>, 2: <author>, 3: <designer>, 4: <observer> } } }
 *
 * Each numeric digit is a sub-block (`_` describes it; child digits address
 * its parts) OR a primitive value (number / string). The walker handles both.
 *
 * Resolution: per-user (shell:5) → per-beach (beach:5) → built-in default.
 * Per-user wins because the user's intent is more specific than the beach's
 * collective default. Both layers are read by the existing kernel cycle
 * (beach:5 each tick, shell:5 on identity load) — zero extra substrate calls.
 *
 * Designer-edits: write the whole block via bsp() with the digit-keyed shape.
 * Spindle-targeted writes work too — bsp(beach, 'beach', spindle='5.1.1',
 * content=8000) edits just vapour staleness without touching the rest.
 */

import type { Face } from '../lib/bsp-client';
import type { RecipeTier } from './recipe-runner';

export type SettingsBlock = Record<string, unknown> | null;

export interface SettingsContext {
  /** Cached beach-level settings sub-block (beach:5 contents). */
  beach_settings: SettingsBlock;
  /** Cached user-level settings sub-block (shell:5 contents). User overrides
   * beach defaults; Designer-face members can author the shell settings to
   * tune their own experience independently of any beach. */
  user_settings: SettingsBlock;
}

/** Spindle constants for known settings. Each constant is the dot-spindle
 * within `beach:5` / `shell:5` that addresses the value. Adding a new setting
 * is adding a constant + extending the conventions block — both substrate-
 * facing, no API drift. */
export const SETTINGS = {
  VAPOUR_STALENESS:   '1.1',
  VAPOUR_DEBOUNCE:    '1.2',
  LIQUID_STALENESS:   '2.1',
  PRESENCE_STALENESS: '3.1',
  INBOX_WATCH_EVERY:  '4.1',
} as const;

/** Recipe digit map under settings:5 (recipes sub-block).
 *   5.1 = soft, 5.2 = medium, 5.3 = hard.
 *   5.<tier>.1 = character, 5.<tier>.2 = author,
 *   5.<tier>.3 = designer,  5.<tier>.4 = observer. */
const TIER_DIGIT: Record<RecipeTier, string> = { soft: '1', medium: '2', hard: '3' };
const FACE_DIGIT: Record<Face, string> = { character: '1', author: '2', designer: '3', observer: '4' };

/** The full spindle to a recipe within the settings block. */
export function recipeSpindle(tier: RecipeTier, face: Face): string {
  return `5.${TIER_DIGIT[tier]}.${FACE_DIGIT[face]}`;
}

/** Walk a digit-keyed pscale block by spindle. Returns the value at the
 * spindle (which may be a primitive or a sub-block) or undefined if any
 * segment is missing or unwalkable. Empty spindle returns the block itself. */
export function walkSpindle(block: unknown, spindle: string): unknown {
  if (block === null || typeof block !== 'object') return undefined;
  if (!spindle) return block;
  const parts = spindle.split('.');
  let cur: unknown = block;
  for (const p of parts) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

/** Resolve a setting at a digit-spindle against the precedence chain.
 * Returns the first non-null primitive value at any layer whose typeof
 * matches the default; falls back to defaultValue otherwise.
 *
 * Type guard: if the resolved value isn't typeof === typeof defaultValue,
 * the default is used at that layer (next layer consulted). This prevents
 * Designer-authored type drift from breaking the client — a malformed
 * setting is silently skipped, falling through to the next layer or default. */
export function resolveSetting<T>(
  ctx: SettingsContext,
  spindle: string,
  defaultValue: T,
): T {
  for (const layer of [ctx.user_settings, ctx.beach_settings]) {
    const v = walkSpindle(layer, spindle);
    if (v === undefined || v === null) continue;
    if (typeof v !== typeof defaultValue) continue;
    return v as T;
  }
  return defaultValue;
}

/** Extract the settings sub-block from a raw beach block (`beach:5`). */
export function extractBeachSettings(rawBeachBlock: unknown): SettingsBlock {
  return extractSettingsAtPosition5(rawBeachBlock);
}

/** Extract the settings sub-block from a raw shell block (`shell:5`). */
export function extractUserSettings(rawShellBlock: unknown): SettingsBlock {
  return extractSettingsAtPosition5(rawShellBlock);
}

function extractSettingsAtPosition5(block: unknown): SettingsBlock {
  if (block === null || typeof block !== 'object') return null;
  const slot = (block as Record<string, unknown>)['5'];
  if (slot === null || typeof slot !== 'object') return null;
  return slot as Record<string, unknown>;
}
