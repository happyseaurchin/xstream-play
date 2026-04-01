# CLAUDE.md — XStream Play

## FIRST THING YOU DO

Before ANY coding, fetch and understand pscale:

```
https://raw.githubusercontent.com/pscale-commons/pscale/main/pscale-touchstone.json
https://raw.githubusercontent.com/pscale-commons/pscale/main/bsp.js
```

**Read the touchstone.** It is a pscale JSON block that teaches the pscale block format by being an operational example of it. Every spindle through it delivers both explanation and demonstration simultaneously.

**Understand bsp.ts.** The BSP function is the single most important tool in this project. Everything — prompt composition, world navigation, context window assembly — flows through BSP walks. `bsp(block, number, mode?)` splits a number into digits, walks the tree, collects underscore text at each level. The result is a spindle: broad context narrowing to specific detail.

**The coding inversion**: in pscale, meaning lives inside numbers. Address `0.213` walks a tree and returns a chain of semantic content. The number IS the query. The structure IS the index. There are no field names to memorise, no schema to learn — just underscore, digits 1-9, and curly brackets. Any consumer that understands these three conventions can navigate any block regardless of subject matter.

---

## THE ABSOLUTE RULE — READ THIS BEFORE WRITING ANY CODE

**DO NOT write prompt text in TypeScript. DO NOT hardcode world data in TypeScript. DO NOT encode wiring in TypeScript.**

Every time you are about to write a string, a constraint, a rule, or a description in TypeScript — STOP. That content belongs in a JSON block. BSP walks extract it. The kernel follows. The kernel does not know what is in the blocks.

**The test**: if removing the TypeScript would lose information that should be designer-editable, you are doing it wrong.

Before writing TypeScript, ask:
1. **"Can this be a block edit instead?"** — if yes, edit the block.
2. **"Can BSP walk a block to provide this?"** — if yes, walk the block.
3. **"Is this a spindle at a different address?"** — if yes, change the address, not the code.

**The star operator** (`bsp(block, address, '*')`) is how blocks reference other blocks. Hidden directories in agent blocks name which world blocks to walk. The kernel reads the names, looks them up in block-registry.ts, walks them at runtime. This is the correct wiring pattern. Do not replicate it in TypeScript.

**What lives in TypeScript (unavoidable runtime):**
- The kernel poll loop itself
- Reading/writing the relay (network I/O)
- Peer block discovery (runtime state — who is here, their sequence numbers)
- Familiarity gating (runtime state — `block.familiarity[peerId]`)
- Event log filtering by spatial address (runtime state)
- The BSP walk function itself (`bsp.ts`)
- Block registry (10-line name→import map — adding a block = one line)

**Everything else is a block.**

---

## PHILOSOPHY: THREE LAYERS

| Layer | What | Where it lives | Who changes it |
|-------|------|----------------|----------------|
| **Layer 0** | Kernel code, relay, infrastructure | TypeScript files | Developer (rarely) |
| **Layer 1** | Block structure, kernel loop logic | `src/kernel/` | Developer (carefully) |
| **Layer 2** | Prompts, scenes, rules, behaviour | JSON blocks | Designer face (frequently) |
| **Layer 3** | Emergent narrative, player experience | Context windows | Nobody — it emerges |

**The goal is to shrink Layer 0/1 and grow Layer 2.** Every hardcoded string in TypeScript is a failure to use a block. The kernel is a thin loop that reads blocks and calls Claude. All intelligence lives in the blocks.

---

## PSCALE QUICK REFERENCE

The format uses three key types: `_` (meaning at zero), `1`-`9` (branches), `{}` (depth).

**BSP modes:**
- `spindle` (default) — vertical context chain, broad to specific
- `ring` — siblings at the same level (exits, alternatives)
- `dir` — full subtree from a node (all contents)
- `point` — single node only
- `disc` — one depth across all branches
- `*` (star) — hidden directory at a node — returns block references

**Star operator:** When a node's underscore is an object (not a string) with digit children, those digits are a hidden directory. `bsp(block, 0, '*')` returns `{ semantic, hidden: { "1": "spatial-thornkeep", "2": "rules-thornkeep" } }`. The kernel looks up names in block-registry.ts and walks those blocks. THIS IS HOW AGENT BLOCKS WIRE THEMSELVES TO WORLD BLOCKS.

**collectUnderscore(node):** Follows the `_._` chain to find the semantic text string. Use this when a node's underscore is itself a nested object (as in star-wired agent blocks).

Floor = underscore chain depth. A rendition block (floor 1) has addresses like `0.213`. A living block (floor 3) has addresses like `321.4`. The walk function is identical — floor calibrates which depth is human scale.

Full spec: read the touchstone (linked above). It teaches itself.

