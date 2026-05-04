/**
 * Settings reader — resolves a setting path against the precedence chain.
 *
 * Phase A: per-beach (beach:5) and built-in defaults only.
 * Phase B will add per-user (shell.settings) and per-rendezvous (beach:5.address.<addr>).
 *
 * Setting paths are dot-paths into the settings block (e.g. "vapour.staleness_ms").
 * The settings block is a plain nested JSON object; resolveSetting walks the path.
 *
 * Designer-face writes happen via bsp() to beach:5 with the full updated object —
 * pscale spindles only address digit/underscore positions, so named children like
 * "vapour" cannot be addressed individually via spindle. Whole-object replacement
 * is the editing model for Phase A.
 *
 * The settings block is part of the beach block (position 5), so the kernel's
 * existing per-cycle read of (beach, "beach", "1") returns it for free in raw —
 * no extra substrate calls. New values applied on next cycle (~1.5s lag).
 */

export type SettingsBlock = Record<string, unknown> | null;

export interface SettingsContext {
  /** Cached beach-level settings sub-block (beach:5 contents). */
  beach_settings: SettingsBlock;
  // Phase B additions:
  // user_settings: SettingsBlock;
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
 * Phase A precedence: per-beach → default.
 * Phase B will extend: per-rendezvous → per-frame → per-user → per-beach → default.
 *
 * Type guard: if the resolved value isn't typeof === typeof defaultValue, the
 * default is used (prevents Designer-authored type drift from breaking the
 * client). This is a soft guard — for stricter validation callers should
 * post-validate the returned value themselves.
 */
export function resolveSetting<T>(
  ctx: SettingsContext,
  path: string,
  defaultValue: T
): T {
  const v = getPath(ctx.beach_settings, path);
  if (v === undefined || v === null) return defaultValue;
  if (typeof v !== typeof defaultValue) return defaultValue;
  return v as T;
}

/** Extract the settings sub-block from a raw beach block. Returns null if
 * absent or malformed. The kernel calls this on each cycle to update the
 * cached settings. */
export function extractBeachSettings(rawBeachBlock: unknown): SettingsBlock {
  if (rawBeachBlock === null || typeof rawBeachBlock !== 'object') return null;
  const slot = (rawBeachBlock as Record<string, unknown>)['5'];
  if (slot === null || typeof slot !== 'object') return null;
  return slot as Record<string, unknown>;
}
