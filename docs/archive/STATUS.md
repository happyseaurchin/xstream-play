# XStream Play — Project Status

## What Works (31 March 2026)

### Star operator + BSP-walked agent blocks
- `src/kernel/bsp.ts` — TypeScript port of pscale BSP function, now includes star operator (`collectUnderscore`, `findHiddenLevel`, `getHiddenDirectory`, `StarResult`)
- `blocks/xstream/medium-agent.json` — medium-LLM identity as a pscale block, carries star references in hidden directories naming world blocks it needs
- `blocks/xstream/soft-agent.json` — soft-LLM agent block, carries restricted star references (spatial only, no rules)
- `prompt.ts` walks medium-agent.json via BSP, follows stars via `block-registry.ts` to walk world blocks (spatial + rules)
- `soft-prompt.ts` walks soft-agent.json via BSP with restricted star references (spatial only)
- `block-registry.ts` — kernel follows star references from agent blocks to resolve world block walks; wiring lives in blocks, not code
- Identity blocks added: Essa, Harren, Kael, plus a template
- `{name}` placeholders in blocks, substituted at prompt assembly time

### Harness + filmstrip
- `harness.ts` + `harness.json` — constrains solid output length at the prompt level
- `api/filmstrip.ts` — logs LLM calls for debugging (currently returns 500 error due to table schema mismatch, needs fixing)

### Block factory defaults
- `block-factory.ts` defaults: `max_tokens` 2048, `spatial_address` '111'

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
- Now a proper BSP-walked agent block (`soft-agent.json`) with restricted star references

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

## Branch Status

**feature/hard-llm** — NOT yet merged to main. Contains all star operator + BSP walk work described above.

---

## Known Issues

### Filmstrip API returns 500
`api/filmstrip.ts` logs LLM calls but the Supabase table schema doesn't match. Needs schema fix or migration.

### Characters use each other's names without introduction
The star operator + BSP walks provide spatial and rules context to Medium and Soft. Name gating through a knowledge/relationships block is not yet implemented. The systemic fix is filtering names through identity blocks at perception time — this can be done mechanically via BSP walks or, when judgment is needed, via a future Hard-LLM call.

### prompt_template field still on Block type
`types.ts` and `block-factory.ts` still have the `prompt_template` field. prompt.ts no longer reads it — it walks the BSP block instead. Safe to remove after confirming stability.

### Accumulated events inbox count doesn't always clear visually
Events accumulate and the inbox count shows, but may not clear in the UI after a commit. Needs investigation — may be a UI display issue rather than kernel logic.

---

## What Was Removed

### perception.ts (deleted)
142 lines of hardcoded BSP walks that assembled a perception frame. This was a mistake — the walks should have been star references in agent blocks, not a TypeScript function. The star operator makes this unnecessary: agent blocks name the world blocks they need, and `block-registry.ts` follows the references.

### hard.ts (deleted)
Hard-LLM perception frame engine. Implemented, then removed. The "hard" job (spatial context, rules context) is now done mechanically by BSP walks following star references from agent blocks. Hard-as-LLM returns only when judgment is needed (event contradiction, complex perception filtering).

---

## Development Plan (Priority Order)

### 1. Fix filmstrip + test on Vercel preview
**Status**: Filmstrip API exists but returns 500. Fix table schema, verify LLM call logging works, test full gameplay on a Vercel preview deployment.

### 2. Consider merge to main
**Status**: feature/hard-llm branch is stable. Star operator, agent block star references, harness constraints, and filmstrip logging all in place. Needs gameplay testing before merge.

### 3. Name gating via identity blocks
**Status**: Identity blocks exist (Essa, Harren, Kael). Need to wire knowledge/relationship state so characters are described by appearance until formally introduced. Can be done via star references to identity blocks + BSP walks. Hard-LLM returns here only if judgment is needed.

### 4. Designer face
**Status**: Not started.

A UI mode toggle that lets the player edit layer 2 content: medium constraints, scene descriptions, rules, domino behaviour. All through the same interface, writing to blocks.

This is where pscale pays off: tweak a constraint in the ring, see different narrative behaviour. Change a spatial description, see a different world. The wand, not the axe.

### 5. Author face + world creation
**Status**: Not started.

