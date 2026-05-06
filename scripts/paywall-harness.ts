/**
 * paywall-harness.ts — exercises src/kernel/paywall.ts against the live
 * bsp-mcp commons fixture. Phase 0 validation.
 *
 * Runs three batteries:
 *   1. Offline parseEnvelope / scopeCompatible / validateTicketLocally tests
 *      with synthetic envelopes (deterministic, no network).
 *   2. Live read of the grain at pair_id=78734eba7d9a41ba — dumps the block,
 *      then readTicketGrain on each side, parsing the envelope.
 *   3. Verifier-audit walk against a pinned registration if AUDIT_REGISTRATION
 *      and AUDIT_VERIFIER_ID are set in env; otherwise prints the computed
 *      collective refs and skips the walk.
 *
 * Usage:
 *   node --env-file=.env.local --import tsx ./scripts/paywall-harness.ts
 *   AUDIT_REGISTRATION=sed:thornkeep-001-cast:11 \
 *   AUDIT_VERIFIER_ID=agent:thornkeep-verifier \
 *     node --env-file=.env.local --import tsx ./scripts/paywall-harness.ts
 *
 * No browser. No Vite. Boots a Supabase client from process.env, primes the
 * shared instance via _setSupabaseForTest, then drives bsp() reads through
 * the same code paths the browser uses.
 */

import { createClient } from '@supabase/supabase-js';
import { _setSupabaseForTest } from '../src/lib/supabase';
import { bsp } from '../src/lib/bsp-client';
import {
  parseEnvelope,
  scopeCompatible,
  validateTicketLocally,
  readTicketGrain,
  readTickets,
  walkVerifierAudit,
  auditCollectiveRefsForVerifier,
  verifierBareId,
  yyyymm,
} from '../src/kernel/paywall';
import type { TicketsField, TicketEnvelope } from '../src/kernel/paywall';

const url = process.env.VITE_SUPABASE_URL;
const key = process.env.VITE_SUPABASE_ANON_KEY;
if (!url || !key) {
  console.error('VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY missing. Run with --env-file=.env.local.');
  process.exit(1);
}
_setSupabaseForTest(createClient(url, key));

