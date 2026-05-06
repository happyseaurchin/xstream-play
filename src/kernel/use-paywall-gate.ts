/**
 * use-paywall-gate.ts — read `_tickets` on the face-bound sed: collective for
 * the current (frame, face) and report a gate status.
 *
 * Phase 1 surface contract:
 *   open       — _tickets absent or face is observer (no membership required)
 *   no-frame   — no current frame; no specific collective to gate on
 *   loading    — read in flight
 *   gated      — _tickets present; the affordance must surface
 *   error      — substrate read failed
 *
 * Phase 2/3 will extend this with `pending-step-a`, `pending-verification`,
 * and `verified` states once grain reception and audit-walk are wired.
 *
 * Federation discipline: NO issuer allowlist, NO ranking, NO badging. The
 * hook returns whatever `_tickets.issuer` declares. The banner consumer
 * displays `agent_id` so the user knows whom they are paying — that is the
 * entire identity rendering.
 */

import { useEffect, useMemo, useState } from 'react';
import { readTickets } from './paywall';
import type { TicketsField } from './paywall';
import type { Face } from '../types/xstream';

export type PaywallGateStatus =
  | { kind: 'open' }
  | { kind: 'no-frame' }
  | { kind: 'observer' }
  | { kind: 'loading' }
  | { kind: 'gated'; collectiveRef: string; tickets: TicketsField }
  | { kind: 'error'; error: string };

/**
 * Derive the conventional sed: collective for a face within a frame.
 *
 * Conventions:
 *   character → sed:<frame-bare>-cast
 *   author    → sed:<frame-bare>-authors
 *   designer  → sed:<frame-bare>-designers
 *   observer  → null (no membership required)
 *
 * `<frame-bare>` strips a leading `frame:` if present.
 */
export function collectiveRefForFrameFace(frame: string | null, face: Face): string | null {
  if (!frame || face === 'observer') return null;
  const bare = frame.startsWith('frame:') ? frame.slice('frame:'.length) : frame;
  const suffix: Record<Exclude<Face, 'observer'>, string> = {
    character: '-cast',
    author: '-authors',
    designer: '-designers',
  };
  return `sed:${bare}${suffix[face as Exclude<Face, 'observer'>]}`;
}

/**
 * Dev-mode override: visiting `?paywall=force` injects a synthetic `_tickets`
 * for visual testing of the affordance without writing to the substrate. The
 * forced ticket targets a fictional issuer and purchase_url so the buy button
 * is observable but harmless.
 */
function devForcedTickets(): TicketsField | null {
  if (typeof window === 'undefined') return null;
  const flag = new URLSearchParams(window.location.search).get('paywall');
  // `force` shows quiet; `active` shows active (escalates hasIntent in Column).
  if (flag !== 'force' && flag !== 'active') return null;
  return {
    issuer: 'agent:dev-tickets',
    purchase_url: 'https://example.invalid/buy?test=1',
    face: 'character',
    scope: 'frame:dev-test',
    verifier: 'agent:dev-tickets',
  };
}

export function usePaywallGate(opts: {
  face: Face;
  frame: string | null;
  agentId: string;
}): PaywallGateStatus {
  const collectiveRef = useMemo(
    () => collectiveRefForFrameFace(opts.frame, opts.face),
    [opts.frame, opts.face],
  );
  const [status, setStatus] = useState<PaywallGateStatus>(() => initialStatus(opts.face, collectiveRef));

  useEffect(() => {
    // Dev override comes first so it can be used to smoketest the banner
    // without standing up a paywalled collective on the substrate.
    const forced = devForcedTickets();
    if (forced) {
      setStatus({ kind: 'gated', collectiveRef: collectiveRef ?? 'sed:dev-test-cast', tickets: forced });
      return;
    }
    if (opts.face === 'observer') { setStatus({ kind: 'observer' }); return; }
    if (!collectiveRef) { setStatus({ kind: 'no-frame' }); return; }

    let cancelled = false;
    setStatus({ kind: 'loading' });
    readTickets(collectiveRef, opts.agentId || '(anon)')
      .then(tickets => {
        if (cancelled) return;
        if (!tickets) setStatus({ kind: 'open' });
        else setStatus({ kind: 'gated', collectiveRef, tickets });
      })
      .catch(e => {
        if (cancelled) return;
        setStatus({ kind: 'error', error: e instanceof Error ? e.message : String(e) });
      });
    return () => { cancelled = true; };
  }, [collectiveRef, opts.face, opts.agentId]);

  return status;
}

function initialStatus(face: Face, collectiveRef: string | null): PaywallGateStatus {
  if (face === 'observer') return { kind: 'observer' };
  if (!collectiveRef) return { kind: 'no-frame' };
  return { kind: 'loading' };
}
