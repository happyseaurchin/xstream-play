# XStream Play — Project Status

## What Works (26 March 2026)

### BSP-walked medium-agent block
- `src/kernel/bsp.ts` — TypeScript port of the pscale BSP function
- `blocks/xstream/medium-agent.json` — medium-LLM identity as a pscale block
- `prompt.ts` walks the block via BSP: role from root spindle, rules from dir(0.1), produce from dir(0.2), format from spindle(0.3)
- The block contains the **exact tested prompt text** from the Python kernel — same words, same (a)-(d) output format
- `{name}` placeholders in the block, substituted at prompt assembly time

### Multiplayer narrative coordination
- Two+ players create/join games via 6-character codes
- Each player's browser runs its own kernel (JavaScript, no server)
- Kernels poll a **Supabase** relay every 3 seconds (switched from Vercel Blob 26 March)
- Medium-LLM (Haiku) fires on player commit, produces:
  - **Solid**: personalised narrative in second person present
  - **Events**: factual, observable, deposited to outbox for peers
  - **Dominos**: signals targeting affected characters
- Peer kernels discover events and dominos via polling
- **Domino cascades confirmed working** — auto mode produces emergent narrative between characters
- Three domino modes: auto (cascading), informed (perception only), silent (accumulate)

### Soft-LLM consultation
- Player can ASK before committing (thinking partner, Haiku)
- Knowledge-gated: only references what the character has learned

### UI
- Three-zone layout: solid (narrative), liquid (submitted intentions), vapor (input)
- Draggable separators between zones
- Four themes: dark, light, cyber, soft
- Download solid history as text file
- Kernel log display (toggle)

### Infrastructure
- API keys stored in browser localStorage only, never sent to server
- Relay: Supabase `relay_blocks` table on `xstream` project (eu-central-1)
- Relay stores blocks with API key redacted
- play.onen.ai production deployment (Vercel)
- Vercel preview deployments on feature branches (note: need SUPABASE_URL and SUPABASE_ANON_KEY env vars)

---

## Known Issues

