# CLAUDE.md — XStream Play

## FIRST THING YOU DO

Before ANY coding, fetch and understand pscale:

```
https://raw.githubusercontent.com/pscale-commons/pscale/main/pscale-touchstone.json
https://raw.githubusercontent.com/pscale-commons/pscale/main/bsp.js
```

**Read the touchstone.** It is a pscale JSON block that teaches the pscale block format by being an operational example of it. Every spindle through it delivers both explanation and demonstration simultaneously.

**Implement or import bsp.js.** The BSP function is the single most important tool in this project. Everything — prompt composition, world navigation, context window assembly — should flow through BSP walks. `bsp(block, number, mode?)` splits a number into digits, walks the tree, collects underscore text at each level. The result is a spindle: broad context narrowing to specific detail.

**The coding inversion**: in pscale, meaning lives inside numbers. Address `0.213` walks a tree and returns a chain of semantic content. The number IS the query. The structure IS the index. There are no field names to memorise, no schema to learn — just underscore, digits 1-9, and curly brackets. Any consumer that understands these three conventions can navigate any block regardless of subject matter.

> **HONESTY**: The current codebase does NOT yet use BSP walks for prompt composition.
> `prompt.ts` assembles text directly from block fields. This is the main gap.
> The most important work is replacing direct field access with BSP spindle walks
> through pscale blocks. Every session should move the codebase toward this.

---

## THE RULE

Before writing TypeScript, ask: **"Can this be a block edit instead?"**

If you're adding a new feature, ask: **"Can BSP walk a block to provide this?"**

If you're changing behaviour, ask: **"Is this a spindle at a different address?"**

---

## PHILOSOPHY: THREE LAYERS

| Layer | What | Where it lives | Who changes it |
|-------|------|----------------|----------------|
| **Layer 0** | Kernel code, relay, infrastructure | TypeScript files | Developer (rarely) |
| **Layer 1** | Block structure, kernel loop logic | `src/kernel/` | Developer (carefully) |
| **Layer 2** | Prompts, scenes, rules, behaviour | JSON blocks | Designer face (frequently) |
| **Layer 3** | Emergent narrative, player experience | Context windows | Nobody — it emerges |

**The goal is to shrink Layer 0/1 and grow Layer 2.** Every hardcoded string in TypeScript is a failure to use a block. The kernel should be a thin loop that reads blocks and calls Claude. All intelligence lives in the blocks and prompts.

**If you are writing prompt text in TypeScript, you are doing it wrong.**

---

## PSCALE QUICK REFERENCE

The format uses three key types: `_` (meaning at zero), `1`-`9` (branches), `{}` (depth).

BSP modes: `spindle` (default — vertical context chain), `ring` (siblings), `dir` (full tree), `point` (one node), `disc` (one depth across all branches).

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
| Reads peer blocks  |   (Vercel    |  Writes own block   |
|                    |    Blob)     |                    |
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

### Domino modes (designer-configurable, currently in block.trigger)
- **auto** — domino fires medium, character acts autonomously (narrative cascades)
- **informed** — domino fires medium, but character only PERCEIVES, never acts
- **silent** — events accumulate, no LLM fires until player commits

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
    kernel.ts          # The loop. Polls, triggers, calls medium.
    block-factory.ts   # Creates fresh character blocks with defaults.
    prompt.ts          # Assembles medium-LLM prompt from block state.
    claude-direct.ts   # Browser → Anthropic API. 34 lines.
    types.ts           # Block structure. L0/L2 split documented.
  components/
    SetupScreen.tsx    # API key + Create/Join game flow
    xstream/           # UI components (zones, separators, themes)
  App.tsx              # Session lifecycle + zone rendering
api/
  relay/
    [gameId]/
      [charId].ts      # PUT/GET individual block
      index.ts         # GET all blocks for a game
```

### Key principle: the kernel/ directory is the engine. Everything else is UI.

---

## WHAT NEEDS TO HAPPEN NEXT

### Priority 1: Make prompt templates into pscale blocks
Currently `block-factory.ts` hardcodes `DEFAULT_PROMPT_TEMPLATE` as a plain object. This should be a pscale block that BSP walks compose into the context window. The medium-LLM agent block (see `docs/medium-agent.json`) defines its own identity, constraints, and output schema as BSP-navigable content.

### Priority 2: Soft-LLM as a proper agent
Currently `App.tsx` has an inline soft-LLM prompt (lines ~179-186). This should be a soft-LLM agent block — same pattern as medium, but with Haiku and different constraints (knowledge-gated, conversational, never narrates).

### Priority 3: Hard-LLM for frame building
Currently there's no Hard-LLM. The scene description is static text. Hard should read spatial + events + characters blocks via BSP walks and produce a frame (what the character perceives). This frame becomes context for Soft and Medium.

### Priority 4: World blocks as pscale JSON
The scene is currently a text string. It should be a spatial block (pscale, BSP-walkable). Events should accumulate in a living block (Form 2). Characters should be a block. Rules should be a block. All navigable by BSP.

### Priority 5: Designer face
Let the player switch to designer mode and edit layer 2 content: prompt templates, scene descriptions, rules, domino behaviour. All through the same UI, writing to blocks that the kernel reads.

---

## COMMANDS

```bash
npm run dev      # Start dev server
npm run build    # TypeScript compile + Vite build
npm run preview  # Preview production build
```

No env vars needed for local development. The API key is entered by the player in the browser. The `BLOB_READ_WRITE_TOKEN` is only needed on Vercel for the relay.

---

## WORKING WITH DAVID

David is a **vibe-coder** — an architect and designer with 25+ years of theoretical work on coordination systems. He understands the *what* and *why* deeply. You help with the *how*.

- Explain what you're doing and why, in plain language
- Don't assume deep technical knowledge
- When things break, diagnose calmly
- **Always ask: "Can this be a block edit instead of a code change?"**
- The product is the experience in the player's mind — not text on drives

---

## SCOPE

- **Repo**: `happyseaurchin/xstream-play`
- **Deployed to**: `play.onen.ai` (Vercel, production)
- **Relay storage**: Vercel Blob (24h TTL)
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
