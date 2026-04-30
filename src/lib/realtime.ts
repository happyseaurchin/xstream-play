/**
 * realtime.ts — out-of-substrate broadcast for live peer vapour.
 *
 * Per protocol-xstream-frame.md §3.1: vapour transport is the application's
 * responsibility, NOT bsp-mcp's. The substrate sees commits (marks / liquid /
 * solid). Vapour — humans typing toward each other in real time — flows over
 * a separate ephemeral channel. We use Supabase Realtime (already provisioned
 * for the commons fallback) keyed by scope so that two users at the same
 * address see each other's keystrokes.
 *
 * Channel naming
 *   vapour:<beach-url-or-host>:addr:<address>           (beachcombing)
 *   vapour:<beach-url-or-host>:frame:<scene>:entity:<n> (in-frame)
 *
 * Payload shape
 *   { agent_id: string, face: string, vapour_text: string, ts: number }
 *
 * Self-echo is suppressed at the receive side — we never render our own
 * broadcasts back into our peer-vapour view.
 */

import { getSupabase } from './supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';

export interface VapourBroadcast {
  agent_id: string;
  face: string;
  vapour_text: string;
  ts: number;
}

export interface VapourChannelHandle {
  broadcast: (text: string) => void;
  leave: () => Promise<void>;
  scope: string;
}

const BROADCAST_EVENT = 'vapour';

function safeKey(s: string): string {
  // Supabase Realtime channel names allow alnum + : / - _ but URLs and
  // pscale addresses can carry / and : already. Replace risky chars to keep
  // the channel id legal.
  return s.replace(/[^A-Za-z0-9._:-]/g, '_').slice(0, 200);
}

export function deriveScope(opts: {
  beach: string;
  address: string;
  frame: string | null;
  entity_position: string | null;
}): string {
  const beach = safeKey(opts.beach || 'unknown');
  if (opts.frame && opts.entity_position) {
    return `vapour:${beach}:frame:${safeKey(opts.frame)}:entity:${opts.entity_position}`;
  }
  return `vapour:${beach}:addr:${safeKey(opts.address || 'root')}`;
}

/**
 * Join a vapour channel for a given scope. Returns a handle whose .broadcast()
 * sends a debounce-friendly delta and whose .leave() tears down the channel.
 *
 * Caller passes onPeer to receive others' broadcasts. Self broadcasts are
 * suppressed by matching agent_id (server-side broadcast self: false also
 * skips loopback at the transport layer).
 */
export function joinVapourChannel(opts: {
  scope: string;
  agent_id: string;
  face: string;
  onPeer: (msg: VapourBroadcast) => void;
}): VapourChannelHandle | null {
  const sb = getSupabase();
  if (!sb) return null;

  const channel: RealtimeChannel = sb.channel(opts.scope, {
    config: { broadcast: { self: false, ack: false } },
  });

  channel.on('broadcast', { event: BROADCAST_EVENT }, payload => {
    const msg = payload?.payload as VapourBroadcast | undefined;
    if (!msg || typeof msg.vapour_text !== 'string') return;
    if (msg.agent_id === opts.agent_id) return; // belt-and-braces self-echo guard
    opts.onPeer(msg);
  });

  channel.subscribe();

  return {
    scope: opts.scope,
    broadcast(text: string) {
      const payload: VapourBroadcast = {
        agent_id: opts.agent_id,
        face: opts.face,
        vapour_text: text,
        ts: Date.now(),
      };
      // Fire-and-forget. Realtime queues until subscription is established.
      channel.send({ type: 'broadcast', event: BROADCAST_EVENT, payload }).catch(() => {});
    },
    async leave() {
      try {
        await sb.removeChannel(channel);
      } catch {
        // ignore — channel already gone
      }
    },
  };
}
