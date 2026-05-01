/**
 * use-step-a-registration.ts — return-from-purchase handler.
 *
 * The issuer's success URL hands the buyer back to xstream-play with two
 * query parameters:
 *   ?ticket_grain=grain:<pair_id>:<issuer-side>
 *   &ticket_collective=sed:<collective>
 *
 * Only the column whose (face, frame) derives the matching collective_ref
 * acts on the params — others ignore them. The acting column:
 *   1. Reads the grain (issuer-side underscore + revocation walk).
 *   2. Reads the collective's `_tickets` for face/scope/issuer.
 *   3. Local-validates per §4.3.
 *   4. Step A — first write: pscale_register(declaration).
 *   5. Step A — second write: bsp() to <position>.1 = "grain:<pid>:<side>".
 *   6. Cleans the URL params via history.replaceState.
 *
 * The verdict from the verifier daemon is NOT in scope here — that's the
 * audit-walk poll loop in Phase 3. This hook returns when the substrate has
 * accepted the registration; verification status is separate.
 */

import { useEffect, useState } from 'react';
import {
  readTicketGrain,
  validateTicketLocally,
  referenceGrainInRegistration,
} from './paywall';
import type { TicketsField } from './paywall';
import { pscaleRegister, parseRef } from '../lib/bsp-client';

export type StepAStatus =
  | { kind: 'idle' }
  | { kind: 'not-our-collective' }
  | { kind: 'no-identity'; reason: string }
  | { kind: 'reading-grain' }
  | { kind: 'validating' }
  | { kind: 'invalid-grain'; reason: string }
  | { kind: 'registering' }
  | { kind: 'referencing-grain'; position: string }
  | { kind: 'done'; position: string; collective: string; grainRef: string }
  | { kind: 'failed'; stage: string; error: string };

export interface StepAParams {
  ticket_grain: string;       // grain:<pair_id>:<issuer-side>
  ticket_collective: string;  // sed:<collective>
}

/** Pull the two paywall return params from the current window URL. Null if absent. */
export function readReturnFromPurchaseParams(): StepAParams | null {
  if (typeof window === 'undefined') return null;
  const sp = new URLSearchParams(window.location.search);
  const grain = sp.get('ticket_grain');
  const collective = sp.get('ticket_collective');
  if (!grain || !collective) return null;
  if (!grain.startsWith('grain:') || !collective.startsWith('sed:')) return null;
  return { ticket_grain: grain, ticket_collective: collective };
}

/** Strip the two paywall return params from the URL after we've consumed them. */
function clearReturnFromPurchaseParams(): void {
  if (typeof window === 'undefined') return;
  const u = new URL(window.location.href);
  u.searchParams.delete('ticket_grain');
  u.searchParams.delete('ticket_collective');
  window.history.replaceState(null, '', u.toString());
}

/**
 * Extract the allocated position from a pscale_register result. Tries
 * structuredContent first, then a regex over the human message. If both
 * fail, returns null and the caller fails the registration.
 *
 * Positions look like '11', '12', etc. (sed: floor-2 minimum).
 */
function extractPosition(raw: unknown): string | null {
  if (typeof raw === 'object' && raw !== null) {
    const r = raw as { structuredContent?: { position?: unknown; address?: unknown } };
    const sc = r.structuredContent;
    if (sc) {
      if (typeof sc.position === 'string' && /^\d+$/.test(sc.position)) return sc.position;
      if (typeof sc.position === 'number') return String(sc.position);
      if (typeof sc.address === 'string') {
        const m = sc.address.match(/(?::|\.)(\d+)$/);
        if (m) return m[1];
      }
    }
  }
  return null;
}

function extractPositionFromMessage(msg: string): string | null {
  // Try a handful of conventional phrasings.
  // "registered at sed:foo:11", "position 11", "at 11"
  const m = msg.match(/(?:position|sed:[^\s:]+:|at\s+)(\d+)\b/i);
  return m ? m[1] : null;
}

export function useStepARegistration(opts: {
  agentId: string;
  secret: string;
  /** Current column's derived collective ref (from face + frame). */
  collectiveRef: string | null;
  /** Current column's `_tickets` read (null when collective is open or unread). */
  tickets: TicketsField | null;
}): StepAStatus {
  const [status, setStatus] = useState<StepAStatus>({ kind: 'idle' });

  useEffect(() => {
    const params = readReturnFromPurchaseParams();
    if (!params) { setStatus({ kind: 'idle' }); return; }
    if (!opts.collectiveRef || params.ticket_collective !== opts.collectiveRef) {
      setStatus({ kind: 'not-our-collective' });
      return;
    }
    if (!opts.agentId || !opts.secret) {
      setStatus({ kind: 'no-identity', reason: 'identify (handle + passphrase) before registering' });
      return;
    }
    if (!opts.tickets) {
      setStatus({ kind: 'failed', stage: 'tickets-unread', error: 'collective _tickets not yet read' });
      return;
    }

    let cancelled = false;
    (async () => {
      setStatus({ kind: 'reading-grain' });
      const g = await readTicketGrain(params.ticket_grain, opts.agentId);
      if (cancelled) return;

      setStatus({ kind: 'validating' });
      const local = validateTicketLocally({
        envelope: g.envelope,
        revoked: g.revoked,
        tickets: opts.tickets!,
      });
      if (cancelled) return;
      if (local.ok === false) {
        setStatus({ kind: 'invalid-grain', reason: local.reason });
        // Don't clear URL — leave it so the user / a refresh can retry.
        return;
      }

      setStatus({ kind: 'registering' });
      // pscale_register takes the bare collective name (no `sed:` prefix).
      const collectiveBare = parseRef(opts.collectiveRef!, opts.agentId).block;
      const declaration = `${opts.agentId} joining as ${opts.tickets!.face}`;
      const reg = await pscaleRegister({
        collective: collectiveBare,
        declaration,
        passphrase: opts.secret,
      });
      if (cancelled) return;
      if (!reg.ok) {
        setStatus({ kind: 'failed', stage: 'pscale_register', error: reg.message || reg.error || 'unknown' });
        return;
      }

      const position = extractPosition(reg.raw) ?? extractPositionFromMessage(reg.message ?? '');
      if (!position) {
        setStatus({ kind: 'failed', stage: 'parse-position', error: `could not extract position from result: ${reg.message?.slice(0, 200) ?? ''}` });
        return;
      }

      setStatus({ kind: 'referencing-grain', position });
      const ref = await referenceGrainInRegistration({
        caller_agent_id: opts.agentId,
        collective_ref: opts.collectiveRef!,
        position,
        grain_ref: params.ticket_grain,
        registration_secret: opts.secret,
      });
      if (cancelled) return;
      if (!ref.ok) {
        setStatus({ kind: 'failed', stage: 'reference-grain', error: ref.error ?? 'unknown' });
        return;
      }

      clearReturnFromPurchaseParams();
      setStatus({
        kind: 'done',
        position,
        collective: opts.collectiveRef!,
        grainRef: params.ticket_grain,
      });
    })();

    return () => { cancelled = true; };
    // We deliberately depend only on the collective ref + identity; the
    // `tickets` read changing shouldn't re-trigger Step A once it's begun.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.collectiveRef, opts.agentId, opts.secret]);

  return status;
}
