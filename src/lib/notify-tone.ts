/**
 * notify-tone.ts — minimal Web Audio chime for vapour-notification.
 *
 * No asset file. Synthesises a tiny two-note chime via a single oscillator
 * + gain envelope. Cheap, portable, mute-respecting (subject to the user's
 * browser autoplay policy — first click anywhere unlocks AudioContext).
 *
 * Per docs/DESIGN-CHANNELS.md § "Notifications — vapour IS the
 * notification": fired when a watched-agent enters vapour at an unfocused
 * column. Other layers (visual ping in the header) handle the silent case.
 */

let ctx: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (ctx) return ctx;
  try {
    const Ctor = (window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
    if (!Ctor) return null;
    ctx = new Ctor();
    return ctx;
  } catch {
    return null;
  }
}

/** Play a short two-note chime (~250ms total). Best-effort — no-op if the
 * audio context is locked or unavailable. Volume is intentionally quiet so
 * the cue informs without intruding. */
export function playVapourCue(): void {
  const c = getContext();
  if (!c) return;
  // Browser autoplay policy: AudioContext starts suspended until a user
  // gesture. Try to resume; if it fails, swallow silently.
  if (c.state === 'suspended') c.resume().catch(() => {});

  const now = c.currentTime;
  const beep = (freq: number, start: number, dur: number, peak: number) => {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, now + start);
    gain.gain.exponentialRampToValueAtTime(peak, now + start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + start + dur);
    osc.connect(gain).connect(c.destination);
    osc.start(now + start);
    osc.stop(now + start + dur + 0.05);
  };
  // Two soft notes — "tink-tink".
  beep(880, 0, 0.12, 0.04);
  beep(1175, 0.13, 0.12, 0.035);
}
