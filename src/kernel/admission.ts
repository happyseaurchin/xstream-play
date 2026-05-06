/**
 * admission.ts — the double-presence check.
 *
 * Vapour confirms an agent has *appeared*. Admission confirms the appearance
 * carries a meaning-maker. Pre-admission features (mark, vapour, submit,
 * view, identity) are always free; post-admission features (sign, grain,
 * sed:, key-publish, vapour-notifications, focused-column auto-poll) require
 * a valid claim at passport:8.
 *
 * The Hard-LLM doing admission is the gatekeeper — but the gatekeeper is a
 * SHELL, not the LLM. An LLM instance inhabits the gatekeeper shell for the
 * duration of the admission conversation: the hermitcrab pattern. Cognition
 * fluid, structure persistent. v0.1 hardcodes the shell here as a system
 * prompt (Variant B in the doc — detaches after admission); the proper form
 * is a substrate state-block per conventions.json:1.7, externalised in a
 * later phase. The evolved form is a Guardian — same shell pattern with
 * reflexive beach-ecosystem awareness. See docs/DESIGN-CHANNELS.md §
 * "The gatekeeper as hermitcrab."
 *
 * v0.1 is self-attested: the user's own API key calls a Hard-LLM gatekeeper;
 * on "admit" the claim is signed locally as "self-attested". Federated
 * gatekeeper endpoints with cryptographic verification come later.
 */

import { bsp } from '../lib/bsp-client';
import { messagesApi, logFilmstrip } from './claude-direct';
import { loadGatekeeper, buildSystemPrompt, type GatekeeperShell } from './gatekeeper';

/* ─────────────────────────── Types ─────────────────────────── */

export interface AdmissionClaim {
  summary: string;       // _: short cited line ("admitted — <line>")
  judge_id: string;      // 1: who attested
  timestamp: string;     // 2: ISO timestamp
  transcript_hash: string; // 3: sha256 of canonicalised transcript
  signature: string;     // 4: judge's signature; v0.1: "self-attested"
}

export type JudgeDecision = 'admit' | 'continue' | 'retry';

export interface JudgeResponse {
  decision: JudgeDecision;
  reply: string;        // text shown to the user
  summary?: string;     // one short cited line, only when admit
}

export interface ChallengeMessage {
  role: 'user' | 'assistant';
  content: string;
}

/* ─────────────────────── Read admission state ─────────────────────── */

/** Read passport:8 for a handle. Returns null if no claim, malformed, or
 * read fails. Empty handle / anon → null (anonymous can't be admitted). */
export async function getAdmissionState(handle: string): Promise<AdmissionClaim | null> {
  if (!handle || handle.startsWith('anon-')) return null;
  try {
    const result = await bsp({
      agent_id: handle,
      block: 'passport',
      spindle: '8',
    });
    if (result.kind !== 'read') return null;
    const node = (result as { kind: 'read'; content: unknown }).content;
    if (!node || typeof node !== 'object') return null;
    const obj = node as Record<string, unknown>;
    const summary = typeof obj._ === 'string' ? obj._ : '';
    if (!summary) return null;
    return {
      summary,
      judge_id: typeof obj['1'] === 'string' ? obj['1'] as string : '',
      timestamp: typeof obj['2'] === 'string' ? obj['2'] as string : '',
      transcript_hash: typeof obj['3'] === 'string' ? obj['3'] as string : '',
      signature: typeof obj['4'] === 'string' ? obj['4'] as string : '',
    };
  } catch {
    return null;
  }
}

/** Quick admitted check: claim exists with non-empty summary. v0.1 doesn't
 * verify the signature; later versions will. */
export function isAdmitted(claim: AdmissionClaim | null): boolean {
  return !!(claim && claim.summary);
}

/* ────────────────────── Hard-LLM challenge turn ────────────────────── */

/** Re-export for callers that need the loaded shell (e.g. the dialog reads
 * the opening from it). */
export { loadGatekeeper };
export type { GatekeeperShell };

