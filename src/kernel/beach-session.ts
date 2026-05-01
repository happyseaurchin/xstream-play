/**
 * Beach session — the runtime state of one xstream beach client.
 *
 * Replaces the game-shaped Block type. No spatial_address (the address bar is
 * the single source of truth); no familiarity; no per-face commit mode; no
 * accumulated events. Beach mode is: identity + current beach + current
 * address + (optional) current frame + transient input/draft state.
 *
 * Frame mode: when current_frame is set, the V/L/S surface renders the frame
 * disc per docs/protocol-xstream-frame.md. When absent, the client is in
 * beachcombing mode and renders marks at the current address.
 */

/** CADO operational mode. Mirrors the Face type at src/types/xstream.ts so
 * the kernel can carry it without importing the surface types module. */
export type Face = 'character' | 'author' | 'designer' | 'observer';

export interface BeachSession {
  /** Identity. agent_id is the public handle; secret stays in sessionStorage. */
  agent_id: string;
  secret: string;

  /** Active face — operational mode-of-engagement. v0.1: not enforced by
   * substrate; tagged into structured marks (position 4) so the surface
   * trace is honest about the stance behind each contribution. */
  face: Face;

  /** Where we are. */
  current_beach: string;            // bsp() agent_id for substrate calls
  current_address: string;           // pscale coordinate within the beach (empty = root)

  /** Optional frame engagement (per protocol-xstream-frame.md). */
  current_frame: string | null;      // block name on the current beach, e.g. "frame:my-scene"
  entity_position: string | null;    // digit ('1'..'9') the user occupies in the frame

  /** Optional pool engagement — derived from current_address. A pool sits at
   * beach:2.<digit> on the same beach block; current_pool is that digit when
   * current_address matches /^2\.([1-9])(\..*)?$/, else null. The kernel
   * derives this in setAddress(); it is not user-set. When set, contributions
   * land at beach:2.<pool>.<next-free> and Solid surfaces the pool view. */
  current_pool: string | null;

  /** Transient. */
  vapor_draft: string;               // unsubmitted typing
  liquid_pending: string;            // submitted, awaiting synthesis
  last_solid: string | null;         // last committed solid the user produced

  /** LLM (Tier 2 — optional). */
  api_key: string | null;
  medium_model: string;
  soft_model: string;
}

export function createBeachSession(opts: {
  agent_id: string;
  secret: string;
  beach: string;
  address?: string;
  api_key?: string | null;
  face?: Face;
}): BeachSession {
  return {
    agent_id: opts.agent_id,
    secret: opts.secret,
    face: opts.face ?? 'observer',
    current_beach: opts.beach,
    current_address: opts.address ?? '',
    current_frame: null,
    entity_position: null,
    current_pool: poolFromAddress(opts.address ?? ''),
    vapor_draft: '',
    liquid_pending: '',
    last_solid: null,
    api_key: opts.api_key ?? null,
    medium_model: 'claude-sonnet-4-6',
    soft_model: 'claude-haiku-4-5-20251001',
  };
}

/** Parse a pool position out of a pscale address. Pools live at beach:2.<digit>;
 * any address starting `2.<digit>` (or deeper, like 2.5.3) means the user is
 * "in" that pool. Returns the digit ('1'..'9') or null. */
export function poolFromAddress(addr: string): string | null {
  const m = addr.match(/^2\.([1-9])(?:\..*)?$/);
  return m ? m[1] : null;
}

/** A mark visible at the current address — terse stigmergy trace.
 *
 * Structured-mark schema (per the convention extension):
 *   _: <text>
 *   1: agent_id
 *   2: address
 *   3: timestamp (ISO)
 *   4: face (CADO mode the contribution was made from — optional, recent) */
export interface MarkRow {
  digit: string;                     // position under beach:1
  agent_id: string | null;           // null for anonymous / unstructured marks
  address: string | null;
  timestamp: string | null;
  text: string;                      // human-readable summary (or full content for unstructured)
  face: Face | null;                 // operational mode behind this mark; null for legacy marks pre-tag
  is_presence: boolean;              // true when all 3 structured fields present + ts is recent
}

/** Frame disc — the entity table per protocol-xstream-frame.md §6. */
export interface FrameEntity {
  position: string;                  // '1'..'9'
  underscore: string;                // entity self-description
  liquid: string;                    // what's pending — may be empty
  solid: string;                     // last committed — may be empty
}

export interface FrameView {
  scene_underscore: string;          // frame-level _ — purpose / authoring goal
  synthesis: string;                 // _synthesis._ canonical render
  synthesis_envelope: string | null; // _synthesis._envelope provenance
  entities: FrameEntity[];
}

/** A pool contribution — one of the 1..9 slots inside beach:2.<pool>. Same
 * structured-mark shape (1=agent, 2=address, 3=ts) as a beach mark, since
 * pool contributions ARE marks at a different ring. */
export interface PoolContribution {
  digit: string;                     // '1'..'9' under beach:2.<pool>
  agent_id: string | null;
  text: string;                      // the contribution's underscore
  timestamp: string | null;
  face: Face | null;                 // operational mode behind the contribution; null for legacy
}

/** Pool disc — what the user sees when current_pool is set. Rendered in the
 * SOLID zone: synthesis (if any) on top as the canonical render, then the
 * pool's purpose, then each contribution. The substrate is the geometry —
 * this is just a typed projection of beach:2.<pool> for the surface. */
export interface PoolView {
  pool_digit: string;                // '1'..'9' — which slot under beach:2
  purpose: string;                   // 2.<pool>._  pool charter / what we converge on
  synthesis: string;                 // 2.<pool>._synthesis._  if present
  synthesis_envelope: string | null; // 2.<pool>._synthesis._envelope
  contributions: PoolContribution[];
}

/** Beach-root liquid — the shared staging layer at beach:3. Each present agent
 * has a slot keyed by their presence digit (same digit assignment as
 * beach:1.<n> presence heartbeats). Structured-mark shape; the underscore is
 * the agent's CURRENT liquid (overwritten on each propose, cleared on
 * commit). Stale entries (>60s) are filtered out client-side as departed. */
export interface LiquidPeer {
  digit: string;                     // '1'..'9' under beach:3
  agent_id: string | null;
  address: string | null;
  timestamp: string | null;
  text: string;
  face: Face | null;
  is_self: boolean;                  // true when agent_id matches the session's
}
