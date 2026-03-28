# Onen RPG: Block Architecture & Experience Design

**Session synthesis — March 2026**
**Context**: Returning to Xstream after hermitcrab/pscale block maturation. Re-examining the RPG use case with the now-precise JSON block format and BSP function.

---

## Part I: What the Game Is

### Cross-Summary Triangulation

Three independent summaries of the Onen RPG (from the xstream project, the onen project, and from outside both projects) converge on the same core identity:

**No central world state.** The "world" is not simulated anywhere. Each player-character is a self-contained narrative agent with its own LLM stack. Coherence between players emerges from local narrative exchange — semantic fragments propagating through proximity networks, not truth broadcast from a central server.

**Design philosophy**: We do not simulate worlds. We coordinate narratives.

**Scaling principle**: Traditional RPG architecture requires O(n²) coordination via shared world state. Onen requires O(k) where k = proximity group size (2–10 characters). A million simultaneous player-characters becomes tractable because no single entity holds or processes the whole world. Each character pays for its own LLM triad. No shared processing needed.

### The Player Experience

A player joins via a code (an Opening). They see a single column — mobile-first. The column contains three text states:

- **Solid** (top): Committed narrative. Canonical. Won't change. What has happened from this character's perspective.
- **Liquid** (middle): Formed intentions — yours and those of nearby characters you're privy to. Still mutable. This is where the game's strategic tension lives.
- **Vapor** (bottom): Live typing. Presence signals. Chat. Thinking out loud.

At the very bottom: the player's own input.

The core gameplay loop: type an intention → refine it with your Soft-LLM → see other players' forming intentions as liquid → commit → dice roll (NOMAD) → Medium-LLM synthesizes all committed intentions into narrative → solid text appears → loop continues.

Responses are short: pscale -3 to -2 means 10–100 words per beat. The AI opens forward ("The door opens. A figure at a table, face in shadow. It looks up.") rather than narrating at length. Every response implies: *what do you do?*

---

## Part II: The Initiative–Information Tension

### The Discovery

The vapor/liquid/solid progression creates a genuine strategic game-within-the-game that falls out of the architecture for free.

**Liquid** shows you other characters' intentions before synthesis. This means:

- **Commit early**: Your intention shapes the determination strongly — you're anchoring what happens. But you're blind to what others are planning. You have initiative but no information.
- **Wait and watch**: You see what others intend before you commit. You're informed by knowledge, but you've surrendered the initiative. The narrative has already been shaped by those who committed first.

This mirrors real coordination dynamics. In any group decision, there's a trade-off between being first to declare intent (which anchors the group but exposes you) and waiting to see what others want (which informs you but makes you reactive). Tabletop RPGs have always had this implicitly in turn order. Onen makes it explicit and simultaneous.

The player is *not* seeing the text of what characters do. They're seeing everyone else's *intended intentions*. This is categorically different — the player can mentally model consequences before synthesis occurs. Some players will be quick-draw committers; others will be strategic waiters. Both are valid and both carry trade-offs.

### Why This Replaces the Two-Column Design

An earlier design had a player-column (social coordination, out of character) alongside a character-column (narrative, in character). The two-column tension — knowing what your friends are planning while your character doesn't — was identified as a dramatic engine. But the vapor/liquid/solid structure subsumes this more cleanly:

- **Vapor** = the social/chat layer (what was the player-column)
- **Liquid** = the strategic intention layer (the new insight — seeing intentions, not actions)
- **Solid** = the canonical narrative (what was the character-column)

One column. Three states. The dramatic gap between player-knowledge and character-knowledge is preserved: you see others' intentions (liquid), but your character only experiences the synthesized result (solid).

---

## Part III: Three Mode Blocks — One Pipeline

### The Insight

The triad (Soft/Medium/Hard LLMs) is always the same engine. What makes it behave differently is which blocks feed it. The face — player, author, designer — is a **current** that selects which blocks constitute the context for each tier.

The vapor/liquid/solid pipeline operates identically regardless of face. Only the *content* and *permissions* change.

### Character Mode Block

When active, the triad operates on a character within the narrative.

