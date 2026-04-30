/**
 * claude-tools.ts — bsp-mcp tool-use loop for the soft-LLM. The magic move.
 *
 * When the user types in vapour and hits ⌘↵, the soft-LLM is equipped with
 * the six bsp-mcp primitives as tools. It walks the federated commons of
 * pscale blocks to compose its own context — face-gated, address-aware,
 * frame-aware. Generic Claude becomes a substrate-aware partner.
 *
 * Six tools, exactly:
 *   bsp                       — geometric primitive (read/write, all shapes)
 *   pscale_create_collective  — admin sed: op
 *   pscale_register           — claim sed: position
 *   pscale_grain_reach        — bilateral grain
 *   pscale_key_publish        — Argon2id derivation + publish
 *   pscale_verify_rider       — verify rider chain
 *
 * Conventions (passport / pool / inbox / mark / GRIT) are NOT additional
 * tools — they are taught via system-prompt context. The LLM uses bsp() at
 * the conventional shape.
 *
 * Face-gating: read shell:1.<digit>.{2,3} for knowledge / commit gates.
 * Whetstone:3.2 default face/tier matrix is fallback when shell silent.
 *
 * Context composition: walk soft-agent branch 4 via the local kernel/bsp
 * walker to honour the discipline ("read the block, don't reinvent"). The
 * branch 4 underscores name the slots; we fill them from live state.
 */

import { bsp as bspCall, type BspParams, type BspReadResult, type BspWriteResult, type Face, type Tier, type AgentShell, type PscaleNode, type PresenceMark } from '../lib/bsp-client';
import { bsp as walkLocal, collectUnderscore } from './bsp';
import { getBlock } from './block-store';
import type { BeachSession, MarkRow, FrameView } from './beach-session';
import { messagesApi, logFilmstrip } from './claude-direct';

// ── Tool schemas ──

interface AnthropicTool {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    properties: Record<string, any>;
    required?: string[];
  };
}

export const BSP_TOOLS: AnthropicTool[] = [
  {
    name: 'bsp',
    description:
      'The geometric primitive. ONE call serves every selection shape and both directions. Read when content is omitted; write when content is provided. Selection shape derives from spindle length and pscale_attention (point/ring/dir/disc/whole/star). ' +
      'Substrate dispatches by agent_id prefix: https:// → federated beach (/.well-known/pscale-beach); sed:/grain:/bare → bsp-mcp commons. ' +
      'Conventions over bsp(): passport at (agent_id, "passport"); marks at beach:1.<n>; pool at beach:2.<N>.<n>; presence marks carry {1=agent_id, 2=address, 3=ts}.',
    input_schema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'Identity that owns the block. https://… for federated beaches, sed:<collective> or grain:<pair_id> for those substrates, bare names for ordinary commons blocks.' },
        block: { type: 'string', description: 'Block name. "beach", "passport", "shell", "frame:<scene>", or any other named block at agent_id.' },
        spindle: { type: 'string', description: 'Pscale address within the block, e.g. "1" or "1.2" or "" for root. Trailing star walks the hidden directory at terminus.' },
        pscale_attention: { type: 'integer', description: 'Depth selector. With spindle length, derives shape: P_att=P_end → point; P_end−1 → ring; deeper → subtree; spindle empty + P_att set → disc; both empty → whole block.' },
        content: { description: 'Optional. If provided, writes at (spindle, pscale_attention). Shape must match the derived shape — string for point, object for ring/dir.' },
        face: { type: 'string', enum: ['character', 'author', 'designer', 'observer'], description: 'CADO face modifier; defaults to current face.' },
        tier: { type: 'string', enum: ['soft', 'medium', 'hard'] },
        secret: { type: 'string', description: 'Write-lock passphrase; required for writes to locked blocks. Defaults to current session secret on writes.' },
      },
      required: ['agent_id', 'block'],
    },
  },
  {
    name: 'pscale_create_collective',
    description: 'Create a new sed: collective. Admin op. NOT YET WIRED IN CLIENT — will return a not-implemented stub; suggest the user use the substrate tray.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Collective name; becomes sed:<name>.' },
        description: { type: 'string' },
      },
      required: ['name'],
    },
  },
  {
    name: 'pscale_register',
    description: 'Claim a position in a sed: collective in landing order. NOT YET WIRED IN CLIENT — will return a not-implemented stub; suggest the user use the substrate tray.',
    input_schema: {
      type: 'object',
      properties: {
        collective: { type: 'string', description: 'Target collective, e.g. "commons" or "designers".' },
        declaration: { type: 'string', description: 'Underscore content for the claimed position.' },
      },
      required: ['collective', 'declaration'],
    },
  },
  {
    name: 'pscale_grain_reach',
    description: 'Propose a bilateral grain (private channel). NOT YET WIRED IN CLIENT — will return a not-implemented stub; suggest the user use the substrate tray.',
    input_schema: {
      type: 'object',
      properties: {
        partner_agent_id: { type: 'string' },
        purpose: { type: 'string' },
      },
      required: ['partner_agent_id'],
    },
  },
  {
    name: 'pscale_key_publish',
    description: 'Derive ed25519 + x25519 keys via Argon2id from secret + agent_id and publish public halves to passport position 9. NOT YET WIRED IN CLIENT.',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'pscale_verify_rider',
    description: 'Verify an ecosquared rider signature chain. NOT YET WIRED IN CLIENT.',
    input_schema: {
      type: 'object',
      properties: {
        rider_id: { type: 'string' },
      },
      required: ['rider_id'],
    },
  },
];