### Characters use each other's names without introduction
The medium-LLM uses character names in events and narrative even when characters haven't been introduced. The **systemic fix** is Hard-LLM: it builds a perception frame that filters names through a knowledge/relationships block. Without Hard, Medium gets raw accumulated events with names exposed in the `[Established by {source}'s resolution]` label and in events text.

**Do NOT fix this with more Medium constraints.** Hard-LLM is the proper solution — it existed in the parent repo's block-agents branch and worked.

### prompt_template field still on Block type
`types.ts` and `block-factory.ts` still have the `prompt_template` field. prompt.ts no longer reads it — it walks the BSP block instead. Safe to remove after confirming stability.

### Accumulated events inbox count doesn't always clear visually
Events accumulate and the inbox count shows, but may not clear in the UI after a commit. Needs investigation — may be a UI display issue rather than kernel logic.

---

## Development Plan (Priority Order)

### 1. Hard-LLM + world blocks
**Status**: Not started. **This is the most important next step.**

Hard-LLM reads world state via BSP walks and produces a **frame** — a filtered perception of what the character can see, hear, and know. Medium receives the frame, not raw world data.

What Hard does:
- Walks spatial block at character's coordinates → scene description
- Walks character/relationship blocks → describes other characters by appearance unless known by name
- Walks rules block → includes applicable rules in the frame
- Walks events block → includes relevant recent history

What this solves:
- **Name gating**: characters described by appearance until formally introduced
- **Position-aware perception**: what you can see depends on where you are
- **Spatial play**: characters move through BSP-navigable spaces
- **NPC behaviour**: NPCs get their own perception frames

The `hard-agent.json` block already exists in `blocks/xstream/`. The spatial (`spatial-thornkeep.json`) and rules (`rules-thornkeep.json`) blocks also exist. They need to be wired in.

**Key design principle**: Hard's frame IS the scene context that Medium receives. Replace the static `block.scene` string with Hard's output.

### 2. Designer face
**Status**: Not started.

A UI mode toggle that lets the player edit layer 2 content: medium constraints, scene descriptions, rules, domino behaviour. All through the same interface, writing to blocks.

This is where pscale pays off: tweak a constraint in the ring, see different narrative behaviour. Change a spatial description, see a different world. The wand, not the axe.

### 3. Author face + world creation
**Status**: Not started.

Broader than designer. Create spatial blocks (design a tavern, a village, a coast), rules blocks (social norms, conflict resolution), NPC blocks. An author builds a world; players inhabit it. BSP spatial addressing makes this navigable: `bsp(spatial, 111)` for a room, `bsp(spatial, 110)` for a building.

### 4. Supabase persistence + accounts
**Status**: Relay table exists. No user accounts yet.

Save character state, game sessions, world configurations. Players resume games. Authors publish worlds. Share game codes that load saved world state.

### 5. B-loop convergence
**Status**: Tested in Python (see `docs/medium-llm-coordination-spec.md`), not implemented in JavaScript kernel.

### 6. Soft-LLM as proper agent block
**Status**: Inline prompt in App.tsx. Should be a BSP-walked block like medium.

---

## Block Structure (medium-agent.json)

The block is structured so BSP walks produce the prompt:

```
_  = role line          → spindle root gives identity
1  = rules              → dir(0.1) gives header + ring of constraints
2  = produce            → dir(0.2) gives header + ring of output fields (a)-(d)
3  = format instruction → spindle(0.3) gives JSON format line
```

Design principle: **start from the target context window, work backwards to block structure.** The block serves the LLM prompt, not the other way around. Spindles for vertical context chains, rings for parallel items (constraints, output fields).

---

## Architecture Lineage

This project was extracted from `happyseaurchin/xstream` (branch: `feature/block-agents`). Key decisions:

1. **Stripped Supabase entirely** — then re-added for relay only (26 March 2026)
2. **Browser-side LLM calls** — player provides API key, calls go direct to Anthropic
3. **Supabase relay** — `relay_blocks` table on xstream project (replaced Vercel Blob)
4. **Kernel ported from Python reference** — `docs/kernel-reference.py` is the tested original
5. **Coordination tested across 5 scenarios** — see `docs/medium-llm-coordination-spec.md`
6. **BSP-walked pscale blocks** — medium-agent.json drives the medium prompt (26 March 2026)

---

## Key Reference Documents

| Document | What it covers |
|----------|---------------|
| `CLAUDE.md` | Project philosophy, pscale primer, development guide |
| `docs/medium-llm-coordination-spec.md` | Full tested coordination spec with 5 scenarios |
| `docs/kernel-architecture-for-cc.md` | Sovereignty principle, loop design, block structure |
| `docs/kernel-reference.py` | Python reference implementation of the kernel |
| `docs/cc-seed-spec-v3.md` | V3 build spec with agent blocks (soft/medium/hard) |
| `docs/onen-rpg-xstream-architecture.md` | Full unified-loop architecture vision |
| `docs/example-kael.json` | Example character block (tested) |
| `docs/example-essa.json` | Example character block (tested) |

---

## Session Log

### 26 March 2026 — BSP refactor + Supabase relay
- Imported `bsp.js` as `src/kernel/bsp.ts`
- Refactored `prompt.ts` to walk `medium-agent.json` via BSP
- Initial block content was too verbose (design-document voice) — broke domino cascades
- Restored **exact tested prompt text** from Python kernel into block — dominos work again
- Block restructured: role at root, rules as ring (0.1), produce as ring (0.2), format at 0.3
- Switched relay from Vercel Blob (hit free tier limits) to Supabase `relay_blocks` table
- **Key lesson**: design blocks backwards from the target context window. The block serves the LLM, not the specification. Terse imperatives, not explanatory prose.
- **Key lesson**: spindles for vertical context chains, rings for parallel items. Don't use dir walks as fancy field access — that's not pscale.