---

## ARCHITECTURE

### What this is
A multiplayer narrative game where each player runs their own AI engine in their browser. No shared database. No server-side AI calls. Coordination happens through JSON blocks exchanged via a dumb relay.

### The sovereignty principle
- Each player's browser IS their kernel
- API keys never leave the browser
- No kernel ever calls another character's LLM
- The relay is a bucket — it stores and returns JSON, nothing more
- Coherence emerges from shared reading, not shared state

### System diagram
```
Player A's browser                     Player B's browser
+--------------------+                +--------------------+
| React UI           |                | React UI           |
| Kernel Loop (JS)   |                | Kernel Loop (JS)   |
|                    |                |                    |
| Writes own block --+--> RELAY <---+--> Reads peer blocks |
| Reads peer blocks  |  (Supabase)  |  Writes own block   |
|                    |              |                      |
| API key in         |                | API key in         |
| localStorage ------+-> anthropic  | localStorage ------+-> anthropic
+--------------------+   .com       +--------------------+   .com
```

### The kernel loop (~60 lines of logic)
```
every poll_interval_s:
  1. POLL PEERS
     read peer blocks from relay
     accumulate new events (sequence-based dedup)
     detect dominos targeting me
  2. PROCESS DOMINOS
     if domino found AND trigger allows:
       fire medium with trigger_type="domino"
       write result to outbox
  3. PROCESS PLAYER COMMIT
     if status == "resolving":
       fire medium with trigger_type="commit"
       write result to outbox
```

### Three trigger modes
1. **Player commit** — player types intention, hits commit, medium fires
2. **Domino** — another medium's output directly affects this character, medium fires automatically
3. **Accumulation** — events arrive silently, wait for next trigger

### Domino modes (designer-configurable in block.trigger)
- **auto** — domino fires medium, character acts autonomously (narrative cascades)
- **informed** — domino fires medium, but character only PERCEIVES, never acts
- **silent** — events accumulate, no LLM fires until player commits

### The LLM triad
Each character has access to three LLM roles:
- **Soft** — inner voice / thought assist. Haiku. Conversational. Knowledge-gated (can't know what the character doesn't know). Never narrates, never produces canon.
- **Medium** — narrator. Haiku/Sonnet. Fires on commit or domino. Produces solid (narrative) + events (canon) + domino targets.
- **Hard** — world reader. Now MECHANICAL — BSP walks only, no LLM call. Produces perception frame (location, visible, exits, characters present, recent events). Result feeds into medium and soft prompts via star-walked blocks.

---

## BLOCK WIRING — HOW IT WORKS

Agent blocks carry their own wiring via hidden directories:

```json
// medium-agent.json root underscore — subnested
{
  "_": {
    "_": "You are the medium-LLM for {name} in a narrative coordination system.",
    "1": "spatial-thornkeep",
    "2": "rules-thornkeep"
  },
  "1": { "_": "RULES:", ... },
  "2": { "_": "Produce:", ... },
  "3": "Respond in JSON only. No markdown. No backticks."
}
```

`bsp(mediumAgent, 0, '*')` returns `{ semantic: "You are the medium-LLM...", hidden: { "1": "spatial-thornkeep", "2": "rules-thornkeep" } }`.

`block-registry.ts` maps names to imports. The kernel follows the references, walks the named blocks at the character's `spatial_address`. The wiring is in the block. The kernel just follows.

**To add a new world block:**
1. Create the JSON file in `blocks/xstream/`
2. Add one import + one entry in `block-registry.ts`
3. Add its name to the relevant agent block's hidden directory

No other TypeScript changes needed.

---

## COORDINATION SPEC

### Canon (the core constraint)
Events from a resolved medium are **canon**. Later mediums MUST incorporate them. They can perceive differently based on position, but cannot contradict. This is a one-way ratchet that progressively narrows possibility until only coherent narratives remain.

### Sequential commits (80%+ of play)
Player A commits → A's medium fires with accumulated context → produces solid + events → events deposited to outbox → B's kernel discovers on next poll → events accumulate in B's block → when B commits, B's medium incorporates A's events as established fact.

### Simultaneous conflict (rare)
Two passes. Pass 0: each medium produces a provisional. Pass 1: each medium sees all provisionals and produces revised solid. Convergence in one iteration tested for three-way conflict.

### Commit-order-as-initiative
First committer shapes the skeleton. Last committer sees the most context. Same intentions, different order, opposite outcomes. An emergent game mechanic that costs nothing to implement.

### Pending liquid shapes domino response
If a character has submitted liquid (intention) but not committed, and a domino arrives, the medium uses the liquid as context. The specific action may be overridden by events, but the intention is preserved.

---

