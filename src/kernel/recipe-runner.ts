/**
 * recipe-runner.ts — code is the interpreter; the recipe is substrate.
 *
 * A "recipe" is a substrate-authored block describing how an LLM call assembles
 * its system prompt: what to gather, into what template, calling which model in
 * what mode. Designer-face authors recipes via bsp(); the runner walks them.
 *
 * Recipe block shape (digit-keyed JSON, sits inside the settings tree at
 *   `recipes.<tier>.<face>`):
 *
 *   { _: "description (prepended to system prompt as role text)",
 *     1: "template with {slot_name} interpolations",
 *     2: "synthesise | bypass | blocked",
 *     3: "model-name",                (optional override)
 *     4: 8192,                        (optional max_tokens)
 *     5: 5000,                        (optional thinking_budget)
 *     6: ["bsp", "propose_liquid"],   (optional tool subset by name)
 *     7: { _: "collective synthesis policy",
 *          1: "self|all|consent|referenced",  (clear_policy)
 *          2: "single|quorum_<n>|consensus|designer_only",  (commit_gate)
 *          3: 0  (min_gromov_product) } }
 *
 * Resolution rides the settings precedence chain — user (shell:5.recipes.…) →
 * beach (beach:5.recipes.…) → built-in default. Same cache, no extra calls.
 *
 * Built-in defaults match current claude-tools and medium-llm output exactly,
 * so first-load is identical when no substrate recipe is authored. Designer
 * face writes one and the next call uses it.
 */

import type { Face, AgentShell, PresenceMark, PscaleNode } from '../lib/bsp-client';
import type { BeachSession, MarkRow, FrameView, PoolView, LiquidPeer } from './beach-session';
import { runBundle, type BundleResult } from './run-bundle';
import { getBlock } from './block-store';
import { bsp as walkLocal, collectUnderscore } from './bsp';
import { type SettingsContext } from './settings-reader';

// ── Types ──

export type RecipeMode = 'synthesise' | 'bypass' | 'blocked' | 'propose';
export type RecipeTier = 'soft' | 'medium' | 'hard';

/** Where slot-clearing lands after a successful commit.
 *   self       — only the committer's slot (preserves peer autonomy; safe default)
 *   all        — every liquid slot at the address (collective absorbed; brainstorm)
 *   consent    — slots whose owners also committed (Quaker discipline; needs gate)
 *   referenced — slots the medium-LLM marked as consumed (audit-trail discipline) */
export type ClearPolicy = 'self' | 'all' | 'consent' | 'referenced';

/** Gate that decides when a commit fires the synthesis.
 *   single        — first commit wins (current behaviour; brainstorm / co-write)
 *   quorum_<n>    — wait for N committers (governance vote)
 *   consensus     — wait for all present to commit (small-group ratification)
 *   designer_only — only Designer-face members may commit (rule-edit guardrail)
 *
 * NOTE: Phase D ships `single` only. quorum/consensus/designer_only need
 * substrate-side committed-flag state (write `5: committed_ts` to your slot
 * without firing synthesis; committer's kernel polls and counts) — follow-up. */
export type CommitGate = 'single' | 'consensus' | 'designer_only' | { quorum: number };

export interface CollectivePolicy {
  clearPolicy: ClearPolicy;
  commitGate: CommitGate;
  /** Filter peer-liquid slots by longest-common-prefix overlap with the
   * synthesis address. 0 includes everyone; higher values keep the medium
   * LLM's context tractable when many agents share a deeply-nested rendezvous.
   * Per DESIGN-SCOPE §4.3.1 (Gromov-product coupling). */
  minGromovProduct: number;
}

export interface Recipe {
  description: string;
  template: string;
  mode: RecipeMode;
  model?: string;
  maxTokens?: number;
  thinkingBudget?: number;
  toolSubset?: string[];
  collective?: CollectivePolicy;
}