let pass = 0;
let fail = 0;
function assert(name: string, cond: boolean, detail?: unknown): void {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`); }
}

function section(title: string): void {
  console.log(`\n── ${title} ──`);
}

const FIXTURE_GRAIN = 'grain:78734eba7d9a41ba';
const CONTAINING = 'agent:harness';

async function offlineEnvelopeTests(): Promise<void> {
  section('parseEnvelope — synthetic');
  {
    const e = parseEnvelope('[ticket face=character scope=frame:thornkeep-001 expires=2026-12-31T23:59:59Z]');
    assert('parses ticket', e?.kind === 'ticket', e);
    assert('face=character', e?.kind === 'ticket' && e.face === 'character');
    assert('scope=frame:thornkeep-001', e?.kind === 'ticket' && e.scope === 'frame:thornkeep-001');
    assert('expires preserved', e?.kind === 'ticket' && e.expires === '2026-12-31T23:59:59Z');
  }
  {
    const e = parseEnvelope('[ticket face=designer scope=frame:* expires=2027-01-01T00:00:00Z tier=hard nonce=abc]');
    assert('parses tier+nonce', e?.kind === 'ticket' && e.tier === 'hard' && e.nonce === 'abc');
  }
  {
    const e = parseEnvelope('[ticket face=author scope=frame:foo expires=2026-12-01T00:00:00Z credits=10]');
    assert('credits captured', e?.kind === 'ticket' && e.credits === '10');
  }
  {
    const e = parseEnvelope('[ticket-revoked at=2026-05-01T00:00:00Z reason=refunded]');
    assert('parses revoked', e?.kind === 'revoked' && e.at.startsWith('2026-05-01') && e.reason === 'refunded');
  }
  {
    const e = parseEnvelope('[ticket-verified by=agent:v at=2026-05-01T12:00:00Z registration=sed:cast:11 grain=grain:abc:1]');
    assert('parses verified+correlation', e?.kind === 'verified' && e.registration === 'sed:cast:11' && e.grain === 'grain:abc:1');
  }
  {
    const e = parseEnvelope('[ticket-rejected by=agent:v at=2026-05-01T12:00:00Z reason=expired registration=sed:cast:11 grain=grain:abc:1]');
    assert('parses rejected with reason', e?.kind === 'rejected' && e.reason === 'expired');
  }
  {
    const e = parseEnvelope('plain prose with no envelope');
    assert('returns null for plain prose', e === null);
  }

  section('scopeCompatible');
  assert('exact match passes', scopeCompatible('frame:thornkeep-001', 'frame:thornkeep-001').ok === true);
  assert('pattern admits narrower', scopeCompatible('frame:thornkeep-*', 'frame:thornkeep-001').ok === true);
  assert('pattern rejects unrelated', scopeCompatible('frame:thornkeep-*', 'frame:other-001').ok === false);
  assert('mismatch reason', (() => { const r = scopeCompatible('frame:a', 'frame:b'); return r.ok === false && r.reason === 'scope-mismatch'; })());
  assert('beach: deferred to v2', (() => { const r = scopeCompatible('beach:cyrus.example', 'frame:foo-001'); return r.ok === false && r.reason === 'cross-beach-scope-v2-deferred'; })());

  section('validateTicketLocally');
  const future = new Date(Date.now() + 86400_000).toISOString();
  const past = new Date(Date.now() - 86400_000).toISOString();
  const tickets: TicketsField = {
    issuer: 'agent:test-tickets',
    purchase_url: 'https://example/buy',
    face: 'character',
    scope: 'frame:thornkeep-001',
    verifier: 'agent:test-tickets',
  };
  const okEnv: TicketEnvelope = {
    kind: 'ticket', face: 'character', scope: 'frame:thornkeep-001', expires: future,
    raw: '[ticket ...]', extras: {},
  };
  assert('happy path', validateTicketLocally({ envelope: okEnv, revoked: false, tickets }).ok === true);
  assert('expired rejected', (() => {
    const r = validateTicketLocally({ envelope: { ...okEnv, expires: past }, revoked: false, tickets });
    return r.ok === false && r.reason === 'expired';
  })());
  assert('face-mismatch', (() => {
    const r = validateTicketLocally({ envelope: { ...okEnv, face: 'author' }, revoked: false, tickets });
    return r.ok === false && r.reason === 'face-mismatch';
  })());
  assert('revoked rejected', (() => {
    const r = validateTicketLocally({ envelope: okEnv, revoked: true, tickets });
    return r.ok === false && r.reason === 'revoked';
  })());
  assert('credits rejected', (() => {
    const r = validateTicketLocally({ envelope: { ...okEnv, credits: '10' }, revoked: false, tickets });
    return r.ok === false && r.reason === 'credits-not-supported';
  })());
  assert('null envelope', (() => {
    const r = validateTicketLocally({ envelope: null, revoked: false, tickets });
    return r.ok === false && r.reason === 'no-ticket-envelope';
  })());

  section('verifierBareId / yyyymm / auditCollectiveRefsForVerifier');
  assert('strips agent: prefix', verifierBareId('agent:thornkeep-verifier') === 'thornkeep-verifier');
  assert('lowercases URL host', verifierBareId('https://Verifier.Example/path') === 'verifier.example');
  assert('passthrough bare', verifierBareId('thornkeep-verifier') === 'thornkeep-verifier');
  assert('yyyymm pads month', yyyymm(new Date(Date.UTC(2026, 0, 15))) === '2026-01');
  {
    const refs = auditCollectiveRefsForVerifier('agent:thornkeep-verifier', new Date(Date.UTC(2026, 4, 15))); // May 2026
    assert('returns 2 refs', refs.length === 2);
    assert('current month first', refs[0] === 'sed:thornkeep-verifier-audit-2026-05');
    assert('previous month second', refs[1] === 'sed:thornkeep-verifier-audit-2026-04');
  }
}

async function liveGrainRead(): Promise<void> {
  section(`live grain read — ${FIXTURE_GRAIN}`);
  const result = await bsp({ agent_id: FIXTURE_GRAIN, block: 'grain' });
  if (!result.ok) {
    console.log(`  read failed: ${(result as { error?: string }).error}`);
    fail++;
    return;
  }
  const raw = (result as { raw: unknown }).raw;
  assert('grain block exists', raw !== null);
  if (raw === null) return;
  console.log('  raw block keys:', Object.keys(raw as Record<string, unknown>).join(', '));
  console.log('  raw block (truncated):', JSON.stringify(raw).slice(0, 500));

  for (const side of ['1', '2'] as const) {
    section(`readTicketGrain — issuer-side=${side}`);
    const r = await readTicketGrain(`${FIXTURE_GRAIN}:${side}`, CONTAINING);
    console.log(`  side ${side} underscore: ${JSON.stringify(r.rawSideUnderscore?.slice(0, 200) ?? null)}`);
    console.log(`  envelope: ${JSON.stringify(r.envelope)}`);
    console.log(`  revoked: ${r.revoked}${r.revokedRaw ? ' — ' + r.revokedRaw.raw : ''}`);
    if (r.envelope) {
      assert(`side ${side} envelope is ticket`, r.envelope.kind === 'ticket');
      assert(`side ${side} face is non-empty`, !!r.envelope.face);
      assert(`side ${side} scope is non-empty`, !!r.envelope.scope);
      assert(`side ${side} expires parseable`, Number.isFinite(Date.parse(r.envelope.expires)));
    }
  }
}

async function liveTicketsRead(): Promise<void> {
  const sedRef = process.env.TEST_SED_REF;
  if (!sedRef) {
    section('readTickets — skipped (set TEST_SED_REF=sed:<collective> to exercise)');
    return;
  }
  section(`readTickets — ${sedRef}`);
  const t = await readTickets(sedRef, CONTAINING);
  console.log('  tickets:', t);
  if (t) {
    assert('issuer present', !!t.issuer);
    assert('purchase_url present', !!t.purchase_url);
    assert('face present', !!t.face);
    assert('scope present', !!t.scope);
    assert('verifier defaults to issuer when omitted', !!t.verifier);
  }
}

async function liveAuditWalk(): Promise<void> {
  const reg = process.env.AUDIT_REGISTRATION;
  const verifierId = process.env.AUDIT_VERIFIER_ID;
  if (!reg || !verifierId) {
    section('walkVerifierAudit — skipped (set AUDIT_REGISTRATION + AUDIT_VERIFIER_ID to exercise)');
    if (verifierId) {
      const refs = auditCollectiveRefsForVerifier(verifierId);
      console.log(`  would walk: ${refs.join(', ')}`);
    }
    return;
  }
  section(`walkVerifierAudit — registration=${reg} verifier=${verifierId}`);
  const status = await walkVerifierAudit({
    registration_ref: reg,
    verifier_id: verifierId,
    containing_agent_id: CONTAINING,
  });
  console.log('  status:', JSON.stringify(status, null, 2));
  if (status.state !== 'pending') {
    assert('envelope correlates back to registration', status.envelope.registration === reg);
  }
}

async function federationRegression(): Promise<void> {
  // §6.2: two distinct issuers must be handled byte-identically apart from
  // the issuer/verifier/grain strings. Drives the read-side / validate-side
  // pipeline with two synthetic issuers and asserts shape parity.
  section('federation — two distinct issuers');
  const future = new Date(Date.now() + 86400_000).toISOString();
  const mkTickets = (issuer: string): TicketsField => ({
    issuer, purchase_url: `https://${issuer.replace(/^agent:/, '')}.example/buy`,
    face: 'character', scope: 'frame:fed-test', verifier: issuer,
  });
  const mkEnv = (): TicketEnvelope => ({
    kind: 'ticket', face: 'character', scope: 'frame:fed-test', expires: future,
    raw: '[ticket ...]', extras: {},
  });

  const aTickets = mkTickets('agent:fed-alpha-tickets');
  const bTickets = mkTickets('agent:fed-beta-tickets');
  const env = mkEnv();

  const aValid = validateTicketLocally({ envelope: env, revoked: false, tickets: aTickets });
  const bValid = validateTicketLocally({ envelope: env, revoked: false, tickets: bTickets });
  assert('both issuers — same validity verdict', JSON.stringify(aValid) === JSON.stringify(bValid));
  assert('both issuers — both pass', aValid.ok === true && bValid.ok === true);

  const aRefs = auditCollectiveRefsForVerifier(aTickets.verifier, new Date(Date.UTC(2026, 4, 15)));
  const bRefs = auditCollectiveRefsForVerifier(bTickets.verifier, new Date(Date.UTC(2026, 4, 15)));
  const stripIssuer = (ref: string, id: string) => ref.replace(verifierBareId(id), '<ISSUER>');
  const aShape = aRefs.map(r => stripIssuer(r, aTickets.verifier));
  const bShape = bRefs.map(r => stripIssuer(r, bTickets.verifier));
  assert('both issuers — same audit-ref shape', JSON.stringify(aShape) === JSON.stringify(bShape));

  // Scope/face checks must not depend on issuer identity.
  const aScope = scopeCompatible(env.scope, aTickets.scope);
  const bScope = scopeCompatible(env.scope, bTickets.scope);
  assert('both issuers — same scope verdict', JSON.stringify(aScope) === JSON.stringify(bScope));

  // A face mismatch produces the SAME failure reason for both.
  const wrongEnv: TicketEnvelope = { ...env, face: 'designer' };
  const aWrong = validateTicketLocally({ envelope: wrongEnv, revoked: false, tickets: aTickets });
  const bWrong = validateTicketLocally({ envelope: wrongEnv, revoked: false, tickets: bTickets });
  assert('both issuers — same failure reason on face mismatch',
    aWrong.ok === false && bWrong.ok === false && aWrong.reason === bWrong.reason);
}

async function main(): Promise<void> {
  console.log('paywall-harness — phases 0–4 validation\n');
  await offlineEnvelopeTests();
  await federationRegression();
  await liveGrainRead();
  await liveTicketsRead();
  await liveAuditWalk();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error('harness error:', e); process.exit(2); });
