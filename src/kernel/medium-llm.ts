/**
 * medium-llm.ts — synthesis at commit.
 *
 * Soft is the thinking partner (vapour → liquid). Medium is the synthesiser
 * (liquid → solid). When the user clicks commit, this module reads the
 * synthesis recipe from the user's shell at the active face and produces the
 * solid content to write.
 *
 * Recipe lives at: shell:1.<face>.synthesis._
 *   "personal" → reframe the user's own commitment in context of recent solid
 *                at this address. (default for character on beach.)
 *   "quaker"   → synthesise consensus from all peer liquid in scope. (default
 *                for in-frame and in-pool engagement.)
 *   "bypass"   → write raw text, no medium call. (default for designer; the
 *                user is editing config and synthesis would mangle it.)
 *   <freeform> → use the recipe text as a custom synthesis directive.
 *
 * Recipe is read from the live shell on each commit so designer-face edits
 * take effect on the next commit without reload.
 */

import type { Face } from '../lib/bsp-client';
import type { BeachSession, MarkRow, FrameView, PoolView } from './beach-session';
import type { PresenceMark } from '../lib/bsp-client';
import { getBlock } from './block-store';
import { bsp as walkLocal } from './bsp';
import { resolveRecipe, runRecipe } from './recipe-runner';
import type { SettingsContext } from './settings-reader';

export type SynthMode = 'personal' | 'quaker' | 'bypass' | 'blocked' | { freeform: string };

/**
 * Medium recipe per face — read from the `bundles` block at runtime
 * (bundles:2.<faceDigit>:2). Designer-face shell editing can override.
 * Code fallbacks match seeded bundles.json so first-load behaves the same.
 */
const FACE_DIGIT: Record<Face, string> = {
  character: '1', author: '2', designer: '3', observer: '4',
};

const RECIPE_FALLBACK: Record<Face, SynthMode> = {
  character: 'personal',
  author: 'personal',
  designer: 'bypass',
  observer: 'blocked',
};

function readBundleRecipe(face: Face): SynthMode {
  const bundles = getBlock('bundles');
  if (typeof bundles !== 'object' || bundles === null) return RECIPE_FALLBACK[face];
  const r = walkLocal(bundles, '2.' + FACE_DIGIT[face] + '.2');
  if (r.mode === 'spindle' && r.nodes.length > 0) {
    const txt = r.nodes[r.nodes.length - 1].text;
    const m = txt.replace(/^mode:\s*/, '').trim().toLowerCase();
    if (m === 'personal' || m === 'quaker' || m === 'bypass' || m === 'blocked') return m;
    if (m) return { freeform: txt.trim() };
  }
  return RECIPE_FALLBACK[face];
}

export function parseRecipe(raw: string | null | undefined, face: Face): SynthMode {
  const r = (raw || '').trim().toLowerCase();
  if (!r) return readBundleRecipe(face);
  if (r === 'personal' || r === 'quaker' || r === 'bypass' || r === 'blocked') return r;
  return { freeform: raw!.trim() };
}

interface SynthesiseOpts {
  apiKey: string;
  model: string;
  agentId: string;
  face: Face;
  pendingLiquid: string;
  mode: SynthMode;
  session: BeachSession;
  marks: MarkRow[];
  presence: PresenceMark[];
  frame: FrameView | null;
  pool: PoolView | null;
  settingsContext: SettingsContext;
}

export interface SynthesiseResult {
  text: string;
  mode: SynthMode;
  bypassed: boolean;
}

export async function synthesise(opts: SynthesiseOpts): Promise<SynthesiseResult> {
  // The user-level directive (shell:1.<face>.synthesis._) decides bypass vs LLM.
  // The recipe (substrate-authored, beach or user level) decides what the LLM
  // sees. parseRecipe mode → directive; runRecipe handles assembly.
  if (opts.mode === 'bypass' || opts.mode === 'blocked') {
    return { text: opts.pendingLiquid, mode: opts.mode, bypassed: true };
  }
  const recipe = resolveRecipe('medium', opts.face, opts.settingsContext);
  if (recipe.mode === 'bypass' || recipe.mode === 'blocked') {
    return { text: opts.pendingLiquid, mode: opts.mode, bypassed: true };
  }
  const directive = typeof opts.mode === 'string' ? opts.mode : opts.mode.freeform;
  const r = await runRecipe({
    recipe,
    inputs: {
      session: opts.session, shell: null, face: opts.face,
      marks: opts.marks, presence: opts.presence,
      frame: opts.frame, pool: opts.pool,
      pendingLiquid: opts.pendingLiquid,
      recipeDirective: directive,
    },
    userMessage: 'Synthesise.',
    apiKey: opts.apiKey,
    defaultModel: opts.model,
    defaultMaxTokens: 600,
    maxTurns: 1,
    telemetry: { tier: 'medium', face: opts.face },
  });
  return {
    text: r.text === '(no response)' ? opts.pendingLiquid : r.text,
    mode: opts.mode,
    bypassed: false,
  };
}