Broader than designer. Create spatial blocks (design a tavern, a village, a coast), rules blocks (social norms, conflict resolution), NPC blocks. An author builds a world; players inhabit it. BSP spatial addressing makes this navigable: `bsp(spatial, 111)` for a room, `bsp(spatial, 110)` for a building.

### 6. Supabase persistence + accounts
**Status**: Relay table exists. No user accounts yet.

Save character state, game sessions, world configurations. Players resume games. Authors publish worlds. Share game codes that load saved world state.

### 7. B-loop convergence
**Status**: Tested in Python (see `docs/medium-llm-coordination-spec.md`), not implemented in JavaScript kernel.

---

## Block Structure

### medium-agent.json
The block is structured so BSP walks produce the prompt. Star references in hidden directories name world blocks (spatial, rules) that `block-registry.ts` resolves at prompt assembly time.

```
_  = role line          -> spindle root gives identity
1  = rules              -> dir(0.1) gives header + ring of constraints
2  = produce            -> dir(0.2) gives header + ring of output fields (a)-(d)
3  = format instruction -> spindle(0.3) gives JSON format line
*  = hidden directory   -> star references to world blocks (spatial, rules)
```

### soft-agent.json
Same pattern as medium, but restricted star references (spatial only, no rules). Knowledge-gated, conversational, never narrates.

---

## Architecture Lineage

This project was extracted from `happyseaurchin/xstream` (branch: `feature/block-agents`). Key decisions:

1. **Stripped Supabase entirely** — then re-added for relay only (26 March 2026)
2. **Browser-side LLM calls** — player provides API key, calls go direct to Anthropic
3. **Supabase relay** — `relay_blocks` table on xstream project (replaced Vercel Blob)
4. **Kernel ported from Python reference** — `docs/kernel-reference.py` is the tested original
5. **Coordination tested across 5 scenarios** — see `docs/medium-llm-coordination-spec.md`
6. **BSP-walked pscale blocks** — medium-agent.json drives the medium prompt (26 March 2026)
7. **Star operator replaces Hard-LLM** — agent blocks carry star references, kernel follows them mechanically (31 March 2026)

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

### 31 March 2026 — Star operator replaces Hard-LLM
- Star operator ported to `bsp.ts`: `collectUnderscore`, `findHiddenLevel`, `getHiddenDirectory`, `StarResult`
- Agent blocks (`medium-agent.json`, `soft-agent.json`) now carry star references in hidden directories
- `prompt.ts` follows stars via `block-registry.ts` to walk world blocks (spatial + rules)
- `soft-prompt.ts` walks `soft-agent.json` via BSP with restricted star references (spatial only)
- `perception.ts` deleted — 142 lines of hardcoded BSP walks replaced by star references in blocks
- `hard.ts` deleted — Hard-LLM not needed when BSP walks do the job mechanically
- `harness.ts` + `harness.json` constrain solid output length at prompt level
- Filmstrip logging via `api/filmstrip.ts` (500 error on table schema needs fixing)
- `block-factory.ts` defaults: `max_tokens` 2048, `spatial_address` '111'
- Identity blocks added: Essa, Harren, Kael, template
- **Key lesson**: perception.ts was a mistake — hardcoded BSP walks that should have been star references. Always ask: can this be a star reference instead of a TypeScript function?
- **Key lesson**: agent blocks should carry star references in hidden directories to name world blocks they need. The kernel follows stars — wiring lives in blocks, not code.

### 26 March 2026 — BSP refactor + Supabase relay
- Imported `bsp.js` as `src/kernel/bsp.ts`
- Refactored `prompt.ts` to walk `medium-agent.json` via BSP
- Initial block content was too verbose (design-document voice) — broke domino cascades
- Restored **exact tested prompt text** from Python kernel into block — dominos work again
- Block restructured: role at root, rules as ring (0.1), produce as ring (0.2), format at 0.3
- Switched relay from Vercel Blob (hit free tier limits) to Supabase `relay_blocks` table
- **Key lesson**: design blocks backwards from the target context window. The block serves the LLM, not the specification. Terse imperatives, not explanatory prose.
- **Key lesson**: spindles for vertical context chains, rings for parallel items. Don't use dir walks as fancy field access — that's not pscale.
