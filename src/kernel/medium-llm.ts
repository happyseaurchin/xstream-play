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
import { messagesApi, logFilmstrip } from './claude-direct';
import { getBlock } from './block-store';
import { bsp as walkLocal, collectUnderscore } from './bsp';

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

  const desc = mediumDescription().replace(/\{name\}/g, opts.agentId || 'the user');
  const rules = mediumSlot('1') || 'Synthesise. Two to four sentences. Specific. Second person, present tense.';

  const sections: string[] = [];
  sections.push(desc);
  sections.push('');
  sections.push(`# Active face: ${opts.face}`);
  sections.push('');
  sections.push('# Synthesis directive');
  if (opts.mode === 'personal') {
    sections.push('PERSONAL mode. Synthesise the user\'s own commitment, recontextualised in light of what is established at this address. The output is the user\'s solid contribution — first person from their perspective, addressed to the address itself.');
  } else if (opts.mode === 'quaker') {
    sections.push('QUAKER mode. Read across all peer liquid in this scope (frame entities .1, or pool contributions). Produce a consensus statement that honours each contribution\'s intention without flattening tension. If contributions disagree, name the disagreement clearly. Do NOT pick a winner.');
  } else {
    sections.push('CUSTOM directive (from the user\'s shell): ' + opts.mode.freeform);
  }
  sections.push('');
  sections.push('# Rules');
  sections.push(rules);
  sections.push('');
  sections.push('# Engagement context');
  sections.push(`Beach: ${opts.session.current_beach}`);
  sections.push(`Address: ${opts.session.current_address || '(root)'}`);
  if (opts.frame) {
    sections.push(`In-frame: ${opts.session.current_frame} (entity ${opts.session.entity_position})`);
    if (opts.frame.scene_underscore) sections.push(`Scene: ${opts.frame.scene_underscore}`);
    for (const e of opts.frame.entities) {
      const me = e.position === opts.session.entity_position ? ' (the user)' : '';
      if (e.liquid) sections.push(`  entity ${e.position}${me} liquid: ${e.liquid}`);
    }
  } else if (opts.pool) {
    sections.push(`In-pool: 2.${opts.pool.pool_digit} — ${opts.pool.purpose || '(no purpose set)'}`);
    for (const c of opts.pool.contributions) {
      sections.push(`  ${c.agent_id || '?'}: ${c.text}`);
    }
  } else {
    if (opts.presence.length > 0) {
      sections.push(`Present peers: ${opts.presence.map(p => p.agent_id).filter(a => a !== opts.agentId).join(', ') || '(none other than you)'}`);
    }
    const recent = opts.marks
      .filter(m => !m.is_presence)
      .slice(-5);
    if (recent.length > 0) {
      sections.push('Recent solid at this address:');
      for (const m of recent) {
        sections.push(`  ${m.agent_id || '?'}: ${m.text}`);
      }
    }
  }
  sections.push('');
  sections.push('# What the user is committing');
  sections.push(opts.pendingLiquid);
  sections.push('');
  sections.push('Output plain text only. No JSON. No preamble. The synthesised solid only.');

  const systemPrompt = sections.join('\n');
  const data = await messagesApi(opts.apiKey, {
    model: opts.model,
    max_tokens: 600,
    system: systemPrompt,
    messages: [{ role: 'user', content: 'Synthesise.' }],
  });
  const text = (data.content || [])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((c: any) => c.type === 'text')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((c: any) => c.text)
    .join('\n')
    .trim();
  logFilmstrip({
    model: opts.model,
    system_prompt: systemPrompt,
    user_prompt: opts.pendingLiquid,
    response: text,
    max_tokens: 600,
    input_tokens: data.usage?.input_tokens ?? null,
    output_tokens: data.usage?.output_tokens ?? null,
    stop_reason: data.stop_reason ?? null,
    extras: { tier: 'medium', mode: typeof opts.mode === 'string' ? opts.mode : 'freeform', face: opts.face },
  });
  return {
    text: text || opts.pendingLiquid, // fall back to raw on empty response
    mode: opts.mode,
    bypassed: false,
  };
}
