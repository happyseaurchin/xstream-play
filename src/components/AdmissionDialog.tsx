/**
 * AdmissionDialog — the just-in-time meaning-maker check.
 *
 * Opens when a user reaches for a post-admission feature (engage / sed
 * register / sign mark / vapour-notification setup) for the first time. A
 * Hard-LLM exchange — 2-3 turns — judges receptive-predictive presence and
 * writes a claim to passport:8 on admit.
 *
 * Voice rules and judging criteria live in admission.ts (HARD_SYSTEM_PROMPT).
 * This component only renders the conversation surface.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { runChallengeTurn, commitAdmission, loadGatekeeper, type ChallengeMessage, type GatekeeperShell } from '../kernel/admission';

interface AdmissionDialogProps {
  open: boolean;
  /** Apologetic context — e.g. "Forming a grain is a sovereign relationship." */
  reason?: string;
  apiKey: string;
  handle: string;
  secret: string;
  model: string;
  /** Beach the user is admitting AT — the gatekeeper shell is loaded from
   * here first (per-beach), falling back to federated default and finally
   * the seeded shell. */
  beach: string;
  onClose: (admitted: boolean) => void;
}

type Phase =
  | { kind: 'intro' }
  | { kind: 'loading' }
  | { kind: 'asking'; messages: ChallengeMessage[]; userTurnsSoFar: number; pendingAssistant: string }
  | { kind: 'thinking'; messages: ChallengeMessage[]; userTurnsSoFar: number }
  | { kind: 'admitted' }
  | { kind: 'retry'; reply: string }
  | { kind: 'error'; message: string };