| Tier | Function | Content Drawn From | Output |
|------|----------|--------------------|--------|
| **Soft** | Consults with player about character's intentions. "Can I sneak past?" "You could try — difficulty 8." | Character identity block, local spatial block, recent solid history | Refined intention → liquid |
| **Medium** | Synthesizes all committed liquid from nearby characters + NOMAD outcomes into narrative | All proximity-window liquid, NOMAD results, spatial context at wider harness | Solid narrative (10–100 words) |
| **Hard** | Manages proximity, files events into spatial/temporal blocks, exchanges semantic coordinates with other characters' Hard-LLMs | Broader spatial/temporal blocks, other characters' Hard-LLM outputs, determinancy cloud fragments | Frame (proximity states, context assembly) |

**Permissions**: A player in character mode can only write *intentions*. They cannot write into the spatial block or modify game rules.

### Author Mode Block

When active, the triad operates on world content creation.

| Tier | Function | Content Drawn From | Output |
|------|----------|--------------------|--------|
| **Soft** | Consults with human about what should exist in the world. "Does this fit? Is this consistent?" | Broader spatial blocks, world structural rules, existing author contributions | Refined world content → liquid |
| **Medium** | Synthesizes multiple authors' contributions into confirmed world content | All author liquid for this spatial region, consistency checks against existing solid | Solid world content (filed into spatial + character blocks) |
| **Hard** | Files confirmed content into appropriate JSON blocks — spatial, character, temporal | The block structure itself, existing determinancy cloud | Updated blocks |

**Permissions**: Authors can write *into* the spatial block. Their liquid is substantial — location descriptions, NPC descriptions, environmental details. Multiple authors may contribute liquid for the same region; the Medium synthesizes into coherent solid.

**Key difference from character mode**: Author output is not for a specific character thread. It goes into the world — the spatial blocks, the character blocks. It creates the content that player-mode characters will later encounter.

### Designer Mode Block

When active, the triad operates on game mechanics, rules, and operational logic.

| Tier | Function | Content Drawn From | Output |
|------|----------|--------------------|--------|
| **Soft** | Consults about rules, mechanics, compilation logic. "Will this modification work? Does this physics rule create problems?" | Game rules block, physics block, compilation instruction blocks | Refined rule proposal → liquid |
| **Medium** | Synthesizes proposed rule changes from multiple designers | All designer liquid, consistency checks against existing operational logic | Confirmed operational rules |
| **Hard** | Updates the functional blocks that govern how player and author modes compile | The operational blocks themselves | Updated compilation context |

**Permissions**: Designers can modify the blocks that define *how the other two modes work*. The designer's solid becomes the operational context that player and author triads run on.