// ── Gate matching ──

/**
 * Whetstone:3.2 default face/tier fallback matrix. Used when a face's
 * commit_gates is empty and we want to know whether writes are permissible
 * in principle. v0.1 client-side enforcement — substrate-side comes later.
 */
const DEFAULT_FACE_CAN_WRITE: Record<Face, boolean> = {
  character: false, // soft+medium only by default
  author: true,
  designer: true,
  observer: false,  // read-only
};

/**
 * Check whether (target_agent_id, target_block) is within the active face's
 * commit_gates. The gates string is comma-separated; each entry is one of:
 *   <agent_id>                       → all blocks at that agent
 *   <agent_id>:<block>               → that one block
 *   <url>                            → that federated beach (any block)
 *   sed:<collective>                 → that collective
 * Empty gates → fall back to whetstone:3.2 default for the face.
 */
export function writeAllowed(commitGates: string, agent_id: string, block: string, face: Face): boolean {
  const trimmed = commitGates.trim();
  if (!trimmed) return DEFAULT_FACE_CAN_WRITE[face];
  const target = `${agent_id}:${block}`;
  for (const raw of trimmed.split(',')) {
    const entry = raw.trim();
    if (!entry) continue;
    if (entry === agent_id) return true;
    if (entry === target) return true;
    if (target.startsWith(entry + ':')) return true;
    if (entry.endsWith(':*') && target.startsWith(entry.slice(0, -1))) return true;
  }
  return false;
}

// ── Tool executor ──

interface ExecutorContext {
  session: BeachSession;
  shell: AgentShell | null;
  face: Face;
  onLog?: (msg: string) => void;
}

