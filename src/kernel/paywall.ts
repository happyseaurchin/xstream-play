/**
 * paywall.ts — pure-function gate detection over bsp().
 *
 * Implements the read side of protocol-paywall §2 and §4, against the
 * already-wired bsp-client. No classes; envelopes are strings; grains are
 * bsp() reads behind the network. The federation guarantees of §6 (no
 * issuer allowlist, no badging, no interposition) live in call sites that
 * consume this module — keep them honoured there.
 *
 * Five reads + two helpers:
 *   readTickets(sedRef)              — _tickets metadata on a sed: collective
 *   readTicketGrain(grainRef)        — issuer-side underscore + revocation walk
 *   parseEnvelope(s)                 — string parser for [ticket ...] etc.
 *   scopeCompatible(env, coll)       — §2.4 rule 4 (cross-beach deferred to v2)
 *   validateTicketLocally({...})     — §4.3 rules, client-side optimism only
 *   walkVerifierAudit({...})         — canonical verdict from audit collective
 *   referenceGrainInRegistration(..) — Step B of registration two-write ritual
 *
 * Verification verdicts NEVER live on the registration position (the
 * registrant's sed: lock covers digit children and the verifier is a foreign
 * agent). They live in the verifier's own audit collective at
 * `sed:<verifier-bare-id>-audit-<yyyy-mm>`, one collective per calendar month.
 */

import { bsp, parseRef } from '../lib/bsp-client';
import type { BspReadResult, BspWriteResult, PscaleNode, ParsedRef } from '../lib/bsp-client';

// ── Types ──

export type TicketFace = 'character' | 'author' | 'designer' | 'observer';

/** The `_tickets` metadata field on a paywalled `sed:` collective. */
export interface TicketsField {
  issuer: string;
  purchase_url: string;
  face: TicketFace;
  scope: string;
  verifier: string;
}

/** Parsed `[ticket ...]` envelope. Strings stay strings. */
export interface TicketEnvelope {
  kind: 'ticket';
  face: string;
  scope: string;
  expires: string;
  tier?: string;
  seats?: string;
  nonce?: string;
  credits?: string;
  raw: string;
  extras: Record<string, string>;
}

export interface RevokedEnvelope { kind: 'revoked'; at: string; reason?: string; raw: string }
export interface VerifiedEnvelope { kind: 'verified'; by: string; at: string; registration?: string; grain?: string; raw: string }
export interface RejectedEnvelope { kind: 'rejected'; by: string; at: string; reason: string; registration?: string; grain?: string; raw: string }
export interface ExpiredEnvelope { kind: 'expired'; at: string; registration?: string; grain?: string; raw: string }

export type ParsedEnvelope =
  | TicketEnvelope
  | RevokedEnvelope
  | VerifiedEnvelope
  | RejectedEnvelope
  | ExpiredEnvelope
  | null;

// ── Envelope parsing ──

/**
 * Parse the FIRST recognised envelope clause in `s`. Returns null if none
 * found. Multiple envelopes are encoded as separate strings at separate
 * positions per the protocol — there is no compound envelope form.
 */
export function parseEnvelope(s: string | null | undefined): ParsedEnvelope {
  if (typeof s !== 'string') return null;
  // Longer alternatives first — JS alternation is leftmost; otherwise `ticket`
  // shadows `ticket-revoked` etc. because `\b` is satisfied at the hyphen.
  const m = s.match(/\[(ticket-revoked|ticket-verified|ticket-rejected|ticket-expired|ticket)\b([^\]]*)\]/);
  if (!m) return null;
  const tag = m[1];
  const fields = parseEnvelopeFields(m[2].trim());
  switch (tag) {
    case 'ticket': {
      const known = new Set(['face', 'scope', 'expires', 'tier', 'seats', 'nonce', 'credits']);
      const extras: Record<string, string> = {};
      for (const [k, v] of Object.entries(fields)) if (!known.has(k)) extras[k] = v;
      return {
        kind: 'ticket',
        face: fields.face ?? '', scope: fields.scope ?? '', expires: fields.expires ?? '',
        tier: fields.tier, seats: fields.seats, nonce: fields.nonce, credits: fields.credits,
        raw: m[0], extras,
      };
    }
    case 'ticket-revoked':
      return { kind: 'revoked', at: fields.at ?? '', reason: fields.reason, raw: m[0] };
    case 'ticket-verified':
      return { kind: 'verified', by: fields.by ?? '', at: fields.at ?? '', registration: fields.registration, grain: fields.grain, raw: m[0] };
    case 'ticket-rejected':
      return { kind: 'rejected', by: fields.by ?? '', at: fields.at ?? '', reason: fields.reason ?? '', registration: fields.registration, grain: fields.grain, raw: m[0] };
    case 'ticket-expired':
      return { kind: 'expired', at: fields.at ?? '', registration: fields.registration, grain: fields.grain, raw: m[0] };
  }
  return null;
}