**What designer blocks contain**: Game rules (dice mechanics, NOMAD parameters), physics rules (what's possible in this world — flying, magic systems, gravity), compilation instructions (how Soft/Medium/Hard assemble their context windows), and operational parameters (timing windows, pscale-to-word-count mappings).

### The Metacognitive Layer

The designer mode is metacognitive — it's the instructions for the instructions. The game rules block tells the Medium-LLM how to process NOMAD. The physics block tells the Soft-LLM what's physically possible when consulting with a player. The compilation block tells the Hard-LLM how to perform harness selection.

This means the designer isn't just creating content or playing a character — they're shaping *how the system thinks*. A designer creating a magic system is writing a JSON block that will alter the Soft-LLM's consultation behavior ("yes, you can levitate — here are the rules"), the Medium-LLM's narrative generation ("levitation succeeds; the table rises"), and the Hard-LLM's proximity calculations ("the character is now airborne — vertical proximity applies").

### Summary: Faces as Currents

The face is a current within each tier of the triad. It defines:

1. **What blocks to read** (identity vs spatial vs operational)
2. **What permissions exist** (intentions only vs world content vs rule modification)
3. **What the output is for** (character thread vs world blocks vs operational blocks)

Same engine. Three currents. The BSP walk is parameterized by which current is active.

---

## Part IV: The Block Universe as S × T × I Product

### The Multiplication Principle

From keystone v4 §0.6: "Blocks with different tunings are different types. Combining them is multiplicative — a spatial spindle crossed with a temporal spindle produces an event: what happened here at this time. The product is new meaning, not stored meaning."

The block universe is not a separate data structure. It is the **product** of three block types:

- **Spatial block** — containment hierarchy (forest > clearing > tree position). Stable structure. Positions where things can be.
- **Temporal block** — sequential ordering (before the storm, during, after). The calendar. When things happened.
- **Identity block** — relational network (who experienced it, how they relate to it). The witnesses.

**An event = S × T × I.** The determinancy cloud is the sparse set of points where this product has been computed and stored.

### The White Tree Problem (Worked Example)

**Setup**: A forest spatial block contains a clearing, which contains a notable tree. A character traverses the forest and burns the tree. Subsequently, other characters visit the same location.

**Spatial block** (containment, stable):
```
Forest (pscale 3)
  └── Eastern clearing (pscale 1)
        └── Notable tree position (pscale 0)
```

The spatial block holds *structure*. It never changes. The tree *position* exists before and after the burning. What changes is the event product at that position.

**Events** (S × T × I products):

| Event | S coordinate | T coordinate | I coordinate | Description | Determinancy |
|-------|-------------|-------------|-------------|-------------|--------------|
| 1 | forest.clearing.tree | before-storm | nature | "A white tree, ancient, bark pale as bone." | 8 (centuries old) |
| 2 | forest.clearing.tree | storm-moment | lightning | "Lightning strikes. The tree burns." | 9 (witnessed, pscale -3) |
| 3 | forest.clearing.tree | after-storm | nature | "A charred stump. Blackened bark." | 7 (consequence, still evolving) |

**When any character visits the clearing**, the BSP walk:

1. Walk the spatial block → get the structural address (forest > clearing > tree position)
2. Cross with temporal coordinate → what is the character's current time relative to filed events?
3. Select the most recent event at this S×T intersection ≤ character's arrival time
4. That event's description is what the character sees

Character arriving before the storm → Event 1 → white tree.
Character arriving after the storm → Event 3 → charred stump.

**The spatial coordinate hasn't changed.** The address `forest.clearing.tree` is the same before and after. What changed is the event product at that address. The spatial block is structure; events are content. The temporal coordinate selects which content is current.

### The Identity Filter

The identity coordinate adds a further layer. A character who *witnessed* the lightning strike has Event 2 in their experience. A character who arrives afterward sees only Event 3 (the consequence) unless someone tells them about Event 2 (the cause). The identity dimension determines not just *who* but *what they're privy to*.

### The Gasket Shape

Zoom out. The forest spatial block at pscale 3 has potentially 9 sub-locations at pscale 2, each with 9 at pscale 1, each with 9 at pscale 0. That's 729 possible tree-scale positions. Of those, exactly *one* has any events filed. The rest are determinancy zero — empty, unspecified, fog.

This is the Sierpinski gasket:

- The block universe is mostly empty (determinancy = 0)
- Narrative threads weave through the holes
- Determined points are scattered: a war at pscale 5, a battle at pscale 3, a lightning strike at pscale -3, a character's passage at pscale 2
- Play fills in the universe — every committed action adds a new event product
- The more that's determined, the less maneuverability for subsequent players

**Players operate in the zeros.** Smart players seek locations where higher pscales provide interesting context (there's a war on, something is at stake) but lower pscales are undetermined (what happens in this room, right now, is up to them).

### Stasis Until Animated (Y0 — The Pragmatic First Implementation)

For practical implementation, the world exists in stasis until a character looks at it. Spatial blocks hold *potential* — the pub is described, the street is described, but nothing is *happening* there until a character enters. When a character enters, the Medium-LLM generates the current state from the spatial block plus any relevant temporal markers.

This is dramatically simpler than concurrent independent events AND it's true to tabletop RPG experience (the dungeon doesn't exist until the DM describes it).

The pscale system handles the illusion of continuous time naturally: when a character returns to a location they haven't visited in a while, the Hard-LLM can generate "what happened while you were away" based on the temporal pscale gap and whatever author content or higher-pscale events have been filed there. It *feels* like the world continued (Y1) even though operationally nothing was computed until observed (Y0).

### The Block Universe (Y1 — Full Implementation)

In the full implementation, some things are pre-determined in the block universe. A war spanning a year. A character's journey through a forest on specific days. Lightning striking a specific tree at a specific moment.

These are filed as events (S × T × I products) at their respective pscale levels. Everything else remains undetermined. The block universe is the gasket — specified events with vast gaps of fog between them.

When a player enters a gap, they have maximum agency. As they approach a determined event, their options narrow. If they're in the forest *during* the character's journey and *near* the tree *at* the time of the lightning strike, they're highly constrained by what's already determined. If they're in the forest a month later, the only constraint is: the tree is now a burnt stump.

---

## Part V: Compilation for the Triad

### The Simplification

With JSON blocks and BSP, context compilation for each LLM tier is just a BSP walk with different harness settings.

| Tier | Harness | What the BSP Walk Returns |
|------|----------|---------------------------|
| **Soft** | Tight, local, personal | This character's identity block + immediate spatial spindle (what's in this room) + recent liquid from nearby characters. Minimal context. |
| **Medium** | Mid-range, relational | All committed liquid from the proximity window + NOMAD outcomes + spatial context at slightly wider harness. What's needed to synthesize. |
| **Hard** | Wide, structural | Broader spatial/temporal blocks + other characters' Hard-LLM outputs + determinancy cloud fragments. The full coordinate picture. |