export function AdmissionDialog({ open, reason, apiKey, handle, secret, model, beach, onClose }: AdmissionDialogProps) {
  const [phase, setPhase] = useState<Phase>({ kind: 'intro' });
  const [input, setInput] = useState('');
  const [shell, setShell] = useState<GatekeeperShell | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Reset when the dialog opens fresh.
  useEffect(() => {
    if (open) {
      setPhase({ kind: 'intro' });
      setInput('');
      setShell(null);
    }
  }, [open]);

  // Focus textarea whenever we're in an asking phase.
  useEffect(() => {
    if (phase.kind === 'asking') {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [phase.kind]);

  const startConversation = useCallback(async () => {
    setPhase({ kind: 'loading' });
    try {
      const loaded = await loadGatekeeper(beach);
      setShell(loaded);
      setPhase({ kind: 'asking', messages: [], userTurnsSoFar: 0, pendingAssistant: loaded.opening });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setPhase({ kind: 'error', message: `Couldn't load the gatekeeper shell: ${msg}` });
    }
  }, [beach]);

  const sendUserTurn = useCallback(async () => {
    if (phase.kind !== 'asking' || !shell) return;
    const text = input.trim();
    if (!text) return;
    setInput('');

    const newMessages: ChallengeMessage[] = [
      ...phase.messages,
      { role: 'user', content: text },
    ];
    const userTurns = phase.userTurnsSoFar + 1;
    setPhase({ kind: 'thinking', messages: newMessages, userTurnsSoFar: userTurns });

    try {
      const judgement = await runChallengeTurn({
        apiKey,
        model,
        shell,
        messages: newMessages,
        userTurnsSoFar: userTurns,
      });

      if (judgement.decision === 'admit') {
        const summary = judgement.summary || 'attested';
        const ok = await commitAdmission({ handle, secret, transcript: newMessages, summary });
        if (!ok) {
          setPhase({ kind: 'error', message: 'Admission attested but the substrate write failed. Check passphrase and try again.' });
          return;
        }
        setPhase({ kind: 'admitted' });
        return;
      }

      if (judgement.decision === 'retry') {
        setPhase({ kind: 'retry', reply: judgement.reply });
        return;
      }

      // continue — append assistant turn, await next user input.
      const messagesWithAssistant: ChallengeMessage[] = [
        ...newMessages,
        { role: 'assistant', content: JSON.stringify(judgement) },
      ];
      setPhase({
        kind: 'asking',
        messages: messagesWithAssistant,
        userTurnsSoFar: userTurns,
        pendingAssistant: judgement.reply,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setPhase({ kind: 'error', message: `Couldn't reach the gatekeeper: ${msg}` });
    }
  }, [phase, input, apiKey, model, shell, handle, secret]);

  if (!open) return null;

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendUserTurn();
    } else if (e.key === 'Escape') {
      onClose(false);
    }
  };

  return (
    <div onClick={() => onClose(phase.kind === 'admitted')} style={overlayStyle}>
      <div onClick={e => e.stopPropagation()} style={modalStyle}>
        <div style={headerStyle}>First time — let's meet.</div>

        {phase.kind === 'intro' && (
          <>
            {reason && <p style={reasonStyle}>{reason}</p>}
            <p style={bodyStyle}>
              The substrate hasn't met you yet. A short conversation — two
              turns, about a minute — and then it has. Pre-admission features
              keep working either way.
            </p>
            <div style={buttonRowStyle}>
              <button onClick={() => onClose(false)} style={cancelStyle}>later</button>
              <button onClick={startConversation} style={primaryStyle}>↪ start</button>
            </div>
          </>
        )}

        {phase.kind === 'loading' && (
          <div style={messageStyle}><em>…inhabiting the shell…</em></div>
        )}

        {phase.kind === 'asking' && (
          <>
            {shell?.source && shell.source !== 'beach' && (
              <div style={sourceHintStyle}>
                gatekeeper: {shell.source === 'pscale' ? 'pscale sentinel' : 'seeded fallback'}
              </div>
            )}
            <div style={messageStyle}>{phase.pendingAssistant}</div>
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder="…"
              style={textareaStyle}
              rows={4}
            />
            <div style={hintRowStyle}>
              <span style={hintStyle}>↵ to send · ⇧↵ for newline · esc to leave</span>
              <button onClick={sendUserTurn} disabled={!input.trim()} style={input.trim() ? primaryStyle : disabledStyle}>send</button>
            </div>
          </>
        )}

        {phase.kind === 'thinking' && (
          <div style={messageStyle}><em>…listening…</em></div>
        )}

        {phase.kind === 'admitted' && (
          <>
            <div style={admittedStyle}>✓ Got it. The substrate sees you now.</div>
            <div style={buttonRowStyle}>
              <button onClick={() => onClose(true)} style={primaryStyle}>continue ↪</button>
            </div>
          </>
        )}

        {phase.kind === 'retry' && (
          <>
            <div style={messageStyle}>{phase.reply}</div>
            <div style={buttonRowStyle}>
              <button onClick={() => onClose(false)} style={cancelStyle}>back</button>
            </div>
          </>
        )}

        {phase.kind === 'error' && (
          <>
            <div style={errorStyle}>{phase.message}</div>
            <div style={buttonRowStyle}>
              <button onClick={() => onClose(false)} style={cancelStyle}>close</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────── Styles ─────────────────────── */

const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200,
};

const modalStyle: React.CSSProperties = {
  background: '#1a1a1a', border: '1px solid #333', borderRadius: 10,
  padding: '1.5rem', minWidth: 400, maxWidth: 540, width: '90vw',
  color: '#e0e0e0', fontFamily: 'system-ui, sans-serif',
};

const headerStyle: React.CSSProperties = {
  fontSize: '0.95rem', fontWeight: 600, marginBottom: '1rem',
  color: '#f0f0f0', letterSpacing: '0.01em',
};

const reasonStyle: React.CSSProperties = {
  fontSize: '0.8rem', color: '#aaa', fontStyle: 'italic',
  margin: '0 0 0.75rem 0',
};

const bodyStyle: React.CSSProperties = {
  fontSize: '0.85rem', color: '#ccc', lineHeight: 1.5,
  margin: '0 0 1.25rem 0',
};

const messageStyle: React.CSSProperties = {
  fontSize: '0.95rem', color: '#e8e8e8', lineHeight: 1.55,
  whiteSpace: 'pre-wrap', margin: '0.5rem 0 1rem 0',
};

const textareaStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '0.65rem',
  background: '#252525', border: '1px solid #333', borderRadius: 6,
  color: '#e8e8e8', fontSize: '0.9rem', fontFamily: 'inherit',
  outline: 'none', resize: 'vertical',
};

const hintRowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  marginTop: '0.5rem',
};

const hintStyle: React.CSSProperties = {
  fontSize: '0.7rem', color: '#666',
};

const admittedStyle: React.CSSProperties = {
  fontSize: '1rem', color: '#7ee787', fontWeight: 500,
  margin: '0.5rem 0 1.25rem 0',
};

const errorStyle: React.CSSProperties = {
  fontSize: '0.85rem', color: '#ffa39e',
  margin: '0.5rem 0 1.25rem 0',
};

const buttonRowStyle: React.CSSProperties = {
  display: 'flex', gap: '0.5rem', justifyContent: 'flex-end',
};

const primaryStyle: React.CSSProperties = {
  padding: '0.5rem 1rem', borderRadius: 6, border: 'none',
  background: '#7c3aed', color: '#fff', fontSize: '0.85rem',
  cursor: 'pointer', fontWeight: 500,
};

const disabledStyle: React.CSSProperties = {
  ...primaryStyle, background: '#333', color: '#666', cursor: 'not-allowed',
};

const cancelStyle: React.CSSProperties = {
  padding: '0.5rem 1rem', borderRadius: 6, border: '1px solid #333',
  background: 'transparent', color: '#888', fontSize: '0.85rem', cursor: 'pointer',
};

const sourceHintStyle: React.CSSProperties = {
  fontSize: '0.65rem', color: '#666', textTransform: 'uppercase',
  letterSpacing: '0.05em', marginBottom: '0.5rem',
};