function parseEnvelopeFields(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([a-zA-Z][\w-]*)=(?:"([^"]*)"|(\S+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) out[m[1]] = m[2] ?? m[3] ?? '';
  return out;
}

// ── Reads over bsp() ──

/**
 * Read the `_tickets` metadata on a collective. Null when absent (open
 * collective) or when required fields are missing.
 */
export async function readTickets(sedRef: string, containing_agent_id: string): Promise<TicketsField | null> {
  const parsed = parseRef(sedRef, containing_agent_id);
  const result = await bsp({ agent_id: parsed.agent_id, block: parsed.block, spindle: parsed.spindle });
  if (!result.ok) return null;
  const raw = (result as BspReadResult).raw;
  if (typeof raw !== 'object' || raw === null) return null;
  const t = (raw as Record<string, PscaleNode>)._tickets;
  if (typeof t !== 'object' || t === null) return null;
  const o = t as Record<string, PscaleNode>;
  const issuer = strField(o, 'issuer');
  const purchase_url = strField(o, 'purchase_url');
  const face = strField(o, 'face');
  const scope = strField(o, 'scope');
  if (!issuer || !purchase_url || !face || !scope) return null;
  const verifier = strField(o, 'verifier') || issuer;
  return { issuer, purchase_url, face: face as TicketFace, scope, verifier };
}

function strField(o: Record<string, PscaleNode>, k: string): string {
  const v = o[k];
  return typeof v === 'string' ? v : '';
}

/**
 * Read a ticket grain. The envelope is at the issuer-side underscore;
 * revocations are at digit children (`<issuer-side>.<n>`). We read the whole
 * grain block once and walk locally — sidesteps the negative-floor /
 * positive-floor pscale convention mismatch with the existing client.
 */
export async function readTicketGrain(grainRef: string, containing_agent_id: string): Promise<{
  envelope: TicketEnvelope | null;
  revoked: boolean;
  revokedRaw?: RevokedEnvelope;
  rawSideUnderscore?: string;
}> {
  const parsed = parseRef(grainRef, containing_agent_id);
  if (parsed.kind !== 'grain') return { envelope: null, revoked: false };
  const issuerSide = parsed.spindle;
  if (issuerSide !== '1' && issuerSide !== '2') return { envelope: null, revoked: false };

  const result = await bsp({ agent_id: parsed.agent_id, block: parsed.block });
  if (!result.ok) return { envelope: null, revoked: false };
  const raw = (result as BspReadResult).raw;
  if (typeof raw !== 'object' || raw === null) return { envelope: null, revoked: false };

  const side = (raw as Record<string, PscaleNode>)[issuerSide];
  let sideUnderscore = '';
  let sideObj: Record<string, PscaleNode> | null = null;
  if (typeof side === 'string') {
    sideUnderscore = side;
  } else if (typeof side === 'object' && side !== null) {
    sideObj = side as Record<string, PscaleNode>;
    sideUnderscore = typeof sideObj._ === 'string' ? sideObj._ as string : '';
  } else {
    return { envelope: null, revoked: false };
  }

  const env = parseEnvelope(sideUnderscore);
  const ticket = env && env.kind === 'ticket' ? env : null;

  let revoked = false;
  let revokedRaw: RevokedEnvelope | undefined;
  if (sideObj) {
    for (let d = 1; d <= 9; d++) {
      const child = sideObj[String(d)];
      const text = typeof child === 'string'
        ? child
        : (typeof child === 'object' && child !== null && typeof (child as Record<string, PscaleNode>)._ === 'string')
          ? (child as Record<string, PscaleNode>)._ as string
          : null;
      if (text === null) continue;
      const e = parseEnvelope(text);
      if (e && e.kind === 'revoked') { revoked = true; revokedRaw = e; break; }
    }
  }

  return { envelope: ticket, revoked, revokedRaw, rawSideUnderscore: sideUnderscore };
}

