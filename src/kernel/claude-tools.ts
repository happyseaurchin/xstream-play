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

import { bsp as bspCall, pscaleRegister, pscaleGrainReach, pscaleKeyPublish, pscaleCreateCollective, pscaleVerifyRider, type BspParams, type BspReadResult, type BspWriteResult, type Face, type Tier, type AgentShell, type PresenceMark } from '../lib/bsp-client';
import type { BeachSession, MarkRow, FrameView } from './beach-session';
import { logFilmstrip } from './claude-direct';
import { resolveRecipe, runRecipe, buildRecipeSystemPrompt } from './recipe-runner';
import type { SettingsContext } from './settings-reader';

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
    description: 'Create a new sed: collective. Admin op — sets root underscore (conventions) and the creator passphrase that locks future admin writes.',
    input_schema: {
      type: 'object',
      properties: {
        collective: { type: 'string', description: 'Collective name; becomes sed:<name>.' },
        conventions: { type: 'string', description: 'Rules of play — becomes the root underscore of the new sed: block.' },
        creator_passphrase: { type: 'string', description: 'Admin passphrase. Sensitive — only call when the user has explicitly provided it for this purpose.' },
      },
      required: ['collective', 'conventions', 'creator_passphrase'],
    },
  },
  {
    name: 'pscale_register',
    description: 'Claim a server-assigned position in a sed: collective in landing order. Atomic create-lock-write. The position is permanent (proof-of-presence-in-time).',
    input_schema: {
      type: 'object',
      properties: {
        collective: { type: 'string', description: 'Target collective name (without sed: prefix), e.g. "commons" or "designers".' },
        declaration: { type: 'string', description: 'Who you are and what you offer/need — becomes the underscore at your position.' },
        passphrase: { type: 'string', description: 'Write-lock passphrase for your position. Sensitive — only use the user\'s session secret with their explicit consent.' },
        shell_ref: { type: 'string', description: 'Optional URL or block reference to the agent\'s sovereign shell.' },
      },
      required: ['collective', 'declaration', 'passphrase'],
    },
  },
  {
    name: 'pscale_grain_reach',
    description: 'Symmetric reach/accept across a bilateral pair_id (sha256(sort(A,B))[:16]). Atomic create-lock-write per side. First call from either party initialises the grain; second call from the other party completes it.',
    input_schema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'The caller\'s agent_id (bare — not grain: or sed:).' },
        partner_agent_id: { type: 'string', description: 'The other side\'s agent_id. Must differ from agent_id.' },
        description: { type: 'string', description: 'Mutual description — becomes the root underscore of the grain. Used only on first reach; ignored on accept.' },
        my_side_content: { type: 'string', description: 'What you write at your side\'s underscore — your synthesis or commitment statement.' },
        my_passphrase: { type: 'string', description: 'Write-lock passphrase for your side. Sensitive — only use with explicit user consent.' },
      },
      required: ['agent_id', 'partner_agent_id', 'description', 'my_side_content', 'my_passphrase'],
    },
  },
  {
    name: 'pscale_key_publish',
    description: 'Derive Argon2id keypair from secret+agent_id and publish public halves (ed25519 + x25519) to passport:9. Required for gray-encrypted communications and rider signing.',
    input_schema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'The user\'s agent_id; must already have a passport block.' },
        secret: { type: 'string', description: 'Passphrase or local block hash — combined with agent_id as derivation salt. Sensitive.' },
      },
      required: ['agent_id', 'secret'],
    },
  },
  {
    name: 'propose_liquid',
    description:
      'Put a proposal into the user\'s LIQUID layer at the current scope. This is how soft writes — never via bsp. Liquid pools with peer liquid where shared (in-frame, the entity\'s .1 slot). The user then clicks commit to fire medium synthesis, which produces the solid substrate edit. ' +
      'Use this when the user has asked you to draft, propose, refine, or compose something they intend to commit. Do NOT use this for casual conversational replies — for those, just answer in text. Reply text continues the chat; propose_liquid stages something for the user to commit.',
    input_schema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'The proposal text — what you would have the user commit. Will land in liquid; medium synthesises it on commit.' },
      },
      required: ['text'],
    },
  },
  {
    name: 'pscale_verify_rider',
    description: 'Deterministic arithmetic check on a Level-2 ecosquared rider. Returns verdict (pass/warn/fail/skip).',
    input_schema: {
      type: 'object',
      properties: {
        sender_agent_id: { type: 'string', description: 'Whose passport to load for credit and SQ checks.' },
        rider: { type: 'string', description: 'The rider JSON object as a string.' },
        probe_id: { type: 'string' },
        chain: { type: 'string', description: 'JSON array of chain hops [{agent, sig}, ...].' },
        topic_coordinate: { type: 'string', description: 'Pscale coordinate of the topic for SQ recompute.' },
      },
      required: ['sender_agent_id'],
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
  onProposeLiquid?: (text: string) => Promise<{ ok: boolean; scope: string; error?: string }>;
}

export async function executeTool(
  name: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  input: Record<string, any>,
  ctx: ExecutorContext
): Promise<string> {
  if (name === 'bsp') return executeBsp(input, ctx);
  if (name === 'propose_liquid') {
    const text = typeof input.text === 'string' ? input.text.trim() : '';
    if (!text) return JSON.stringify({ ok: false, error: 'propose_liquid requires non-empty text.' });
    if (!ctx.onProposeLiquid) {
      return JSON.stringify({ ok: false, error: 'propose_liquid is not wired in this context (no callback registered).' });
    }
    ctx.onLog?.(`💧 propose_liquid: ${text.slice(0, 80)}`);
    const r = await ctx.onProposeLiquid(text);
    return JSON.stringify(r);
  }
  if (name === 'pscale_register') {
    ctx.onLog?.(`mcp pscale_register collective=${input.collective}`);
    const r = await pscaleRegister({
      collective: String(input.collective ?? ''),
      declaration: String(input.declaration ?? ''),
      passphrase: String(input.passphrase ?? ctx.session.secret ?? ''),
      shell_ref: typeof input.shell_ref === 'string' ? input.shell_ref : undefined,
    });
    return JSON.stringify(r);
  }
  if (name === 'pscale_grain_reach') {
    ctx.onLog?.(`mcp pscale_grain_reach with=${input.partner_agent_id}`);
    const r = await pscaleGrainReach({
      agent_id: String(input.agent_id ?? ctx.session.agent_id ?? ''),
      partner_agent_id: String(input.partner_agent_id ?? ''),
      description: String(input.description ?? ''),
      my_side_content: String(input.my_side_content ?? ''),
      my_passphrase: String(input.my_passphrase ?? ctx.session.secret ?? ''),
    });
    return JSON.stringify(r);
  }
  if (name === 'pscale_key_publish') {
    ctx.onLog?.(`mcp pscale_key_publish`);
    const r = await pscaleKeyPublish({
      agent_id: String(input.agent_id ?? ctx.session.agent_id ?? ''),
      secret: String(input.secret ?? ctx.session.secret ?? ''),
    });
    return JSON.stringify(r);
  }
  if (name === 'pscale_create_collective') {
    ctx.onLog?.(`mcp pscale_create_collective name=${input.collective}`);
    const r = await pscaleCreateCollective({
      collective: String(input.collective ?? ''),
      conventions: String(input.conventions ?? ''),
      creator_passphrase: String(input.creator_passphrase ?? ''),
    });
    return JSON.stringify(r);
  }
  if (name === 'pscale_verify_rider') {
    ctx.onLog?.(`mcp pscale_verify_rider sender=${input.sender_agent_id}`);
    const r = await pscaleVerifyRider({
      sender_agent_id: String(input.sender_agent_id ?? ''),
      rider: typeof input.rider === 'string' ? input.rider : undefined,
      probe_id: typeof input.probe_id === 'string' ? input.probe_id : undefined,
      chain: typeof input.chain === 'string' ? input.chain : undefined,
      topic_coordinate: typeof input.topic_coordinate === 'string' ? input.topic_coordinate : undefined,
    });
    return JSON.stringify(r);
  }
  return JSON.stringify({ ok: false, error: `unknown tool: ${name}` });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function executeBsp(input: Record<string, any>, ctx: ExecutorContext): Promise<string> {
  if (typeof input.agent_id !== 'string' || typeof input.block !== 'string') {
    return JSON.stringify({ ok: false, error: 'bsp requires agent_id (string) and block (string).' });
  }
  const isWrite = input.content !== undefined;

  // No hardcoded restriction on writes. The LLM is equipped with bsp-mcp
  // and the user's session secret; gating, if any, is the LLM's reading
  // of the user's shell — not a refusal here.

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
      // Always include `raw` so the LLM can recover from a wrong-shape call.
      // Federated GETs already fetch the whole block server-side; cost is sunk.
      return JSON.stringify({ ok: true, shape: r.shape, data: r.data, raw: r.raw });
    }
    return JSON.stringify({ ok: true, shape: (result as BspWriteResult).shape });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
}

// ── Context composition: now lives in recipe-runner.ts as gather slots ──
//
// composeContext / buildSoftSystemPrompt have moved into recipe-runner.ts
// (built-in default soft recipe + GATHERS dispatch). The system prompt is
// assembled from a substrate-authored recipe block, not hardcoded TS.

// ── Beta spike: Anthropic Messages API mcp_servers connector ──
//
// Anthropic's Messages API (beta) accepts an mcp_servers param: Claude calls
// the named MCP server directly, server-side, bypassing this client's tool
// loop entirely. If the bsp-mcp server speaks the streamable-HTTP transport
// the connector expects, this collapses our in-client loop to a single API
// call. Face-gating still has to be in-client (per agent-shell §"Gate
// Interpretation v0.1": gates are client-side context filters), so this is a
// transport-only swap.
//
// Toggled at runtime by the URL query param `?mcp=connector` (read in App.tsx).
// On failure, the in-client loop is the fallback; we surface the error verbatim
// so the user can tell whether the MCP server URL is reachable / speaks the
// right protocol.

const BSP_MCP_CONNECTOR_URL = 'https://bsp.hermitcrab.me/mcp/v1';

export interface ConnectorOptions {
  apiKey: string;
  model: string;
  systemPrompt: string;
  userMessage: string;
  maxTokens?: number;
}

export interface ConnectorResult {
  text: string;
  raw: unknown;
}

export async function callClaudeViaMcpConnector(opts: ConnectorOptions): Promise<ConnectorResult> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': opts.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'mcp-client-2025-04-04',
      'content-type': 'application/json',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: opts.model,
      max_tokens: opts.maxTokens ?? 1024,
      system: opts.systemPrompt,
      mcp_servers: [{ type: 'url', url: BSP_MCP_CONNECTOR_URL, name: 'bsp-mcp' }],
      messages: [{ role: 'user', content: opts.userMessage }],
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`MCP connector ${res.status}: ${err.slice(0, 600)}`);
  }
  const data = await res.json();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const content = (data.content || []) as Array<{ type: string; [k: string]: any }>;
  const text = content.filter(c => c.type === 'text').map(c => c.text).join('\n').trim();
  logFilmstrip({
    model: opts.model,
    system_prompt: opts.systemPrompt,
    user_prompt: opts.userMessage,
    response: text,
    max_tokens: opts.maxTokens ?? 1024,
    input_tokens: data.usage?.input_tokens ?? null,
    output_tokens: data.usage?.output_tokens ?? null,
    stop_reason: data.stop_reason ?? null,
    extras: { transport: 'mcp-connector', server: BSP_MCP_CONNECTOR_URL },
  });
  return { text: text || '(no response from MCP connector path)', raw: data };
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
  settingsContext: SettingsContext;
  maxTurns?: number;
  maxTokens?: number;
  onToolCall?: (name: string, input: unknown) => void;
  onLog?: (msg: string) => void;
  onProposeLiquid?: (text: string) => Promise<{ ok: boolean; scope: string; error?: string }>;
}

