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

export interface BeachSession {
  /** Identity. agent_id is the public handle; secret stays in sessionStorage. */
  agent_id: string;
  secret: string;

  /** Where we are. */
  current_beach: string;            // bsp() agent_id for substrate calls
  current_address: string;           // pscale coordinate within the beach (empty = root)

  /** Optional frame engagement (per protocol-xstream-frame.md). */
  current_frame: string | null;      // block name on the current beach, e.g. "frame:my-scene"
  entity_position: string | null;    // digit ('1'..'9') the user occupies in the frame

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
}): BeachSession {
  return {
    agent_id: opts.agent_id,
    secret: opts.secret,
    current_beach: opts.beach,
    current_address: opts.address ?? '',
    current_frame: null,
    entity_position: null,
    vapor_draft: '',
    liquid_pending: '',
    last_solid: null,
    api_key: opts.api_key ?? null,
    medium_model: 'claude-sonnet-4-6',
    soft_model: 'claude-haiku-4-5-20251001',
  };
}

/** A mark visible at the current address — terse stigmergy trace. */
export interface MarkRow {
  digit: string;                     // position under beach:1
  agent_id: string | null;           // null for anonymous / unstructured marks
  address: string | null;
  timestamp: string | null;
  text: string;                      // human-readable summary (or full content for unstructured)
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