export interface RecipeRuntimeInputs {
  session: BeachSession;
  shell: AgentShell | null;
  face: Face;
  marks: MarkRow[];
  presence: PresenceMark[];
  frame: FrameView | null;
  pool: PoolView | null;
  /** All liquid slots at the current address (beach:7.<address>). The medium
   * recipe's collective gather reads across this; the soft recipe ignores it
   * by default (medium synthesises convergence, soft is one-on-one). */
  peerLiquid?: LiquidPeer[];
  pendingLiquid?: string;
  recipeDirective?: string;
  /** Populated by runRecipe before gather — gives gather functions access to
   * the recipe's collective policy (Gromov filter, etc.) without an extra
   * parameter on every gather call. */
  policy?: CollectivePolicy;
}

// ── Block parser ──

/** Parse a digit-keyed substrate block into a Recipe. Returns null on malformed. */
export function parseRecipeBlock(raw: unknown): Recipe | null {
  if (raw === null || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const description = typeof r._ === 'string' ? r._ : '';
  const template = typeof r['1'] === 'string' ? r['1'] : '';
  if (!template) return null;
  const modeRaw = typeof r['2'] === 'string' ? r['2'].trim().toLowerCase() : 'synthesise';
  const mode: RecipeMode =
    modeRaw === 'bypass' || modeRaw === 'blocked' || modeRaw === 'propose' ? modeRaw : 'synthesise';
  const model = typeof r['3'] === 'string' ? r['3'] : undefined;
  const maxTokens = typeof r['4'] === 'number' ? r['4'] : undefined;
  const thinkingBudget = typeof r['5'] === 'number' ? r['5'] : undefined;
  const toolSubset = Array.isArray(r['6']) ? (r['6'].filter(x => typeof x === 'string') as string[]) : undefined;
  const collective = parseCollectivePolicy(r['7']);
  return { description, template, mode, model, maxTokens, thinkingBudget, toolSubset, collective };
}

function parseCollectivePolicy(raw: unknown): CollectivePolicy | undefined {
  if (raw === null || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const clearRaw = typeof r['1'] === 'string' ? r['1'].trim().toLowerCase() : 'self';
  const clearPolicy: ClearPolicy =
    clearRaw === 'all' || clearRaw === 'consent' || clearRaw === 'referenced' ? clearRaw : 'self';
  const gateRaw = typeof r['2'] === 'string' ? r['2'].trim().toLowerCase() : 'single';
  let commitGate: CommitGate = 'single';
  if (gateRaw === 'consensus' || gateRaw === 'designer_only') commitGate = gateRaw;
  else {
    const m = gateRaw.match(/^quorum_(\d+)$/);
    if (m) commitGate = { quorum: parseInt(m[1], 10) };
  }
  const minGromovProduct = typeof r['3'] === 'number' && r['3'] >= 0 ? Math.floor(r['3']) : 0;
  return { clearPolicy, commitGate, minGromovProduct };
}

/** Default policy when a recipe doesn't specify one. Self-only clear, single-
 * committer gate, no Gromov filter — current behaviour, safe for unfamiliar
 * collective scenarios. */
export const DEFAULT_COLLECTIVE_POLICY: CollectivePolicy = {
  clearPolicy: 'self',
  commitGate: 'single',
  minGromovProduct: 0,
};

/** Read the effective collective policy for a recipe, falling back to the
 * default. Callers (the commit path) consult this without caring whether the
 * recipe authored an explicit policy. */
export function getCollectivePolicy(recipe: Recipe): CollectivePolicy {
  return recipe.collective ?? DEFAULT_COLLECTIVE_POLICY;
}

// ── Resolution: user → beach → built-in default ──

export function resolveRecipe(tier: RecipeTier, face: Face, ctx: SettingsContext): Recipe {
  const path = `recipes.${tier}.${face}`;
  const fallback = BUILT_IN_RECIPES[tier][face];
  // resolveSetting<T> rejects type mismatches; we want object-shape, so we
  // walk the layers manually here and validate via parseRecipeBlock.
  for (const layer of [ctx.user_settings, ctx.beach_settings]) {
    const v = getNestedPath(layer, path);
    if (v === undefined || v === null || typeof v !== 'object') continue;
    const parsed = parseRecipeBlock(v);
    if (parsed) return parsed;
  }
  return fallback;
}

function getNestedPath(obj: unknown, path: string): unknown {
  if (obj === null || typeof obj !== 'object') return undefined;
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

// ── Gather dispatch ──
//
// Each named slot is a function from runtime inputs to a string. The template
// references {slot_name} and the runner replaces. Adding a new gather is
// adding one entry here — a small, discoverable surface that Designer-face
// recipes target by name.

type GatherFn = (i: RecipeRuntimeInputs) => string;

const GATHERS: Record<string, GatherFn> = {
  agent_id: (i) => i.session.agent_id || '(anonymous)',
  face: (i) => i.face,
  beach: (i) => i.session.current_beach,
  address: (i) => i.session.current_address || '(root)',
  recipe_directive: (i) => i.recipeDirective || '',
  pending_liquid: (i) => i.pendingLiquid || '',
  soft_description: (i) => softAgentDescription().replace(/\{name\}/g, i.session.agent_id || 'the user'),
  medium_description: (i) => mediumAgentDescription().replace(/\{name\}/g, i.session.agent_id || 'the user'),
  whetstone: () => whetstoneSummary(),
  conventions: () => conventionsSummary(),
  shell: (i) => shellSummary(i.shell, i.face),
  frame: (i) => frameSummary(i.frame, i.presence, i.session),
  solid_history: (i) => solidHistory(i.marks, i.session),
  medium_context: (i) => mediumContext(i),
  peer_liquid: (i) => peerLiquidLines(i),
  slot1_label: () => softAgentSlotLabel('1') || 'Agent shell.',
  slot2_label: () => softAgentSlotLabel('2') || 'Frame: present agents, recent marks, sed stack at address.',
  slot3_label: () => softAgentSlotLabel('3') || 'Solid history: last 3 solids at this address.',
};

/** Longest common dot-segment prefix between two pscale paths. Empty paths
 * count as 0; equal paths count as their full segment count. Used by the
 * Gromov-product filter on collective gather. */
export function gromovProduct(a: string | null | undefined, b: string | null | undefined): number {
  if (!a || !b) return 0;
  const aa = a.split('.');
  const bb = b.split('.');
  let n = 0;
  while (n < aa.length && n < bb.length && aa[n] === bb[n]) n++;
  return n;
}

/** Format the peer-liquid layer as multi-line context for the medium-LLM.
 * One line per slot: `<face?> <agent_id> @ <address>: <text>`. The committer's
 * own slot is included as `(you)` so the LLM sees how their own contribution
 * fits the convergence. Filtered by the recipe's Gromov-product threshold —
 * peers whose stored address shares too few prefix segments with the synthesis
 * address are excluded (keeps context tractable at scale). */
function peerLiquidLines(i: RecipeRuntimeInputs): string {
  const peers = i.peerLiquid ?? [];
  if (peers.length === 0) return '';
  const min = i.policy?.minGromovProduct ?? 0;
  const here = i.session.current_address || '';
  const filtered = min > 0
    ? peers.filter(p => gromovProduct(p.address, here) >= min)
    : peers;
  if (filtered.length === 0) return '';
  return filtered.map(p => {
    const who = p.is_self ? `${p.agent_id || 'you'} (you)` : (p.agent_id || '?');
    const addr = p.address || '(root)';
    const face = p.face ? `[${p.face}] ` : '';
    return `  ${face}${who} @ ${addr}: ${p.text}`;
  }).join('\n');
}

// ── Gather implementations (live in this module so the runner is self-contained) ──

function softAgentDescription(): string {
  const block = getBlock('soft-agent');
  if (!block) return '';
  return collectUnderscore(block) || '';
}

function mediumAgentDescription(): string {
  const block = getBlock('medium-agent');
  if (!block) return '';
  return collectUnderscore(block) || '';
}

function softAgentSlotLabel(digit: string): string {
  const block = getBlock('soft-agent');
  if (!block) return '';
  const r = walkLocal(block, '4.' + digit);
  if (r.mode === 'spindle' && r.nodes.length > 0) {
    return r.nodes[r.nodes.length - 1].text;
  }
  return '';
}

function whetstoneSummary(): string {
  const block = getBlock('whetstone');
  if (typeof block !== 'object' || block === null) return '';
  const lines: string[] = [];
  const root = block as Record<string, PscaleNode>;
  if (typeof root._ === 'string') lines.push(root._);
  for (const k of '12345') {
    const branch = root[k];
    if (typeof branch !== 'object' || branch === null) continue;
    const b = branch as Record<string, PscaleNode>;
    if (typeof b._ === 'string') lines.push(`${k}. ${b._}`);
  }
  return lines.join('\n\n');
}

function conventionsSummary(): string {
  const block = getBlock('conventions') ?? getBlock('conventions-local');
  if (typeof block !== 'object' || block === null) return '';
  const lines: string[] = [];
  const root = block as Record<string, PscaleNode>;
  if (typeof root._ === 'string') lines.push(root._);
  for (const k of '123456789') {
    const branch = root[k];
    if (typeof branch === 'string') {
      lines.push(`${k}. ${branch}`);
    } else if (typeof branch === 'object' && branch !== null) {
      const b = branch as Record<string, PscaleNode>;
      if (typeof b._ === 'string') lines.push(`${k}. ${b._}`);
      for (const sub of '123456789') {
        const v = b[sub];
        if (typeof v === 'string') lines.push(`   ${k}.${sub} ${v}`);
      }
    }
  }
  return lines.join('\n');
}

function shellSummary(shell: AgentShell | null, activeFace: Face): string {
  if (!shell) return '(no shell — anonymous user, or shell not yet bootstrapped)';
  const sf = shell.faces.find(f => f.canonical === activeFace);
  const lines: string[] = [];
  if (shell.description) lines.push(shell.description);
  lines.push(`Active face: ${activeFace}`);
  if (sf) {
    if (sf.label) lines.push(`  ${sf.label}`);
    if (sf.default_address) lines.push(`  default address: ${sf.default_address}`);
    lines.push(`  knowledge_gates: ${sf.knowledge_gates || '(empty — default scope)'}`);
    lines.push(`  commit_gates:    ${sf.commit_gates || '(empty — see whetstone:3.2 fallback)'}`);
    if (sf.persona) lines.push(`  persona: ${sf.persona}`);
  }
  if (shell.watched_beaches.length) lines.push(`Watched beaches: ${shell.watched_beaches.join(', ')}`);
  if (shell.block_manifest.length) lines.push(`Block manifest: ${shell.block_manifest.join(', ')}`);
  return lines.join('\n');
}

function frameSummary(frame: FrameView | null, presence: PresenceMark[], session: BeachSession): string {
  if (frame) {
    const lines: string[] = [];
    lines.push(`In-frame: ${session.current_frame} (entity ${session.entity_position}) at ${session.current_beach}`);
    if (frame.scene_underscore) lines.push(`Scene: ${frame.scene_underscore}`);
    if (frame.synthesis) lines.push(`Synthesis: ${frame.synthesis}`);
    if (frame.synthesis_envelope) lines.push(`  envelope: ${frame.synthesis_envelope}`);
    for (const e of frame.entities) {
      const me = e.position === session.entity_position ? ' (you)' : '';
      const liquid = e.liquid ? ` liquid="${e.liquid.slice(0, 80)}"` : '';
      const solid = e.solid ? ` solid="${e.solid.slice(0, 80)}"` : '';
      lines.push(`  entity ${e.position}${me}: ${e.underscore || '(no underscore)'}${liquid}${solid}`);
    }
    return lines.join('\n');
  }
  const lines: string[] = [];
  lines.push(`Beachcombing at ${session.current_beach}:${session.current_address || '(root)'}`);
  if (presence.length === 0) {
    lines.push('No present peers.');
  } else {
    lines.push(`Present peers (${presence.length}):`);
    for (const p of presence.slice(0, 10)) {
      lines.push(`  ${p.agent_id} @ ${p.address || '(root)'} — ${p.timestamp}`);
    }
  }
  return lines.join('\n');
}

function solidHistory(marks: MarkRow[], session: BeachSession): string {
  const filtered = marks
    .filter(m => !m.is_presence)
    .filter(m => !session.current_address || (m.address ?? '').startsWith(session.current_address))
    .slice(-3);
  if (filtered.length === 0) return '(no recent solid at this address)';
  return filtered
    .map(m => `${m.timestamp || '?'} — ${m.agent_id || '?'}: ${m.text}`)
    .join('\n');
}

/** The frame OR pool OR recent-marks block for medium synthesis context. */
function mediumContext(i: RecipeRuntimeInputs): string {
  const lines: string[] = [];
  if (i.frame) {
    lines.push(`frame: ${i.session.current_frame} entity=${i.session.entity_position}`);
    if (i.frame.scene_underscore) lines.push(`scene: ${i.frame.scene_underscore}`);
    for (const e of i.frame.entities) {
      if (e.liquid) lines.push(`  entity ${e.position}${e.position === i.session.entity_position ? '*' : ''} liquid: ${e.liquid}`);
    }
  } else if (i.pool) {
    lines.push(`pool: 2.${i.pool.pool_digit} — ${i.pool.purpose || ''}`);
    for (const c of i.pool.contributions) {
      lines.push(`  ${c.agent_id || '?'}: ${c.text}`);
    }
  } else {
    const recent = i.marks.filter(m => !m.is_presence).slice(-5);
    for (const m of recent) lines.push(`  ${m.agent_id || '?'}: ${m.text}`);
  }
  return lines.join('\n');
}

// ── Built-in default recipes ──
//
// These match current soft (claude-tools.ts buildSoftSystemPrompt) and medium
// (medium-llm.ts synthesise) output verbatim so first-load is identical when
// no substrate recipe is authored. Each Designer-authored recipe at the same
// path supersedes — same precedence chain as L1 settings.

const SOFT_DEFAULT_TEMPLATE =
  '{soft_description}\n' +
  '\n' +
  'agent_id: {agent_id}\n' +
  'face: {face}\n' +
  '\n' +
  '# whetstone — bsp() operational reference\n' +
  '{whetstone}\n' +
  '\n' +
  '# conventions — block shapes + bsp() procedures for this beach\n' +
  '{conventions}\n' +
  '\n' +
  '# {slot1_label}\n' +
  '{shell}\n' +
  '\n' +
  '# {slot2_label}\n' +
  '{frame}\n' +
  '\n' +
  '# {slot3_label}\n' +
  '{solid_history}';

// Phase D: medium synthesises ACROSS the rendezvous, not just self.
//   {medium_context}  → frame entities OR pool contributions OR recent marks
//                       (already-collective in those modes).
//   {peer_liquid}     → all liquid slots at beach:7.<address>, including the
//                       committer's own — the on-beach collective gather.
// Empty when nobody (incl. self) has live liquid; the committer's pending
// liquid still appears under "# user committing:" below for backwards
// equivalence with the pre-Phase-D solo case.
const MEDIUM_DEFAULT_TEMPLATE =
  '{medium_description}\n' +
  '\n' +
  'agent_id: {agent_id}\n' +
  'face: {face}\n' +
  'recipe: {recipe_directive}\n' +
  'beach: {beach}\n' +
  'address: {address}\n' +
  '{medium_context}\n' +
  '\n' +
  '# liquid here right now (all peers at this address):\n' +
  '{peer_liquid}\n' +
  '\n' +
  '# user committing:\n' +
  '{pending_liquid}';

const SOFT_DEFAULT: Recipe = {
  description: '',
  template: SOFT_DEFAULT_TEMPLATE,
  mode: 'synthesise',
  maxTokens: 8192,
  thinkingBudget: 5000,
};

const MEDIUM_DEFAULT: Recipe = {
  description: '',
  template: MEDIUM_DEFAULT_TEMPLATE,
  mode: 'synthesise',
  maxTokens: 600,
};

const MEDIUM_BYPASS: Recipe = {
  description: '',
  template: '',
  mode: 'bypass',
};

const MEDIUM_BLOCKED: Recipe = {
  description: '',
  template: '',
  mode: 'blocked',
};

export const BUILT_IN_RECIPES: Record<RecipeTier, Record<Face, Recipe>> = {
  soft: {
    character: SOFT_DEFAULT,
    author: SOFT_DEFAULT,
    designer: SOFT_DEFAULT,
    observer: SOFT_DEFAULT,
  },
  medium: {
    character: MEDIUM_DEFAULT,
    author: MEDIUM_DEFAULT,
    designer: MEDIUM_BYPASS,
    observer: MEDIUM_BLOCKED,
  },
  hard: {
    character: SOFT_DEFAULT,
    author: SOFT_DEFAULT,
    designer: SOFT_DEFAULT,
    observer: SOFT_DEFAULT,
  },
};

// ── Template interpolation ──

function interpolate(template: string, inputs: RecipeRuntimeInputs): string {
  return template.replace(/\{([a-z0-9_]+)\}/gi, (_, name: string) => {
    const fn = GATHERS[name];
    if (!fn) return '';
    try {
      return fn(inputs);
    } catch {
      return '';
    }
  });
}

// ── System prompt assembly (independent of LLM call) ──

/** Build the assembled system prompt from a recipe + runtime inputs. Used by
 * runRecipe and by alternate transports (e.g. the Anthropic MCP connector
 * path) that need the prompt string without going through runBundle. */
export function buildRecipeSystemPrompt(recipe: Recipe, inputs: RecipeRuntimeInputs): string {
  const description = recipe.description
    ? recipe.description.replace(/\{name\}/g, inputs.session.agent_id || 'the user')
    : '';
  const body = interpolate(recipe.template, inputs);
  return description ? `${description}\n\n${body}` : body;
}

// ── Runner ──

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTool = any;

export interface RunRecipeOpts {
  recipe: Recipe;
  inputs: RecipeRuntimeInputs;
  userMessage: string;
  apiKey: string;
  defaultModel: string;
  defaultMaxTokens?: number;
  defaultThinkingBudget?: number;
  tools?: AnyTool[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  toolExecutor?: (name: string, input: Record<string, any>) => Promise<string>;
  maxTurns?: number;
  telemetry?: { tier: RecipeTier; face?: Face };
  onToolCall?: (name: string, input: unknown) => void;
}

export async function runRecipe(opts: RunRecipeOpts): Promise<BundleResult> {
  const { recipe } = opts;
  // Inject the recipe's collective policy into inputs so gather functions
  // (peer_liquid, future ones) can honour it without an extra parameter.
  const inputs: RecipeRuntimeInputs = { ...opts.inputs, policy: getCollectivePolicy(recipe) };

  if (recipe.mode === 'bypass' || recipe.mode === 'blocked') {
    return {
      text: inputs.pendingLiquid || '',
      toolCalls: [],
      turns: 0,
      bundleStop: 'recipe-' + recipe.mode,
    };
  }

  const systemPrompt = buildRecipeSystemPrompt(recipe, inputs);

  // Tool subset filter — recipe can name a subset by tool name.
  let tools = opts.tools;
  if (tools && recipe.toolSubset && recipe.toolSubset.length > 0) {
    const allow = new Set(recipe.toolSubset);
    tools = tools.filter((t: { name: string }) => allow.has(t.name));
  }

  return runBundle({
    apiKey: opts.apiKey,
    model: recipe.model ?? opts.defaultModel,
    systemPrompt,
    tools,
    toolExecutor: opts.toolExecutor,
    maxTurns: opts.maxTurns,
    maxTokens: recipe.maxTokens ?? opts.defaultMaxTokens,
    thinkingBudget: recipe.thinkingBudget ?? opts.defaultThinkingBudget,
    telemetry: opts.telemetry,
    onToolCall: opts.onToolCall,
  }, opts.userMessage);
}
