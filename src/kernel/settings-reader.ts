/**
 * Settings reader — resolves a setting path against the precedence chain.
 *
 * Phase A: per-beach (beach:5) and built-in defaults.
 * Phase B: adds per-user (shell:5) — user override beats beach default.
 * Phase C+ will add per-rendezvous (beach:5.address.<addr>) and per-frame.
 *
 * Setting paths are dot-paths into the settings block (e.g. "vapour.staleness_ms").
 * The settings block is a plain nested JSON object; resolveSetting walks the path.
 *
 * Designer-face writes happen via bsp() to beach:5 (or shell:5) with the full
 * updated object — pscale spindles only address digit/underscore positions, so
 * named children like "vapour" cannot be addressed individually via spindle.
 * Whole-object replacement is the editing model.
 *
 * The settings blocks are part of the beach block (position 5) and shell block
 * (position 5), so the kernel's existing per-cycle beach read returns the beach
 * settings for free, and the existing identity-load shell read returns the user
 * settings for free — zero extra substrate calls. New values apply on next
 * cycle (~1.5s lag for beach; on next identity-load for user).
 *
 * Precedence (Phase B): per-user → per-beach → built-in default. Per-user wins
 * because the user's intent (their shell) is more specific than the beach's
 * collective default.
 */

export type SettingsBlock = Record<string, unknown> | null;

export interface SettingsContext {
  /** Cached beach-level settings sub-block (beach:5 contents). */
  beach_settings: SettingsBlock;
  /** Cached user-level settings sub-block (shell:5 contents). User overrides
   * beach defaults; Designer-face members can author the shell settings to
   * tune their own experience independently of any beach. */
  user_settings: SettingsBlock;
  // Phase C+ additions:
  // address: string;
  // frame: string | null;
}

/** Get a nested value from an object via dot-path. Returns undefined if any
 * segment is missing or non-object. */
function getPath(obj: unknown, path: string): unknown {
  if (obj === null || typeof obj !== 'object') return undefined;
  const parts = path.split('.');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cur: any = obj;
  for (const p of parts) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = cur[p];
  }
  return cur;
}

/** Resolve a setting against the precedence chain. Returns the first non-null
 * value found at any layer, falling back to defaultValue.
 *
 * Phase B precedence: per-user (shell:5) → per-beach (beach:5) → default.
 * Phase C+ will extend: per-rendezvous → per-frame → per-user → per-beach → default.
 *
 * Type guard: if the resolved value isn't typeof === typeof defaultValue, the
 * default is used at that layer (the next layer is consulted). This prevents
 * Designer-authored type drift from breaking the client — a malformed setting
 * is silently skipped, falling through to the next layer or the default.
 */
export function resolveSetting<T>(
  ctx: SettingsContext,
  path: string,
  defaultValue: T
): T {
  // Per-user wins over per-beach. User intent is more specific than collective.
  for (const layer of [ctx.user_settings, ctx.beach_settings]) {
    const v = getPath(layer, path);
    if (v === undefined || v === null) continue;
    if (typeof v !== typeof defaultValue) continue;
    return v as T;
  }
  return defaultValue;
}

/** Extract the settings sub-block from a raw beach block. Returns null if
 * absent or malformed. The kernel calls this on each cycle to update the
 * cached settings. */
export function extractBeachSettings(rawBeachBlock: unknown): SettingsBlock {
  return extractSettingsAtPosition5(rawBeachBlock);
}

/** Extract the settings sub-block from a raw shell block. Returns null if
 * absent or malformed. App.tsx calls this once per identity load. */
export function extractUserSettings(rawShellBlock: unknown): SettingsBlock {
  return extractSettingsAtPosition5(rawShellBlock);
}

/** Both beach and shell put settings at position 5 by convention; same shape. */
function extractSettingsAtPosition5(block: unknown): SettingsBlock {
  if (block === null || typeof block !== 'object') return null;
  const slot = (block as Record<string, unknown>)['5'];
  if (slot === null || typeof slot !== 'object') return null;
  return slot as Record<string, unknown>;
}
