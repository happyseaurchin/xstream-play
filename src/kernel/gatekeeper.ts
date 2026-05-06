/**
 * gatekeeper.ts — load the gatekeeper shell and build the admission prompt.
 *
 * The gatekeeper is a substrate state-block (per conventions.json:1.7 — a
 * digit-keyed block whose geometry encodes the role). An LLM inhabits this
 * shell at admission time: cognition fluid, structure persistent. The
 * sentinel agent_id is `pscale` (bare-name → commons substrate); this is
 * the substrate-wide canonical identifier for sentinel role-shells. See
 * docs/DESIGN-CHANNELS.md § "The gatekeeper as hermitcrab."
 *
 * Load order (first hit wins):
 *   1. (current beach, 'gatekeeper') — per-beach override
 *   2. (pscale, 'gatekeeper')        — substrate-wide canonical default
 *   3. blocks/gatekeeper.json        — seeded fallback compiled into client
 *
 * The shell layout (digit positions):
 *   _ : description
 *   1 : voice rules
 *   2 : criteria (sub-block: admit signals, retry signals, language-agnostic note)
 *   3 : opening question (shown to the user as turn 1)
 *   4 : turn-2 follow-up patterns (sub-block of examples)
 *   5 : decision rules
 *   6 : reply copy by decision
 *   7 : host invocation patterns (host-invoked vs reflective; v0.3+)
 *   9 : metadata
 */

import { bsp } from '../lib/bsp-client';
import seedShellRaw from '../../blocks/gatekeeper.json';

type Node = string | { [k: string]: unknown };

export interface GatekeeperShell {
  voice: string;
  criteria: string;
  opening: string;
  turn2_patterns: string[];
  decisions: string;
  copy: string;
  /** Branch 7: host invocation patterns. Teaches third-party LLM-app
   * clients (claude-app, etc.) the reflective admission pattern — read
   * this shell, run the conversation in-session with the user, write
   * passport:8 directly. The xstream client doesn't *need* this branch
   * (its host pattern is wired in code), but baking it into the prompt
   * keeps the shell self-similar across hosts and preserves the framing
   * that admission is structural-not-categorical regardless of runtime. */
  host_invocation: string;
  /** Which layer of the fallback chain provided the shell. */
  source: 'beach' | 'pscale' | 'seed';
}

/** Substrate-wide sentinel agent_id. Bare-name → commons. All canonical
 * sentinel role-shells (gatekeeper, invite, future roles) live here unless
 * a beach overrides them locally. */
const SENTINEL_AGENT_ID = 'pscale';
const seedShell = seedShellRaw as Record<string, unknown>;

/** Try to load a gatekeeper shell from a beach/agent via bsp(). Returns the
 * raw block content or null on miss/error. */
async function tryLoadFrom(agentId: string): Promise<Record<string, unknown> | null> {
  try {
    const r = await bsp({ agent_id: agentId, block: 'gatekeeper' });
    if (r.kind !== 'read') return null;
    const content = (r as { kind: 'read'; content: unknown }).content;
    if (!content || typeof content !== 'object') return null;
    return content as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Load the gatekeeper shell for a given beach. Walks the fallback chain;
 * always returns something usable. */
export async function loadGatekeeper(currentBeach: string): Promise<GatekeeperShell> {
  // 1. Per-beach override
  if (currentBeach && currentBeach !== SENTINEL_AGENT_ID) {
    const raw = await tryLoadFrom(currentBeach);
    if (raw) return shapeShell(raw, 'beach');
  }
  // 2. Substrate-wide canonical at (pscale, 'gatekeeper')
  const sentinel = await tryLoadFrom(SENTINEL_AGENT_ID);
  if (sentinel) return shapeShell(sentinel, 'pscale');
  // 3. Seeded fallback compiled into the client
  return shapeShell(seedShell, 'seed');
}

/** Walk a digit-keyed sub-block into a plain newline-joined string. The _
 * underscore comes first if present; then digit children in order. */
function flattenNode(node: Node | undefined): string {
  if (node === undefined || node === null) return '';
  if (typeof node === 'string') return node;
  if (typeof node !== 'object') return '';
  const obj = node as Record<string, unknown>;
  const lines: string[] = [];
  if (typeof obj._ === 'string' && obj._) lines.push(obj._);
  for (let i = 1; i <= 9; i++) {
    const child = obj[String(i)] as Node | undefined;
    if (child === undefined) continue;
    if (typeof child === 'string') {
      lines.push(`${i}. ${child}`);
    } else {
      const inner = flattenNode(child);
      if (inner) lines.push(`${i}. ${inner.split('\n').join('\n   ')}`);
    }
  }
  return lines.join('\n');
}

/** Extract a list of strings from a digit-keyed sub-block. Skips _ (header)
 * and any non-string children. Used for turn-2 patterns. */
function extractList(node: Node | undefined): string[] {
  if (!node || typeof node === 'string') return [];
  const obj = node as Record<string, unknown>;
  const out: string[] = [];
  for (let i = 1; i <= 9; i++) {
    const child = obj[String(i)];
    if (typeof child === 'string') out.push(child);
  }
  return out;
}

function shapeShell(raw: Record<string, unknown>, source: GatekeeperShell['source']): GatekeeperShell {
  const voice = typeof raw['1'] === 'string' ? raw['1'] : flattenNode(raw['1'] as Node);
  const criteria = flattenNode(raw['2'] as Node);
  const opening = typeof raw['3'] === 'string' ? raw['3'] : flattenNode(raw['3'] as Node);
  const turn2_patterns = extractList(raw['4'] as Node);
  const decisions = flattenNode(raw['5'] as Node);
  const copy = flattenNode(raw['6'] as Node);
  const host_invocation = flattenNode(raw['7'] as Node);
  return { voice, criteria, opening, turn2_patterns, decisions, copy, host_invocation, source };
}

/** Build the system prompt the LLM sees when inhabiting the gatekeeper
 * shell. The opening is shown to the user separately — it's not in the
 * prompt because the user already saw it. */
export function buildSystemPrompt(shell: GatekeeperShell): string {
  const patterns = shell.turn2_patterns.length
    ? shell.turn2_patterns.map(p => `- "${p}"`).join('\n')
    : '(none defined)';
  return `You are xstream's admission gatekeeper — an LLM inhabiting the gatekeeper shell for this admission conversation. The shell defines the role; you bring the cognition. Cognition fluid, structure persistent: the hermitcrab pattern.

Your role: meet a person (or LLM) reaching for the alive substrate of xstream for the first time, and decide whether they show up in the receptive-predictive state — the capacity to hold meaning in its forming-state across turns. The conversation IS the gate AND demonstrates what xstream is for.

VOICE
${shell.voice}

CRITERIA
${shell.criteria}

OPENING (already shown to the user; their first message in the conversation history is their reply to this)
"${shell.opening}"

YOUR FOLLOW-UP — example patterns
${patterns}

Read their answer. Pick one specific thread. Pull them into the situation around what they said, the negative space, or the predictive forward.

DECISION RULES
${shell.decisions}

REPLY COPY BY DECISION
${shell.copy}

${shell.host_invocation ? `HOST INVOCATION CONTEXT
${shell.host_invocation}

` : ''}A bot wrapping an LLM around this can fake one turn. It struggles to sustain coherence across turns when you pull on a thread it didn't originate.

OUTPUT — strict JSON only, no prose outside:
{"decision": "admit" | "continue" | "retry", "reply": "<text shown to user>", "summary": "<short cited line, ONLY when admit>"}`;
}