export interface SoftLLMResult {
  text: string;
  turns: number;
  toolCalls: Array<{ name: string; input: unknown }>;
}

/**
 * Soft entry point — resolves the soft recipe (substrate-authored or built-in
 * default), gathers context per the recipe template, dispatches via runRecipe.
 * Tool catalogue + executor live here; system-prompt assembly is recipe-driven.
 */
export async function callClaudeWithTools(opts: SoftLLMOptions): Promise<SoftLLMResult> {
  const recipe = resolveRecipe('soft', opts.face, opts.settingsContext);
  const executorCtx: ExecutorContext = {
    session: opts.session,
    shell: opts.shell,
    face: opts.face,
    onLog: opts.onLog,
    onProposeLiquid: opts.onProposeLiquid,
  };

  // Observer face is read-only by spec (xstream-frame protocol §5.4 +
  // bundles:1.4 "tools: bsp(read-only)"). Strip propose_liquid so the
  // soft-LLM cannot stage liquid for commit under this face.
  const tools = opts.face === 'observer'
    ? BSP_TOOLS.filter(t => t.name !== 'propose_liquid')
    : BSP_TOOLS;

  const r = await runRecipe({
    recipe,
    inputs: {
      session: opts.session, shell: opts.shell, face: opts.face,
      marks: opts.marks, presence: opts.presence,
      frame: opts.frame, pool: null,
    },
    userMessage: opts.userMessage,
    apiKey: opts.apiKey,
    defaultModel: opts.model,
    // Anthropic constraint: max_tokens > thinking.budget_tokens. 8192 total
    // leaves ~3000 for output after thinking (reply text + tool JSON).
    defaultMaxTokens: opts.maxTokens ?? 8192,
    // Extended thinking gives soft a scratchpad for multi-step substrate
    // navigation: reading reaches, extracting fields, picking partner ids.
    defaultThinkingBudget: 5000,
    tools,
    toolExecutor: (name, input) => executeTool(name, input, executorCtx),
    maxTurns: opts.maxTurns ?? 12,
    telemetry: { tier: 'soft', face: opts.face },
    onToolCall: opts.onToolCall,
  });

  return {
    text: r.text === '(bundle exhausted tool-use turns)'
      ? '(soft-LLM exhausted tool-use turns — try a more focused question)'
      : r.text,
    turns: r.turns,
    toolCalls: r.toolCalls,
  };
}

// ── Connector-path system prompt assembly ──
//
// Convenience for callers that need the recipe-built system prompt without
// running the in-client tool loop (e.g. the Anthropic MCP connector path).
// Resolves the soft recipe, builds the system prompt, returns it. The caller
// passes it to callClaudeViaMcpConnector.

export function buildSoftRecipePrompt(opts: {
  session: BeachSession;
  shell: AgentShell | null;
  face: Face;
  marks: MarkRow[];
  presence: PresenceMark[];
  frame: FrameView | null;
  settingsContext: SettingsContext;
}): string {
  const recipe = resolveRecipe('soft', opts.face, opts.settingsContext);
  return buildRecipeSystemPrompt(recipe, {
    session: opts.session, shell: opts.shell, face: opts.face,
    marks: opts.marks, presence: opts.presence, frame: opts.frame, pool: null,
  });
}