/** Run one turn of the challenge. Sends the conversation history + a system
 * prompt built from the gatekeeper shell; returns the gatekeeper's decision
 * + reply text. messages history starts with the user's response to the
 * shell's opening; the LLM generates from turn 2. */
export async function runChallengeTurn(opts: {
  apiKey: string;
  model: string;
  shell: GatekeeperShell;
  messages: ChallengeMessage[];
  userTurnsSoFar: number;
}): Promise<JudgeResponse> {
  const { apiKey, model, shell, messages, userTurnsSoFar } = opts;
  const systemPrompt = buildSystemPrompt(shell);
  const apiMessages = messages.map(m => ({ role: m.role, content: m.content }));
  const data = await messagesApi(apiKey, {
    model,
    max_tokens: 400,
    system: systemPrompt + (userTurnsSoFar >= 3
      ? '\n\nThe user has spoken 3 times now. You MUST decide admit or retry — continue is no longer allowed.'
      : ''),
    messages: apiMessages,
  });
  const text = data.content?.[0]?.type === 'text' ? (data.content[0] as { text: string }).text : '';
  logFilmstrip({
    model,
    system_prompt: systemPrompt,
    user_prompt: apiMessages.map(m => `[${m.role}] ${m.content}`).join('\n'),
    response: text,
    max_tokens: 400,
    input_tokens: data.usage?.input_tokens ?? null,
    output_tokens: data.usage?.output_tokens ?? null,
    stop_reason: data.stop_reason ?? null,
    extras: { kind: 'admission', userTurns: userTurnsSoFar, shellSource: shell.source },
  });

  const parsed = parseJudgeJson(text);
  if (!parsed) {
    return {
      decision: userTurnsSoFar >= 3 ? 'retry' : 'continue',
      reply: text.trim() || 'Sorry, that didn\'t come through. Try saying it again?',
    };
  }
  // Hard cap: never let the LLM continue past 3 user turns.
  if (parsed.decision === 'continue' && userTurnsSoFar >= 3) {
    return { ...parsed, decision: 'retry', reply: 'Not quite landing yet — that\'s fine. Hang out on the beach for a bit, try again whenever. No rush.' };
  }
  return parsed;
}

function parseJudgeJson(text: string): JudgeResponse | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const obj = JSON.parse(match[0]) as Partial<JudgeResponse>;
    if (obj.decision !== 'admit' && obj.decision !== 'continue' && obj.decision !== 'retry') return null;
    if (typeof obj.reply !== 'string' || !obj.reply) return null;
    return {
      decision: obj.decision,
      reply: obj.reply,
      summary: typeof obj.summary === 'string' ? obj.summary : undefined,
    };
  } catch {
    return null;
  }
}

/* ─────────────────────── Commit admission claim ─────────────────────── */

/** Hash the canonicalised transcript with sha256, return hex. */
async function transcriptHash(messages: ChallengeMessage[]): Promise<string> {
  const canonical = messages.map(m => `${m.role}: ${m.content}`).join('\n');
  const buf = new TextEncoder().encode(canonical);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Write the admission claim to passport:8. v0.1: judge_id = handle (self),
 * signature = "self-attested". Returns true on successful write. */
export async function commitAdmission(opts: {
  handle: string;
  secret: string;
  transcript: ChallengeMessage[];
  summary: string;
}): Promise<boolean> {
  const { handle, secret, transcript, summary } = opts;
  if (!handle || !secret) return false;
  const hash = await transcriptHash(transcript);
  const claim = {
    _: `admitted — ${summary}`,
    '1': handle,                  // self-judge in v0.1
    '2': new Date().toISOString(),
    '3': hash,
    '4': 'self-attested',
  };
  try {
    const result = await bsp({
      agent_id: handle,
      block: 'passport',
      spindle: '8',
      content: claim,
      secret,
    });
    return result.kind === 'write' && (result as { ok?: boolean }).ok !== false;
  } catch {
    return false;
  }
}