// ── Scope (§2.4 rule 4) ──

export type ScopeResult =
  | { ok: true }
  | { ok: false; reason: 'scope-mismatch' | 'cross-beach-scope-v2-deferred' };

/**
 * Compatibility between an envelope's `scope=` and the collective's
 * `_tickets.scope`. Two forms supported in v1:
 *   exact match — equal strings.
 *   frame pattern (`frame:foo-*`) — envelope glob that admits any matching
 *                                   collective scope.
 * Cross-beach scope (`beach:host`) is deferred to v2; v1 explicitly rejects
 * it so the affordance can show a coherent reason rather than silently
 * passing a check the verifier will fail.
 */
export function scopeCompatible(envelopeScope: string, collectiveScope: string): ScopeResult {
  if (envelopeScope.startsWith('beach:')) return { ok: false, reason: 'cross-beach-scope-v2-deferred' };
  if (envelopeScope === collectiveScope) return { ok: true };
  if (envelopeScope.endsWith('*')) {
    const pre = envelopeScope.slice(0, -1);
    if (collectiveScope.startsWith(pre)) return { ok: true };
  }
  return { ok: false, reason: 'scope-mismatch' };
}

// ── Local validation (§4.3) ──

export type LocalValidation = { ok: true } | { ok: false; reason: string };

/**
 * Apply §4.3 verification rules client-side. NOT canonical — the verifier's
 * audit collective is the source of truth (see walkVerifierAudit). This
 * exists for client-side optimism: deciding whether to bother running Step A,
 * rendering an expected-reason hint while the verifier is still ticking, and
 * skipping a fruitless wait on a grain we already know cannot pass.
 */
export function validateTicketLocally(opts: {
  envelope: TicketEnvelope | null;
  revoked: boolean;
  tickets: TicketsField;
  now?: Date;
}): LocalValidation {
  const env = opts.envelope;
  if (!env) return { ok: false, reason: 'no-ticket-envelope' };
  if (env.face !== opts.tickets.face) return { ok: false, reason: 'face-mismatch' };
  const sc = scopeCompatible(env.scope, opts.tickets.scope);
  if (sc.ok === false) return { ok: false, reason: sc.reason };
  if (!env.expires) return { ok: false, reason: 'no-expiry' };
  const exp = Date.parse(env.expires);
  if (!Number.isFinite(exp)) return { ok: false, reason: 'malformed-expiry' };
  const now = (opts.now ?? new Date()).getTime();
  if (exp <= now) return { ok: false, reason: 'expired' };
  if (opts.revoked) return { ok: false, reason: 'revoked' };
  if (env.credits !== undefined) return { ok: false, reason: 'credits-not-supported' };
  return { ok: true };
}

// ── Verifier audit walk (canonical verdict) ──

export type VerificationStatus =
  | { state: 'verified'; envelope: VerifiedEnvelope; collective: string; position: string }
  | { state: 'rejected'; envelope: RejectedEnvelope; collective: string; position: string }
  | { state: 'expired'; envelope: ExpiredEnvelope; collective: string; position: string }
  | { state: 'pending'; collectivesWalked: string[] };

/**
 * Strip a verifier identifier down to its bare name for audit-collective
 * naming. Conventions:
 *   https://host[/...] → host (lowercased)
 *   agent:<name>       → <name>
 *   <name>             → <name>
 * The verifier is responsible for matching this convention when it creates
 * its monthly audit collectives. If a deployment uses a non-standard form,
 * pass explicit collective refs to walkVerifierAudit instead of relying on
 * auditCollectiveRefsForVerifier.
 */
export function verifierBareId(verifierId: string): string {
  if (verifierId.startsWith('https://') || verifierId.startsWith('http://')) {
    try { return new URL(verifierId).hostname.toLowerCase(); } catch { return verifierId; }
  }
  if (verifierId.startsWith('agent:')) return verifierId.slice('agent:'.length);
  return verifierId;
}