## FILE STRUCTURE

```
src/
  kernel/
    kernel.ts           # The loop. Polls, triggers, calls medium/author/designer/hard.
    block-factory.ts    # Creates fresh character blocks with defaults.
    block-store.ts      # Mutable block store. getBlock/setBlock/applyBlockEdit.
    prompt.ts           # Prompt builders: medium, author, designer, hard. BSP walks.
    soft-prompt.ts      # Soft-LLM prompt via BSP walks of soft-agent.json.
    bsp.ts              # BSP walk function. Spindle, ring, dir, point, disc, star.
    harness.ts          # Resolves solid output constraint from harness.json.
    claude-direct.ts    # Browser → Anthropic API.
    types.ts            # Block, BlockEdit, Face, MediumResult, AuthorResult, etc.
  components/
    SetupScreen.tsx     # API key + Create/Join game flow
    xstream/            # UI components (zones, separators, themes)
  App.tsx               # Session lifecycle + zone rendering
api/
  relay/
    [gameId]/
      [charId].ts       # PUT/GET individual block
      index.ts          # GET all blocks for a game

blocks/
  xstream/
    medium-agent.json   # Character narrative. 1 star ref (spatial).
    soft-agent.json     # Character inner voice. 1 star ref (spatial).
    hard-agent.json     # Reconciler. 2 star refs (spatial, rules). Event→BlockEdit.
    author-agent.json   # Author editing. 1 star ref (spatial). Produces BlockEdits.
    designer-agent.json # Designer editing. 4 star refs (all agents + rules).
    spatial-thornkeep.json  # World spatial block. BSP addresses are locations.
    rules-thornkeep.json    # World rules block. Location-specific + perception.
    harness.json        # Solid output constraint levels (P-4 through P0).
    character-*.json    # Character blocks (NPC descriptions, player template).
```

### Key principle: the kernel/ directory is the engine. Everything else is UI or blocks.

---

## WHAT NEEDS TO HAPPEN NEXT

### Priority 1: Live-test Jump 4 faces
The spec test: start as character → switch to author → type edit → commit → switch back → character sees the change. All 8 steps are structurally complete but untested with real LLM calls.

### Priority 2: Tune author/designer agent blocks
The LLM must produce valid BlockEdits (correct block name, valid BSP address, appropriate operation). Few-shot examples in agent blocks may need adjustment after live testing. Sonnet minimum for structured edit output.

### Priority 3: Wire character blocks
character-essa.json etc. are in the store but no agent block references them. Soft/medium don't walk character blocks for NPC descriptions. Wire via star refs at spatial addresses.

### Priority 4: Block persistence
Block edits live in memory only. Author/designer work is lost on page close. Path: write edited blocks to relay for persistence and multi-player visibility.

### Priority 5: Multi-world support
A different game setting = different spatial + rules blocks. Agent blocks reference different block names via star. Block store loads different seeds. No kernel code changes.

### Priority 6: Fix filmstrip 500 error
`api/filmstrip.ts` posts to Supabase. The table has NOT NULL columns (game_id, char_id, llm_role) but `callClaude` doesn't send them. Non-blocking.

---

## COMMANDS

```bash
npm run dev      # Start dev server
npm run build    # TypeScript compile + Vite build
npm run preview  # Preview production build
```

No env vars needed for local development. The API key is entered by the player in the browser. Supabase credentials are in Vercel environment variables for the relay.

---

## WORKING WITH DAVID

David is a **vibe-coder** — an architect and designer with 25+ years of theoretical work on coordination systems. He understands the *what* and *why* deeply. You help with the *how*.

- Explain what you're doing and why, in plain language
- Don't assume deep technical knowledge
- When things break, diagnose calmly
- **Always ask: "Can this be a block edit instead of a code change?"**
- The product is the experience in the player's mind — not text on drives
- **Code bloat is a failure mode.** If you are adding lines, justify each one. If you can delete lines, do.

---

## SCOPE

- **Repo**: `happyseaurchin/xstream-play`
- **Deployed to**: `play.onen.ai` (Vercel, production)
- **Relay storage**: Supabase (`relay_blocks` table)
- **Vercel team**: `happyseaurchins-projects`

---

## DESIGN PRINCIPLES

1. **Sovereignty** — each player owns their kernel, their blocks, their API key
2. **Stigmergy** — coordination through shared environment (relay), not messages
3. **Minimal kernel** — the loop is thin; intelligence lives in blocks
4. **Soft-code everything** — if it could be a block, it must be a block
5. **Experience over infrastructure** — the game is what happens in minds, not on servers
6. **Canon as one-way ratchet** — resolved events narrow possibility monotonically
7. **Blocks are the API** — you GET /block, everything is in it
