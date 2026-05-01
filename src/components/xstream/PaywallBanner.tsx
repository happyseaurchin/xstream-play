/**
 * PaywallBanner — affordance for a gated sed: collective.
 *
 * Reflexive proportions per protocol-paywall §5 / protocol-xstream-frame §5.6:
 *   - Quiet while browsing — a single faint strip with the issuer's agent_id
 *     and a small "buy" link. Does not take over the page.
 *   - Obvious when attempting to write — same strip expands inline with a
 *     larger CTA when `hasIntent` is true (vapor non-empty or pendingLiquid).
 *   - Disappears on `kind !== 'gated'` — open / observer / no-frame / loading
 *     / error all render nothing here. Phase 2/3 will swap to a "verifying…"
 *     state and then to nothing once the audit envelope confirms.
 *
 * Federation discipline (§6.2):
 *   - Issuer agent_id is shown verbatim. No badge, no rank, no "verified
 *     issuer" label. The user is paying whoever the collective declares.
 *   - The buy link goes directly to `_tickets.purchase_url` via target=_blank
 *     with rel=noopener. No xstream-play interposition.
 */

import type { PaywallGateStatus } from '@/kernel/use-paywall-gate';
import type { StepAStatus } from '@/kernel/use-step-a-registration';
import type { VerificationStatus } from '@/kernel/use-verification-poll';

interface PaywallBannerProps {
  status: PaywallGateStatus;
  hasIntent: boolean;
  stepA?: StepAStatus;
  verification?: VerificationStatus;
}

export function PaywallBanner({ status, hasIntent, stepA, verification }: PaywallBannerProps) {
  // Verified — affordances are unlocked; the banner has done its job.
  if (verification?.kind === 'verified') return null;
  // Polling / rejected / expired / timeout — surface verifier verdict.
  if (verification && verification.kind !== 'idle') {
    return <VerificationBanner v={verification} />;
  }
  // While Step A is in flight or just landed, render its progress regardless
  // of gate status — the banner is the place the user is watching.
  if (stepA && stepA.kind !== 'idle' && stepA.kind !== 'not-our-collective') {
    return <StepABanner stepA={stepA} />;
  }
  if (status.kind !== 'gated') return null;
  const { tickets } = status;

  if (!hasIntent) {
    return (
      <div
        className="px-3 py-1.5 border-b border-border/30 flex items-center gap-2 text-xs text-muted-foreground/80 bg-muted/20"
        data-paywall="quiet"
      >
        <span aria-label="gated">🔒</span>
        <span>
          {tickets.face} access · ticket from{' '}
          <code className="font-mono text-foreground/80">{tickets.issuer}</code>
        </span>
        <a
          href={tickets.purchase_url}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto underline decoration-dotted hover:text-foreground"
          title={`opens ${tickets.purchase_url}`}
        >
          buy →
        </a>
      </div>
    );
  }

  return (
    <div
      className="px-3 py-2.5 border-b border-border/30 bg-accent/10"
      data-paywall="active"
    >
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <span className="text-sm font-medium text-foreground">
          {tickets.face} access required
        </span>
        <span className="text-[10px] text-muted-foreground font-mono">
          scope {tickets.scope}
        </span>
      </div>
      <div className="text-xs text-muted-foreground mb-2">
        Issued by <code className="font-mono text-foreground/85">{tickets.issuer}</code>
        {tickets.verifier !== tickets.issuer && (
          <> · verified by <code className="font-mono text-foreground/85">{tickets.verifier}</code></>
        )}
      </div>
      <a
        href={tickets.purchase_url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-block text-xs px-3 py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        title={`opens ${tickets.purchase_url}`}
      >
        Get ticket →
      </a>
    </div>
  );
}

function VerificationBanner({ v }: { v: VerificationStatus }) {
  let label = '';
  let detail: string | undefined;
  let tone: 'progress' | 'error' | 'warn' = 'progress';

  switch (v.kind) {
    case 'polling':
      label = 'Awaiting verifier…';
      detail = v.attempts === 1 ? 'first poll' : `poll ${v.attempts}`;
      break;
    case 'rejected':
      label = 'Ticket rejected by verifier.';
      detail = `${v.envelope.reason} · by ${v.envelope.by}`;
      tone = 'error';
      break;
    case 'expired':
      label = 'Ticket expired.';
      detail = `at ${v.envelope.at}`;
      tone = 'warn';
      break;
    case 'timeout':
      label = 'Verifier silent.';
      detail = `${v.attempts} polls over 5 minutes — reload to retry`;
      tone = 'warn';
      break;
    default:
      return null;
  }

  const bg = tone === 'error' ? 'bg-destructive/10' : tone === 'warn' ? 'bg-muted/40' : 'bg-muted/30';
  return (
    <div className={`px-3 py-2 border-b border-border/30 text-xs ${bg}`} data-paywall={`verify-${v.kind}`}>
      <span className="text-foreground">{label}</span>
      {detail && <span className="ml-2 text-muted-foreground font-mono">{detail}</span>}
    </div>
  );
}

function StepABanner({ stepA }: { stepA: StepAStatus }) {
  let label = '';
  let detail: string | undefined;
  let tone: 'progress' | 'error' | 'done' = 'progress';

  switch (stepA.kind) {
    case 'reading-grain': label = 'Reading ticket grain…'; break;
    case 'validating': label = 'Validating ticket…'; break;
    case 'registering': label = 'Registering…'; break;
    case 'referencing-grain':
      label = 'Linking ticket to position…';
      detail = `position ${stepA.position}`;
      break;
    case 'done':
      label = 'Registered.';
      detail = `position ${stepA.position} · awaiting verifier`;
      tone = 'done';
      break;
    case 'invalid-grain':
      label = 'Ticket invalid.';
      detail = stepA.reason;
      tone = 'error';
      break;
    case 'no-identity':
      label = 'Identity required.';
      detail = stepA.reason;
      tone = 'error';
      break;
    case 'failed':
      label = 'Registration failed.';
      detail = `${stepA.stage}: ${stepA.error}`;
      tone = 'error';
      break;
    default:
      return null;
  }

  const bg = tone === 'error' ? 'bg-destructive/10' : tone === 'done' ? 'bg-accent/10' : 'bg-muted/30';
  return (
    <div className={`px-3 py-2 border-b border-border/30 text-xs ${bg}`} data-paywall={`step-a-${stepA.kind}`}>
      <span className="text-foreground">{label}</span>
      {detail && <span className="ml-2 text-muted-foreground font-mono">{detail}</span>}
    </div>
  );
}