Each is a different depth and breadth of BSP walk through the same underlying JSON structure. The BSP function doesn't know or care whether it's assembling context for a player's Soft-LLM or an author's Medium-LLM. It walks the blocks, extracts the spindle at the requested harness, and returns the context current.

### The Mode Block as System Prompt

The mode block (character/author/designer) functions as the core of the system prompt for each tier. It tells the LLM:

- **Who you are**: "You are the Soft-LLM for a player character" vs "You are the Medium-LLM for an author"
- **What you're doing**: Consulting on intentions vs synthesizing world content vs processing rule changes
- **What you can see**: The BSP walk parameterized by the mode
- **What you can output**: Intentions vs world descriptions vs operational rules

The actual content — what the character sees, what the author is building, what the designer is modifying — comes from the BSP walk through the relevant content blocks.

### The Whole Picture

```
Mode Block (character/author/designer)
    ↓ selects
Content Blocks (spatial, temporal, identity, game rules, physics...)
    ↓ navigated by
BSP Walk (parameterized by mode + tier harness)
    ↓ produces
Context Current (the compiled content for this specific LLM call)
    ↓ fed to
LLM Tier (Soft / Medium / Hard)
    ↓ produces
Output (intention / narrative / world content / rule / frame)
    ↓ filed into
Appropriate Block (character thread / spatial block / operational block)
```

Same pipeline. Every time. The mode selects the blocks. The harness selects the depth. The BSP walk compiles the current. The LLM processes. The output goes back into blocks. And the cycle continues.

---

## Part VI: Fantasy World Constraints

### The Problem

LLMs are trained on how the real world works. A fantasy world may have rules the LLM doesn't know: flying people, magic systems, non-standard physics.

### The Solution: Operational JSON Blocks

The designer creates blocks that specify the fantasy world's operating factors. These are not narrative — they're functional. Similar in structure to the wake block or concerns block in hermitcrab: they contain instructions that the LLM must follow when processing.

**Game rules block**: How dice work, NOMAD mechanics, what constitutes a valid action, engagement states.

**Physics block**: What's physically possible. "Gravity works normally except for the Windborn, who can levitate at will. Levitation costs stamina. Maximum altitude: 200 feet." This constrains what the Soft-LLM tells a player is possible and what the Medium-LLM will generate as narrative.

**Magic system block**: Rules for magic. "Fire magic requires a verbal component. Range: line of sight. Damage scales with caster's willpower. Friendly fire is possible." The Medium-LLM references this when synthesizing magical actions.

These blocks are what the designer face operates on. When a designer modifies the magic system, they're editing a JSON block that subsequently alters how every character-mode triad processes magical actions.

---

## Part VII: Open Questions

### Identity Block Complexity

