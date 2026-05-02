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
import { bsp as walkLocal, collectUnderscore } from './bsp';
import { runBundle } from './run-bundle';

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

function mediumDescription(): string {
  const block = getBlock('medium-agent');
  if (!block) return '';
  return collectUnderscore(block) || '';
}

function mediumSlot(spindle: string): string {
  const block = getBlock('medium-agent');
  if (!block) return '';
  const r = walkLocal(block, spindle);
  if (r.mode === 'spindle' && r.nodes.length > 0) {
    return r.nodes[r.nodes.length - 1].text;
  }
  return '';
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
}

export interface SynthesiseResult {
  text: string;
  mode: SynthMode;
  bypassed: boolean;
}

export async function synthesise(opts: SynthesiseOpts): Promise<SynthesiseResult> {
  if (opts.mode === 'bypass' || opts.mode === 'blocked') {
    return { text: opts.pendingLiquid, mode: opts.mode, bypassed: true };
  }

  // Identity + scoop + recipe directive (the bundle's framing). No prose
  // about how to write or what shape to output.
  const desc = mediumDescription().replace(/\{name\}/g, opts.agentId || 'the user');
  const recipe = typeof opts.mode === 'string' ? opts.mode : opts.mode.freeform;

  const sections: string[] = [];
  sections.push(desc);
  sections.push('');
  sections.push(`agent_id: ${opts.agentId || '(anonymous)'}`);
  sections.push(`face: ${opts.face}`);
  sections.push(`recipe: ${recipe}`);
  sections.push(`beach: ${opts.session.current_beach}`);
  sections.push(`address: ${opts.session.current_address || '(root)'}`);
  if (opts.frame) {
    sections.push(`frame: ${opts.session.current_frame} entity=${opts.session.entity_position}`);
    if (opts.frame.scene_underscore) sections.push(`scene: ${opts.frame.scene_underscore}`);
    for (const e of opts.frame.entities) {
      if (e.liquid) sections.push(`  entity ${e.position}${e.position === opts.session.entity_position ? '*' : ''} liquid: ${e.liquid}`);
    }
  } else if (opts.pool) {
    sections.push(`pool: 2.${opts.pool.pool_digit} — ${opts.pool.purpose || ''}`);
    for (const c of opts.pool.contributions) {
      sections.push(`  ${c.agent_id || '?'}: ${c.text}`);
    }
  } else {
    const recent = opts.marks.filter(m => !m.is_presence).slice(-5);
    for (const m of recent) sections.push(`  ${m.agent_id || '?'}: ${m.text}`);
  }
  sections.push('');
  sections.push(`# user committing:`);
  sections.push(opts.pendingLiquid);

  const systemPrompt = sections.join('\n');
  const r = await runBundle({
    apiKey: opts.apiKey,
    model: opts.model,
    systemPrompt,
    maxTurns: 1,
    maxTokens: 600,
    telemetry: {
      tier: 'medium',
      face: opts.face,
      extras: { mode: typeof opts.mode === 'string' ? opts.mode : 'freeform' },
    },
  }, 'Synthesise.');
  return {
    text: r.text === '(no response)' ? opts.pendingLiquid : r.text,
    mode: opts.mode,
    bypassed: false,
  };
}
