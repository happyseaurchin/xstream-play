/**
 * Block types — the canonical shape of a character's JSON block.
 * Layer 2 (designer-editable) + Layer 0 (kernel-managed runtime).
 */

// ── Hard-LLM Frame types ──

export interface Frame {
  location: string;
  visible: string[];
  audible: string[];
  atmosphere: string;
  characters_present: FrameCharacter[];
  recent_traces: string[];
  applicable_rules: string[];
  exits: FrameExit[];
}

export interface FrameCharacter {
  id: string;
  description: string;
  current_activity: string;
  familiarity: number;
}

export interface FrameExit {
  direction: string;
  description: string;
  spatial_address: string;
}

export interface GameEvent {
  S: string;      // spatial address
  T: number;      // temporal index
  I: string;      // identity — who did it / who it's about
  text: string;
  type: 'action' | 'arrival' | 'departure' | 'state_change' | 'atmosphere';
}

// ── Block ──

export interface Block {
  // ── Layer 2: Content (designer-editable) ──
  character: {
    id: string;
    name: string;
    state: string;
    solid_history: string[];
  };
  scene: string;
  trigger: {
    poll_interval_s: number;
    domino_fires_medium: boolean;
    accumulation_threshold: number;
    domino_mode: 'auto' | 'informed' | 'silent';
  };
  medium: {
    model: string;
    api_key: string;
    max_tokens: number;
  };
  prompt_template: {
    role: string;
    constraints: string[];
    output_instruction: string;
  };

  // ── Layer 0: Runtime state (kernel-managed) ──
  pending_liquid: string | null;
  accumulated: { source: string; events: string[] }[];
  outbox: {
    solid: string | null;
    events: string[];
    domino: DominoOut[];
    sequence: number;
    timestamp: string | null;
  };
  status: 'idle' | 'waiting' | 'resolving' | 'domino_responding';
  last_seen: Record<string, number>;

  // ── Harness control ──
  harness_pscale?: number;  // default -2 (paragraph). Designer-editable.

  // ── Hard-LLM state ──
  frame: Frame | null;
  spatial_address: string;
  familiarity: Record<string, number>;
  event_log: GameEvent[];
}

export interface DominoOut {
  target: string;
  context: string;
  urgency: string;
}

export interface MediumResult {
  solid?: string;
  events?: string[];
  structured_events?: GameEvent[];
  domino?: DominoOut[];
  internal?: string;
  liquid_status?: string;
  location_change?: string;
}

export interface AccumulatedEvent {
  source: string;
  events: string[];
  sequence: number;
}

export interface DominoSignal {
  source: string;
  context: string;
  urgency: string;
  sequence: number;
}