The identity coordinate is the trickiest of the three. Spatial is containment (rooms within buildings within cities). Temporal is sequence (moments within hours within days). Identity is relational — it describes how entities relate to each other, and those relationships change as context changes. A character who is "kitchen staff" in the castle becomes "refugee" in the forest. Their relational position shifts even though their core identity persists.

This needs re-examination with the current JSON block format. The question: does the identity block hold a stable core with contextual overlays? Or does the identity coordinate genuinely shift as the character moves between social contexts? Both options have implications for how the determinancy cloud computes S × T × I products.

### Temporal Coordination at Scale

The bleeding-edge mode (Y0 where everyone is in the same moment) is acknowledged as infeasible for initial implementation — if one player is crossing a mountain (days of travel), they'd have to wait real-time days. The Schrödinger approach (stasis until observed) handles this for now. The block universe approach (pre-determined events with gaps) is the target.

The unsolved coordination problem: when two players are operating at radically different pscales (one in pscale -2 combat, one in pscale +3 seasonal travel), how does the system keep them synchronized enough that their eventual re-encounter is consistent? The scale-collapse mechanic (finer grain trumps coarser) handles it when players are in proximity, but what about when they're apart and reconverge?

### The XYZ Configuration Space

Three binary dimensions that alter the game's fundamental character:

| Dimension | 0 | 1 |
|-----------|---|---|
| **X** (persistence) | Ephemeral — nothing is saved | Persistent — everything is archived |
| **Y** (temporality) | Bleeding edge — everyone in sync NOW | Block universe — past/future accessible |
| **Z** (mutability) | Inert — world doesn't change | Mutable — player actions alter the world |

Different XYZ configurations create different game experiences. X0Y0Z0 (pure ephemeral play, nothing remains) is the simplest test case. X1Y1Z1 (full persistence, block universe, mutable world) is the full vision. Each configuration places different demands on the block architecture and deserves separate implementation analysis.

### Real World vs Fantasy World

The same architecture serves both. A real-world coordination use case (organizing a community event, coordinating freelancers) uses the same blocks, BSP, and triad. The spatial blocks become real locations. The temporal blocks become real schedules. The identity blocks become real professional relationships. The game rules block becomes the institution block — specifying roles, constraints, and coordination rules.

The RPG is the training ground. The real-world application uses the same infrastructure. The designer-mode blocks for a real-world frame would specify professional norms and organizational constraints rather than magic systems and fantasy physics.

---

## Part VIII: Why This Is Now Tractable

The JSON block format (pscale keystone v4) plus BSP function provides:

1. **Self-describing blocks** — every block carries its own operating instructions at pscale 0. No external documentation required.
2. **Uniform navigation** — BSP walk works the same way regardless of block type. The structure IS the navigation.
3. **Compositional multiplication** — S × T × I = event. The product is new meaning, not stored meaning. The determinancy cloud is just the set of computed products.
4. **Compression** — when blocks fill up, they compress (summary or emergence). The world grows memory through the same mechanism blocks grow.
5. **Harness selection** — different BSP walk depths for different purposes. Soft gets tight local context, Hard gets the full coordinate picture.

The mode blocks (character/author/designer) + content blocks (spatial/temporal/identity/operational) + BSP compilation = a complete specification of how any LLM call in the system gets its context window assembled. It's all blocks, all the way down.

---

## Addendum: Implementation Status (March 2026)

### Repository & Branch

- **Repo**: `happyseaurchin/xstream` on GitHub
- **Branch**: `feature/block-agents` (auto-deploys to Vercel preview)
- **Preview URL**: `xstream-git-feature-block-agents-happyseaurchins-projects.vercel.app`
- **Production domain**: `xstream.onen.ai` (currently serves `main` branch — the older v0.12.1 app)

### Infrastructure Decisions

**Supabase removed.** The prototype runs zero infrastructure — pure localStorage in the browser. JSON blocks are bundled as static imports and seeded to localStorage on first run. Reset = clear localStorage. No env vars, no database, no server dependency.

**Browser-side LLM calls.** Player provides their own Anthropic API key. Calls go directly from the browser using `anthropic-dangerous-direct-browser-access: true`. For production, a thin proxy (Supabase edge function or similar, ~15 lines, no prompt logic) can forward calls without exposing the key. The block architecture and BSP walks remain browser-side regardless.

