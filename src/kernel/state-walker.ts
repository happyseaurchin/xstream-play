/**
 * state-walker.ts — generic walker over substrate-authored procedural blocks.
 *
 * A "state-block" is any digit-keyed pscale block whose geometry encodes a
 * decision/state-machine/probability/RPG/governance procedure. The walker
 * descends through digit children, choosing the next step via a swappable
 * policy (uniform random, weighted random, hardcoded spindle, or caller
 * callback for LLM/UI-driven choice).
 *
 * The block IS the program; the walker is the interpreter. Designer-authors
 * a block via bsp(); xstream code (or another bsp-mcp client) walks it.
 *
 * State-block convention:
 *   { _: "node description / option text",
 *     1: { _: "first sub-option", ...sub-block or terminal },
 *     2: { _: "second sub-option", ... },
 *     ...
 *     9: optional metadata. When present at a digit-child as a NUMBER, it
 *        carries that digit's weight (random-weighted policy reads it).
 *        When present as a sub-block, conventional metadata. }
 *
 * Terminal detection: a step is terminal when the descended digit's content
 * is a primitive (string/number) OR has no digit children with non-empty
 * content. The walker stops at terminals and returns the accumulated trace.
 *
 * Pscale discipline: the walker does NOT add to the LLM's tool surface. It is
 * a TypeScript primitive callable from kernel/UI code — buttons that "roll
 * the dice", governance ratification steppers, NPC-behaviour samplers. The
 * LLM still walks via bsp() spindles when it needs deterministic content.
 */

import type { PscaleNode } from '../lib/bsp-client';

// ── Types ──

export type WalkerPolicy =
  | { kind: 'random-uniform' }
  | { kind: 'random-weighted' }
  /** Walk a fixed dot-spindle (e.g. "2.1.3") — deterministic unwind, no choice. */
  | { kind: 'spindle'; spindle: string }
  /** Caller decides each step. Useful for UI ("user clicked digit 2") or
   * LLM-driven walks (the LLM picks based on the underscores). Return null
   * to stop early. */
  | { kind: 'callback'; choose: (ctx: WalkChoiceContext) => string | null };

export interface WalkChoiceContext {
  /** Where we are in the walk (dot-spindle from the root block). */
  spindle: string;
  /** The current sub-block's underscore (the description at this node). */
  underscore: string;
  /** Available digits with their underscore + weight, in 1..9 order. */
  options: Array<{ digit: string; underscore: string; weight: number }>;
  /** The trace so far (this step is not yet recorded). */
  trace: ReadonlyArray<WalkStep>;
}

export interface WalkStep {
  digit: string;
  spindle: string;
  underscore: string;
  weight: number;
  /** True when no further digit children with content exist below this step
   * — the walk stops here. */
  terminal: boolean;
}

export interface WalkOptions {
  /** Cap to prevent runaway walks on circular or pathological blocks. */
  maxDepth?: number;
  /** Source of randomness (defaults to Math.random). Replaceable for tests. */
  rng?: () => number;
}

// ── Helpers ──

function isObject(x: unknown): x is Record<string, PscaleNode> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/** Read a digit's weight from its sub-block at position 9 (pscale metadata
 * convention). When absent or unwalkable, weight defaults to 1. */
function digitWeight(child: PscaleNode): number {
  if (!isObject(child)) return 1;
  const w = child['9'];
  if (typeof w === 'number' && w > 0) return w;
  // also tolerate a {_: "weight description", 1: <n>} sub-block at 9
  if (isObject(w) && typeof w['1'] === 'number' && w['1'] > 0) return w['1'];
  return 1;
}

/** A digit "has content" when it is a non-empty string or an object with at
 * least one non-empty child or a non-empty underscore. */
function hasContent(node: PscaleNode | undefined): boolean {
  if (node === undefined || node === null) return false;
  if (typeof node === 'string') return node.length > 0;
  if (typeof node === 'number') return true;
  if (!isObject(node)) return false;
  if (typeof node._ === 'string' && node._.length > 0) return true;
  for (const d of '123456789') {
    if (hasContent(node[d])) return true;
  }
  return false;
}

