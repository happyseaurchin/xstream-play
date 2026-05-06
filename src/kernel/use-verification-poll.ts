/**
 * use-verification-poll.ts — watch the verifier's audit collective for an
 * envelope matching this column's registration.
 *
 * Cadence per protocol-paywall §4.1 step 6:
 *   - 2s intervals for the first 30s (15 polls)
 *   - 10s intervals thereafter
 *   - 5 minute hard cap → timeout
 *
 * The walk reads current + previous month's audit collective via the helper
 * in paywall.ts. Returns latest matching envelope by `at=` timestamp.
 *
 * Persistence: the (registrationRef, verifierId) pair is mirrored into
 * localStorage so a reload mid-poll resumes the watch instead of stranding
 * the user on "registered" with no follow-through. The entry is cleared on
 * verified / rejected / expired (terminal states); timeout retains it so the
 * user can manually reload to keep watching.
 */

import { useEffect, useRef, useState } from 'react';
import { walkVerifierAudit } from './paywall';
import type {
  VerifiedEnvelope,
  RejectedEnvelope,
  ExpiredEnvelope,
  VerificationStatus as AuditWalkStatus,
} from './paywall';

export type VerificationStatus =
  | { kind: 'idle' }
  | { kind: 'polling'; attempts: number }
  | { kind: 'verified'; envelope: VerifiedEnvelope; collective: string; position: string }
  | { kind: 'rejected'; envelope: RejectedEnvelope; collective: string; position: string }
  | { kind: 'expired'; envelope: ExpiredEnvelope; collective: string; position: string }
  | { kind: 'timeout'; attempts: number };

const FAST_INTERVAL_MS = 2_000;
const SLOW_INTERVAL_MS = 10_000;
const FAST_PHASE_MS = 30_000;
const HARD_CAP_MS = 5 * 60 * 1_000;

const PERSIST_KEY = (columnId: string) => `xstream:paywall-watch:${columnId}`;

export interface PersistedWatch {
  registrationRef: string;
  verifierId: string;
  startedAt: number;
}

export function loadPersistedWatch(columnId: string): PersistedWatch | null {
  try {
    const raw = localStorage.getItem(PERSIST_KEY(columnId));
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (typeof v.registrationRef === 'string' && typeof v.verifierId === 'string') return v;
  } catch { /* corrupt */ }
  return null;
}

export function savePersistedWatch(columnId: string, w: PersistedWatch): void {
  try { localStorage.setItem(PERSIST_KEY(columnId), JSON.stringify(w)); } catch { /* quota */ }
}

export function clearPersistedWatch(columnId: string): void {
  try { localStorage.removeItem(PERSIST_KEY(columnId)); } catch { /* quota */ }
}

export function useVerificationPoll(opts: {
  columnId: string;
  registrationRef: string | null;
  verifierId: string | null;
  agentId: string;
}): VerificationStatus {
  const [status, setStatus] = useState<VerificationStatus>({ kind: 'idle' });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    if (!opts.registrationRef || !opts.verifierId) {
      setStatus({ kind: 'idle' });
      return;
    }

    let cancelled = false;
    let attempts = 0;
    const startedAt = Date.now();

    savePersistedWatch(opts.columnId, {
      registrationRef: opts.registrationRef,
      verifierId: opts.verifierId,
      startedAt,
    });

    const tick = async () => {
      if (cancelled) return;
      attempts++;
      setStatus({ kind: 'polling', attempts });

      let result: AuditWalkStatus;
      try {
        result = await walkVerifierAudit({
          registration_ref: opts.registrationRef!,
          verifier_id: opts.verifierId!,
          containing_agent_id: opts.agentId || '(anon)',
        });
      } catch (e) {
        // Transient errors don't abort the poll — keep going until cap.
        console.warn('[verification poll] walk failed:', e);
        scheduleNext();
        return;
      }

      if (cancelled) return;

      if (result.state === 'verified') {
        setStatus({ kind: 'verified', envelope: result.envelope, collective: result.collective, position: result.position });
        clearPersistedWatch(opts.columnId);
        return;
      }
      if (result.state === 'rejected') {
        setStatus({ kind: 'rejected', envelope: result.envelope, collective: result.collective, position: result.position });
        clearPersistedWatch(opts.columnId);
        return;
      }
      if (result.state === 'expired') {
        setStatus({ kind: 'expired', envelope: result.envelope, collective: result.collective, position: result.position });
        clearPersistedWatch(opts.columnId);
        return;
      }

      scheduleNext();
    };

    const scheduleNext = () => {
      const elapsed = Date.now() - startedAt;
      if (elapsed >= HARD_CAP_MS) {
        setStatus({ kind: 'timeout', attempts });
        // Retain persisted watch so a reload retries.
        return;
      }
      const delay = elapsed < FAST_PHASE_MS ? FAST_INTERVAL_MS : SLOW_INTERVAL_MS;
      timerRef.current = setTimeout(tick, delay);
    };

    // Kick off immediately — first poll has no wait.
    tick();

    return () => {
      cancelled = true;
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    };
  }, [opts.columnId, opts.registrationRef, opts.verifierId, opts.agentId]);

  return status;
}