**BSP implementation**: Ported from `pscale-commons/pscale` (pscale-touchstone v1.0, March 2026). TypeScript port at `src/lib/bsp.ts`. Uses the corrected floor-walk algorithm — root collection follows the entire underscore chain to floor, mid-walk zeros guard against double-counting.

### What's Built (Solo Player Prototype)

| Component | Status | Notes |
|-----------|--------|-------|
| Vapor/Liquid/Solid UI | Working | Three zones with draggable separators, four themes (Dark/Light/Cyber/Soft), floating input |
| Soft engine (Haiku 4.5) | Working | Consults on player intentions, reads frame + knowledge |
| Medium engine (Sonnet 4.6) | Working | Synthesises committed liquid into solid narrative, outputs knowledge updates |
| Hard engine (Sonnet 4.6) | Working | Builds frame from spatial/characters/events/rules blocks using BSP spindle + ring walks |
| BSP library | Working | Spindle, ring, dir, disc, point modes. Floor detection. Address parsing. |
| Shelf (localStorage) | Working | Read/write/export/import JSON blocks by key |
| Session logger | Working | Accumulates all engine calls, shelf ops, errors. Downloadable as text file for analysis. |
| World seeding | Working | Thornkeep blocks bundled and auto-seeded on first run |
| Character lifecycle | Working | Join with name, register in characters block, persist knowledge |

### What's Not Built (From This Document)

| Concept | Status |
|---------|--------|
| S x T x I product computation | Not started. Coordinates are flat 3-digit strings, no dimensional separation. |
| Author face | Function signatures accept it; UI never calls it. |
| Designer face | Same — present in code, unreachable from UI. |
| NOMAD dice | Not implemented. |
| Multiplayer / spindle exchange | Solo only. No inter-character LLM communication. |
| Harness filtering per tier | Hard reads entire blocks. No tight/mid/wide harness distinction. |
| Determinancy cloud | Not implemented. Events are flat, not S x T x I products. |
| Skill packs | Agent blocks are hardcoded exports, not runtime-loaded from shelf. |
| Block universe (Y1) | Operating as Y0 — stasis until animated. |

### Model Routing

| Engine | Model | Max Tokens | When |
|--------|-------|------------|------|
| Soft | `claude-haiku-4-5-20251001` | 512 | Every player query (cheap, fast) |
| Medium | `claude-sonnet-4-6` | 1024 | Every commit (synthesis quality) |
| Hard | `claude-sonnet-4-6` | 2048 | On entry, location change, external events, periodic check (runs rarely) |

### Key Files

```
src/
├── App.block-agents.tsx    # App shell, zones, engine wiring
├── engine/
│   ├── soft.ts             # Soft-LLM (consultation)
│   ├── medium.ts           # Medium-LLM (synthesis → solid)
│   └── hard.ts             # Hard-LLM (frame building)
├── lib/
│   ├── bsp.ts              # BSP walk (from pscale-commons/pscale)
│   ├── shelf.ts            # localStorage read/write
│   ├── claude.ts           # Browser-side Anthropic API caller
│   ├── logger.ts           # Session log accumulator
│   └── world-seed.ts       # Bundles Thornkeep JSON, seeds on first run
├── blocks/
│   └── agents.ts           # Soft/Medium/Hard/Faces block exports
└── components/xstream/     # Zone components (Solid, Liquid, Vapour)

blocks/worlds/thornkeep/    # Authored world JSON blocks
├── spatial.json            # Floor 3, three locations
├── characters.json         # NPCs + player slots (5-9)
├── events.json             # Seeded events
├── rules.json              # World rules
├── knowledge.json          # Knowledge template
└── faces.json              # Player/Author/Designer instructions
```

### Next Steps

The prototype proves the basic pipeline: type → Soft consults → commit → Medium narrates → Hard updates frame. The experience quality needs work (narrative voice, pacing, knowledge gating). The architecture doc above remains the target — particularly S x T x I products, harness-driven BSP walks, and face currents as the next layer of depth.