export async function executeTool(
  name: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  input: Record<string, any>,
  ctx: ExecutorContext
): Promise<string> {
  if (name === 'bsp') return executeBsp(input, ctx);
  if (name.startsWith('pscale_')) {
    return JSON.stringify({
      ok: false,
      error: `${name} is not yet wired in this client. Suggest the user use the substrate tray (header icons) to perform this action.`,
    });
  }
  return JSON.stringify({ ok: false, error: `unknown tool: ${name}` });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function executeBsp(input: Record<string, any>, ctx: ExecutorContext): Promise<string> {
  if (typeof input.agent_id !== 'string' || typeof input.block !== 'string') {
    return JSON.stringify({ ok: false, error: 'bsp requires agent_id (string) and block (string).' });
  }
  const isWrite = input.content !== undefined;

  // Gate writes via shell:1.<digit>.3 (commit_gates) for active face.
  if (isWrite) {
    const sf = ctx.shell?.faces.find(f => f.canonical === ctx.face);
    const gates = sf?.commit_gates ?? '';
    if (!writeAllowed(gates, input.agent_id, input.block, ctx.face)) {
      return JSON.stringify({
        ok: false,
        error: `commit denied — writing to ${input.agent_id}:${input.block} is outside commit gates for ${ctx.face} face. Gates: ${gates || '(empty — using whetstone:3.2 default which forbids writes for this face)'}.`,
      });
    }
  }

  const params: BspParams = {
    agent_id: input.agent_id,
    block: input.block,
    spindle: typeof input.spindle === 'string' ? input.spindle : undefined,
    pscale_attention: typeof input.pscale_attention === 'number' ? input.pscale_attention : undefined,
    content: input.content as PscaleNode | undefined,
    face: typeof input.face === 'string' ? (input.face as Face) : ctx.face,
    tier: typeof input.tier === 'string' ? (input.tier as Tier) : undefined,
    secret: typeof input.secret === 'string'
      ? input.secret
      : (isWrite ? ctx.session.secret || undefined : undefined),
  };

  ctx.onLog?.(`bsp ${isWrite ? 'WRITE' : 'READ'} ${params.agent_id}:${params.block}${params.spindle ? `:${params.spindle}` : ''}${params.pscale_attention !== undefined ? ` p=${params.pscale_attention}` : ''}`);

  try {
    const result = await bspCall(params);
    if (!result.ok) {
      return JSON.stringify({ ok: false, error: (result as BspWriteResult).error ?? 'unknown' });
    }
    if ('data' in result) {
      const r = result as BspReadResult;
      return JSON.stringify({ ok: true, shape: r.shape, data: r.data });
    }
    return JSON.stringify({ ok: true, shape: (result as BspWriteResult).shape });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
}

// ── Context composition (fills soft-agent branch 4 slots) ──

export interface ContextSlots {
  shell_summary: string;
  frame_summary: string;
  solid_history: string;
  user_message: string;
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
  // Beachcombing
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
  // Last 3 substantive (non-presence) marks at the current address.
  const filtered = marks
    .filter(m => !m.is_presence)
    .filter(m => !session.current_address || (m.address ?? '').startsWith(session.current_address))
    .slice(-3);
  if (filtered.length === 0) return '(no recent solid at this address)';
  return filtered
    .map(m => `${m.timestamp || '?'} — ${m.agent_id || '?'}: ${m.text}`)
    .join('\n');
}

export function composeContext(opts: {
  session: BeachSession;
  shell: AgentShell | null;
  face: Face;
  marks: MarkRow[];
  presence: PresenceMark[];
  frame: FrameView | null;
  userMessage: string;
}): ContextSlots {
  return {
    shell_summary: shellSummary(opts.shell, opts.face),
    frame_summary: frameSummary(opts.frame, opts.presence, opts.session),
    solid_history: solidHistory(opts.marks, opts.session),
    user_message: opts.userMessage,
  };
}

// ── System prompt (walk soft-agent branch 4 for slot labels) ──

function softAgentSlotLabel(digit: string): string {
  // Walk the in-memory soft-agent block at spindle "4.<digit>". The terminal
  // chain entry holds the slot label as authored in the block; we do NOT
  // reinvent the slot names.
  const block = getBlock('soft-agent');
  if (!block) return '';
  const result = walkLocal(block, '4.' + digit);
  if (result.mode === 'spindle' && result.nodes.length > 0) {
    return result.nodes[result.nodes.length - 1].text;
  }
  return '';
}

function softAgentDescription(): string {
  const block = getBlock('soft-agent');
  if (!block) return '';
  const u = collectUnderscore(block);
  return u || '';
}

export function buildSoftSystemPrompt(opts: {
  agentId: string;
  face: Face;
  ctx: ContextSlots;
}): string {
  const desc = softAgentDescription().replace(/\{name\}/g, opts.agentId || 'the user');

  const slot1 = softAgentSlotLabel('1') || 'Agent shell.';
  const slot2 = softAgentSlotLabel('2') || 'Frame: present agents, recent marks, sed stack at address.';
  const slot3 = softAgentSlotLabel('3') || 'Solid history: last 3 solids at this address.';

  const sections: string[] = [];
  sections.push(desc);
  sections.push('');
  sections.push('# Active context');
  sections.push(`agent_id: ${opts.agentId || '(anonymous)'}`);
  sections.push(`face: ${opts.face}`);
  sections.push('');
  sections.push(`# ${slot1}`);
  sections.push(opts.ctx.shell_summary);
  sections.push('');
  sections.push(`# ${slot2}`);
  sections.push(opts.ctx.frame_summary);
  sections.push('');
  sections.push(`# ${slot3}`);
  sections.push(opts.ctx.solid_history);
  sections.push('');
  sections.push('# How to use bsp — read carefully');
  sections.push('You hold six tools. The primary is `bsp`. Reads are free; writes pass through commit-gates derived from the user\'s shell at the active face. The five non-geometric primitives (pscale_create_collective, pscale_register, pscale_grain_reach, pscale_key_publish, pscale_verify_rider) are NOT yet wired in this client; if the user wants one, suggest the substrate tray (header icons).');
  sections.push('');
  sections.push('Walking discipline — DO NOT confuse a block with the content under it:');
  sections.push(' - bsp(spindle="") returns the WHOLE block — usually only the root underscore is interesting; the digit children are sub-positions you must walk.');
  sections.push(' - To enumerate marks at a beach, ALWAYS call: bsp(agent_id=<beach-url>, block="beach", spindle="1"). This returns the marks ring (positions 1.1..1.9). Walking the root alone will only show you the beach\'s own description, NOT the marks.');
  sections.push(' - Each entry under spindle="1" is either a string or an object {_, 1, 2, 3}. The _ underscore IS the mark content. The 1/2/3 fields tag agent_id / address / timestamp.');
  sections.push(' - Distinguishing presence from substantive: a mark whose _ matches /^\\S+ @ \\S+ — present at / is a presence heartbeat (filter it OUT when reporting marks). Anything else is the user\'s substantive contribution.');
  sections.push(' - Pool: bsp(agent_id=<beach-url>, block="beach", spindle="2.<N>") — Nth pool ring.');
  sections.push(' - Passport: bsp(agent_id=<them>, block="passport") — _ description, 1 offers, 2 needs, 9 keys.');
  sections.push(' - Frame disc: bsp(agent_id=<beach-url>, block="frame:<scene>") — entities at 1..9 with .1 liquid / .2 solid; _synthesis at the root.');
  sections.push(' - Cold contact (inbox replacement): a structured mark on a beach the recipient watches.');
  sections.push('');
  sections.push('When the user asks "what is here?" / "who is around?" / "what has X been thinking about?" — WALK the substrate at the right depth. If your first walk only returned a description, walk deeper. Do not invent. If a block is empty or absent after a real walk, name the gap.');
  sections.push('');
  sections.push('Note: the # Recent solid section above already reflects pre-filtered substantive marks at the user\'s current address. If it lists marks, those ARE present — do not contradict it by claiming the beach is empty.');
  sections.push('');
  sections.push('Keep your final answer 1–3 sentences, second-person present tense. Brief, grounded, conversational. Never narrate. Reflect, condense, surface options.');

  return sections.join('\n');
}

// ── Main entry point: tool-use loop ──

export interface SoftLLMOptions {
  apiKey: string;
  model: string;
  session: BeachSession;
  shell: AgentShell | null;
  face: Face;
  marks: MarkRow[];
  presence: PresenceMark[];
  frame: FrameView | null;
  userMessage: string;
  maxTurns?: number;
  maxTokens?: number;
  onToolCall?: (name: string, input: unknown) => void;
  onLog?: (msg: string) => void;
}

export interface SoftLLMResult {
  text: string;
  turns: number;
  toolCalls: Array<{ name: string; input: unknown }>;
}

export async function callClaudeWithTools(opts: SoftLLMOptions): Promise<SoftLLMResult> {
  const maxTurns = opts.maxTurns ?? 8;
  const maxTokens = opts.maxTokens ?? 1024;

  const ctx = composeContext({
    session: opts.session,
    shell: opts.shell,
    face: opts.face,
    marks: opts.marks,
    presence: opts.presence,
    frame: opts.frame,
    userMessage: opts.userMessage,
  });
  const systemPrompt = buildSoftSystemPrompt({
    agentId: opts.session.agent_id,
    face: opts.face,
    ctx,
  });

  const executorCtx: ExecutorContext = {
    session: opts.session,
    shell: opts.shell,
    face: opts.face,
    onLog: opts.onLog,
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const messages: Array<{ role: 'user' | 'assistant'; content: any }> = [
    { role: 'user', content: opts.userMessage },
  ];
  const toolCalls: Array<{ name: string; input: unknown }> = [];
  let lastUsage: { input_tokens?: number; output_tokens?: number } | undefined;
  let lastStop: string | null = null;

  for (let turn = 0; turn < maxTurns; turn++) {
    const data = await messagesApi(opts.apiKey, {
      model: opts.model,
      max_tokens: maxTokens,
      system: systemPrompt,
      tools: BSP_TOOLS,
      messages,
    });
    lastUsage = data.usage;
    lastStop = data.stop_reason;

    const content = data.content || [];
    messages.push({ role: 'assistant', content });

    if (data.stop_reason === 'tool_use') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const toolUses = content.filter((c: any) => c.type === 'tool_use');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const toolResults: any[] = [];
      for (const tu of toolUses) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const t = tu as unknown as { id: string; name: string; input: any };
        toolCalls.push({ name: t.name, input: t.input });
        opts.onToolCall?.(t.name, t.input);
        const result = await executeTool(t.name, t.input, executorCtx);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: t.id,
          content: result,
        });
      }
      messages.push({ role: 'user', content: toolResults });
      continue;
    }

    // end_turn or other terminal
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const text = content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n').trim();
    logFilmstrip({
      model: opts.model,
      system_prompt: systemPrompt,
      user_prompt: opts.userMessage,
      response: text,
      max_tokens: maxTokens,
      input_tokens: lastUsage?.input_tokens ?? null,
      output_tokens: lastUsage?.output_tokens ?? null,
      stop_reason: lastStop,
      extras: { tool_calls: toolCalls.length, turns: turn + 1 },
    });
    return { text: text || '(no response)', turns: turn + 1, toolCalls };
  }

  // Max turns exhausted — return whatever final text we have.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant') as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const text = lastAssistant?.content?.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n').trim() || '';
  logFilmstrip({
    model: opts.model,
    system_prompt: systemPrompt,
    user_prompt: opts.userMessage,
    response: text || '(max turns)',
    max_tokens: maxTokens,
    input_tokens: lastUsage?.input_tokens ?? null,
    output_tokens: lastUsage?.output_tokens ?? null,
    stop_reason: lastStop,
    extras: { tool_calls: toolCalls.length, turns: maxTurns, exhausted: true },
  });
  return { text: text || '(soft-LLM exhausted tool-use turns — try a more focused question)', turns: maxTurns, toolCalls };
}
