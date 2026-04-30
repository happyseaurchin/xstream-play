# Session 01 Handover — Star Operator + System Tightening

**Branch:** `feature/hard-llm` at commit `9860fc7`
**Date:** 31 March 2026
**Preview:** `xstream-play-git-feature-hard-llm-happyseaurchins-projects.vercel.app`

---

## What was done this session

### Star operator integration (the main work)

The starstone (pscale v2.0) introduced hidden directories and the `*` operator. We wired these into the game blocks so that spatial nodes carry their own cross-block references, eliminating hardcoded wiring in TypeScript.

**spatial-thornkeep.json** — Room-level hidden directories at address 111 (main room of the Salted Dog) carrying three dimensional overlays:
- Key `"1"` = S×I (identity/knowledge) — nested depth block, familiarity gates how deep you walk
- Key `"2"` = S×T (events) — `"events-111"` block reference (not yet in registry)
- Key `"3"` = rules — `"rules-thornkeep"` block reference

**rules-thornkeep.json** — Restructured from category-based (social norms / conflict / perception / time) to spatial-mirrored (Thornkeep / headland / southern road). Walking rules at any spatial address via spindle now returns the right location-specific rules. Universal rules (perception, conflict, time) live in the root hidden directory.

**medium-agent.json** — Reduced from two star refs to one (`spatial-thornkeep`). Rules arrive transitively through spatial's hidden directories. Added rule 8: viewpoint character identity to prevent the medium confusing itself with characters in its own history.

**prompt.ts** — Replaced 20 lines of hardcoded address-prefix matching with star-following from the spatial walk address. Now discovers S×I knowledge overlay and rules block refs mechanically. Added NEARBY INTENTIONS section showing peer liquid.

### System tightening

- **Opaque character IDs** — `generateCharId()` produces random 4-char IDs instead of deriving from name. No name leak at familiarity 0.
- **Peer liquid visibility** — `submitLiquid()` writes block to relay immediately so peers can see forming intentions. `onPeerLiquid` callback surfaces them in the UI. Labels use character.state at familiarity 0 (S×I pattern).
- **Liquid clearing** — `pending_liquid` now clears after any successful medium call, not just commits. Fixes sticky liquid through domino chains.
- **Character blocks renamed** — `identity-*.json` → `character-*.json` to avoid confusion with I coordinate in S×T×I system.

### S×I familiarity gating

The knowledge overlay at address 111 is nested (not flat). A spindle walk at familiarity depth accumulates progressively:
- Depth 0 (stranger): "The main room of the Salted Dog. Open to anyone with coin."
- Depth 1 (introduced): + "Essa runs this room. Drawing a weapon inside loses your welcome."
- Depth 2 (known): + "The wooden partition hides the corner table. The trapdoor connects to the cellar."

`prompt.ts` gates the walk by `block.familiarity[peerId]`. Same pattern as spatial depth — no special rules.

---

## What was tested

Two-player sessions confirmed:
- Both kernels poll, accumulate, fire mediums, exchange events via relay
- Domino auto-fire cascades between characters (the narrative builds itself)
- The medium produces rich, coherent narrative from BSP-walked spatial context
- Opaque IDs prevent name leakage (medium sees `[id: x7k2]` not `[id: druss]`)

### Known issues from play-testing

1. **Spatial address never updates** — movement narrated by the medium doesn't change `spatial_address`. The medium invents locations that don't exist in the spatial block (e.g. "the Keep") and the system doesn't track it. The `location_change` field in MediumResult exists but the medium rarely produces it, and addresses outside spatial-thornkeep have nowhere to go.

2. **The medium can invent phantom characters** — if it reads "the young warrior" in its own solid history, it may treat this as a separate entity from itself. Rule 8 in medium-agent.json mitigates but may not fully resolve.

3. **Character landing is thin** — new characters start with `"Boggle. A newcomer."` as their entire identity. The character blocks (character-essa.json etc.) exist but aren't wired into the system. No arrival event seeds the first experience.

4. **Accumulated context clears after each medium call** — by design, but it means the medium only sees each batch of peer events once. If the medium fails to incorporate them, they're gone.

5. **Essa's gender** — the medium sometimes calls Essa "he", sometimes "she". The spatial and rules blocks don't specify gender consistently. The character-essa.json block (which describes "a broad-shouldered woman") isn't wired in.

---

## Current file state

```
blocks/xstream/
  medium-agent.json      # 1 star ref (spatial), 8 rules, produce, format
  soft-agent.json         # 1 star ref (spatial), role/gating/style/format
  hard-agent.json         # Orphaned — describes perception frame, nothing calls it
  spatial-thornkeep.json  # Hidden dirs at 111 (S×I, S×T, rules). 3 levels deep.
  rules-thornkeep.json    # Spatial-mirrored. Hidden dir at root (perception/conflict/time).
  harness.json            # Output constraints P-4 through P0. Working.
  character-essa.json     # Rich 3-depth NPC. Not in registry.
  character-harren.json   # NPC. Not in registry.
  character-kael.json     # NPC. Not in registry.
  character-template.json # Template for player characters.

src/kernel/
  bsp.ts              # Full star operator implementation. Matches bsp-star.py reference.
  block-registry.ts   # Static name→import map. Two entries: spatial + rules.
  prompt.ts           # Star-following from spatial. S×I gating. Nearby intentions.
  soft-prompt.ts      # Star-following spatial only. No rules.
  kernel.ts           # Poll→accumulate→domino→commit loop. Liquid writes to relay.
  block-factory.ts    # createBlock + generateCharId (opaque) + generateGameCode.
  harness.ts          # Resolves output constraints from harness.json.
  claude-direct.ts    # Browser → Anthropic API.
  types.ts            # Block, GameEvent, MediumResult, etc.
```

---

## What Jump 4 needs to do

The spec (`jump4-faces-mutable-blocks.md`) is comprehensive. The critical path:

### Step 1: Mutable block store
Replace `block-registry.ts` with `block-store.ts` — `getBlock`/`setBlock`/`applyBlockEdit`. Clone static imports into mutable in-memory store. All callers (prompt.ts, soft-prompt.ts) switch from `blockRegistry[ref]` to `getBlock(ref)`. This is the foundation for everything else.

### Step 2: Face state + agent routing
Add `Face` type ('character' | 'author' | 'designer'). Face selector in UI. The kernel routes commits through different agent blocks based on face. Author commits produce BlockEdits instead of narrative solids.

### Step 3: Author agent block
Create `author-agent.json` — same structural pattern as medium-agent.json. Star refs to the target block being edited. Produce section asks for BlockEdit output. Medium (Sonnet tier) synthesises natural language into structured block edits.

### Step 4: Designer agent block
Same pattern. Star refs to agent + rules blocks. Produce asks for rule changes with rationale.

### The key insight for the next session
The uniform pattern across all faces is: vapor → liquid → accumulate peer liquid → commit → medium synthesises → output. What varies is which agent block drives the prompt, what address the player is "at", and what the output writes to. The mechanical loop is identical. This is why pscale blocks make it tractable — adding a face is adding a JSON block and a routing decision, not building a new system.

---

## Relay and infrastructure

- **Relay:** Supabase `relay_blocks` table, accessed via Vercel serverless endpoints at `/api/relay/[gameId]/[charId]`
- **Filmstrip:** `/api/filmstrip` endpoint exists but returns 500 (table schema mismatch — `game_id`/`char_id`/`llm_role` are NOT NULL but not sent). Non-blocking.
- **Deploy:** Vercel, team `happyseaurchins-projects`, project `xstream-play`
- **Domain:** `play.onen.ai` (production, currently points to main)