function readUnderscore(node: PscaleNode): string {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (isObject(node) && typeof node._ === 'string') return node._;
  return '';
}

function gatherOptions(node: PscaleNode): Array<{ digit: string; underscore: string; weight: number; child: PscaleNode }> {
  if (!isObject(node)) return [];
  const out: Array<{ digit: string; underscore: string; weight: number; child: PscaleNode }> = [];
  // Digits 1..8 are navigable options; digit 9 is reserved for metadata
  // (weight when primitive, generic metadata sub-block otherwise) per pscale
  // convention. Skip it from option-gathering so the walker doesn't descend
  // into a weight number or a metadata bundle.
  for (const d of '12345678') {
    const child = node[d];
    if (!hasContent(child)) continue;
    out.push({
      digit: d,
      underscore: readUnderscore(child as PscaleNode),
      weight: digitWeight(child as PscaleNode),
      child: child as PscaleNode,
    });
  }
  return out;
}

function pickWeighted(options: Array<{ digit: string; weight: number }>, rng: () => number): string {
  const total = options.reduce((s, o) => s + o.weight, 0);
  if (total <= 0) return options[0]?.digit ?? '';
  let r = rng() * total;
  for (const o of options) {
    r -= o.weight;
    if (r <= 0) return o.digit;
  }
  return options[options.length - 1].digit;
}

// ── Walker ──

const DEFAULT_MAX_DEPTH = 32;

export function walkStateBlock(
  block: PscaleNode,
  policy: WalkerPolicy,
  opts: WalkOptions = {},
): WalkStep[] {
  const maxDepth = opts.maxDepth ?? DEFAULT_MAX_DEPTH;
  const rng = opts.rng ?? Math.random;
  const trace: WalkStep[] = [];
  let current: PscaleNode = block;
  let spindle = '';

  // Spindle policy unwinds along a fixed path.
  const spindleParts = policy.kind === 'spindle' ? policy.spindle.split('.').filter(Boolean) : null;
  let spindleIdx = 0;

  for (let depth = 0; depth < maxDepth; depth++) {
    const options = gatherOptions(current);
    if (options.length === 0) break;  // terminal — no further digit children

    let chosen: string | null;
    switch (policy.kind) {
      case 'random-uniform':
        chosen = options[Math.floor(rng() * options.length)].digit;
        break;
      case 'random-weighted':
        chosen = pickWeighted(options, rng);
        break;
      case 'spindle':
        if (!spindleParts || spindleIdx >= spindleParts.length) chosen = null;
        else {
          const want = spindleParts[spindleIdx];
          chosen = options.find(o => o.digit === want)?.digit ?? null;
          spindleIdx++;
        }
        break;
      case 'callback':
        chosen = policy.choose({
          spindle, underscore: readUnderscore(current),
          options: options.map(o => ({ digit: o.digit, underscore: o.underscore, weight: o.weight })),
          trace,
        });
        break;
    }
    if (chosen === null) break;

    const opt = options.find(o => o.digit === chosen);
    if (!opt) break;  // policy returned an unavailable digit — stop

    const childSpindle = spindle ? `${spindle}.${chosen}` : chosen;
    const childOptions = gatherOptions(opt.child);
    const terminal = childOptions.length === 0;
    trace.push({
      digit: chosen,
      spindle: childSpindle,
      underscore: opt.underscore,
      weight: opt.weight,
      terminal,
    });
    if (terminal) break;
    current = opt.child;
    spindle = childSpindle;
  }
  return trace;
}

// ── Convenience: render trace ──

/** Format a walk trace as a chain of arrows for human/log display:
 * `1 (Approach openly) → 2.1 (Dragon roars) → terminal`. */
export function formatTrace(trace: WalkStep[]): string {
  if (trace.length === 0) return '(empty walk)';
  const parts = trace.map(s => `${s.spindle} (${s.underscore || '?'})`);
  if (trace[trace.length - 1].terminal) parts.push('terminal');
  return parts.join(' → ');
}