/** YYYY-MM string (UTC) for the given date. */
export function yyyymm(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/**
 * Audit-collective refs the verifier is conventionally writing into for the
 * given moment. Returns [current month, previous month] — walk both to cover
 * registrations that landed just before a month boundary.
 */
export function auditCollectiveRefsForVerifier(verifierId: string, now: Date = new Date()): string[] {
  const bare = verifierBareId(verifierId);
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return [`sed:${bare}-audit-${yyyymm(now)}`, `sed:${bare}-audit-${yyyymm(prev)}`];
}

/**
 * Walk the verifier's audit collective(s) for an envelope matching the given
 * registration. Each entry in an audit collective is a `pscale_register`
 * whose underscore is the envelope; `registration=<sed:c:pos>` correlates
 * back to the originating registration. Returns the latest matching envelope
 * (by envelope `at=`), or `pending` if no match across all walked collectives.
 *
 * Pass either `audit_collective_refs` explicitly (preferred when verifier's
 * naming convention is non-standard) or the verifier identifier — the helper
 * computes [current, previous] month refs.
 */
export async function walkVerifierAudit(opts: {
  registration_ref: string;                    // sed:<collective>:<position>
  containing_agent_id: string;
  now?: Date;
  audit_collective_refs?: string[];
  verifier_id?: string;
}): Promise<VerificationStatus> {
  const refs = opts.audit_collective_refs
    ?? (opts.verifier_id ? auditCollectiveRefsForVerifier(opts.verifier_id, opts.now ?? new Date()) : []);
  if (refs.length === 0) return { state: 'pending', collectivesWalked: [] };

  type Match = { kind: 'verified' | 'rejected' | 'expired'; env: VerifiedEnvelope | RejectedEnvelope | ExpiredEnvelope; at: number; collective: string; position: string };
  const matches: Match[] = [];
  const walked: string[] = [];

  for (const ref of refs) {
    const parsed = parseRef(ref, opts.containing_agent_id);
    const result = await bsp({ agent_id: parsed.agent_id, block: parsed.block, spindle: parsed.spindle });
    walked.push(ref);
    if (!result.ok) continue;
    const raw = (result as BspReadResult).raw;
    if (typeof raw !== 'object' || raw === null) continue;
    const block = raw as Record<string, PscaleNode>;
    for (const [k, v] of Object.entries(block)) {
      if (k === '_' || k === '_tickets') continue;
      const text = typeof v === 'string'
        ? v
        : (typeof v === 'object' && v !== null && typeof (v as Record<string, PscaleNode>)._ === 'string')
          ? (v as Record<string, PscaleNode>)._ as string
          : null;
      if (text === null) continue;
      const env = parseEnvelope(text);
      if (!env) continue;
      if (env.kind !== 'verified' && env.kind !== 'rejected' && env.kind !== 'expired') continue;
      if (env.registration !== opts.registration_ref) continue;
      const atMs = Date.parse(env.at);
      if (!Number.isFinite(atMs)) continue;
      matches.push({ kind: env.kind, env, at: atMs, collective: ref, position: k });
    }
  }

  if (matches.length === 0) return { state: 'pending', collectivesWalked: walked };
  matches.sort((a, b) => b.at - a.at);
  const latest = matches[0];
  if (latest.kind === 'verified') return { state: 'verified', envelope: latest.env as VerifiedEnvelope, collective: latest.collective, position: latest.position };
  if (latest.kind === 'rejected') return { state: 'rejected', envelope: latest.env as RejectedEnvelope, collective: latest.collective, position: latest.position };
  return { state: 'expired', envelope: latest.env as ExpiredEnvelope, collective: latest.collective, position: latest.position };
}

// ── Step B: write grain reference into registration position ──

/**
 * Step B of the registration two-write ritual. After
 * `pscale_register(declaration="<self-description>")` returns the allocated
 * position, write the held grain reference to `<position>.1` of the
 * collective's block under the registrant's secret. This is `bsp()`, not a
 * separate primitive.
 *
 * grainRef is the canonical three-part form `grain:<pair_id>:<issuer-side>`.
 */
export async function referenceGrainInRegistration(opts: {
  caller_agent_id: string;
  collective_ref: string;
  position: string;
  grain_ref: string;
  registration_secret: string;
}): Promise<{ ok: boolean; error?: string }> {
  const parsed: ParsedRef = parseRef(opts.collective_ref, opts.caller_agent_id);
  const spindle = `${opts.position}.1`;
  const result = await bsp({
    agent_id: parsed.agent_id,
    block: parsed.block,
    spindle,
    content: opts.grain_ref,
    secret: opts.registration_secret,
  });
  return result.ok ? { ok: true } : { ok: false, error: (result as BspWriteResult).error };
}
