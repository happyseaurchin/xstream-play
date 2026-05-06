# Prompt for a Claude Code session in hermitcrab-mobius

Copy this into a new CC session opened in `/Users/davidpinto/Projects/hermitcrab-mobius/`

---

## The Task

I need you to design pscale JSON blocks for a multiplayer narrative game called XStream Play. You are working in hermitcrab-mobius because you understand pscale natively — the blocks you produce will be used by a separate codebase (xstream-play) that currently does NOT use BSP walks but needs to.

### Step 1: Ground yourself in pscale

Fetch and read these if you haven't already:
- https://raw.githubusercontent.com/pscale-commons/pscale/main/pscale-touchstone.json
- https://raw.githubusercontent.com/pscale-commons/pscale/main/bsp.js

Also read the wake block in this repo: `blocks/wake.json` — it's an example of a functioning pscale agent block.

### Step 2: Understand what xstream-play needs

The game has three LLM agents per character:
- **Soft-LLM** (Haiku) — faces the player, conversation partner, knowledge-gated. Helps the player think about what to do. Never narrates.
- **Medium-LLM** (Haiku/Sonnet) — the narrator. Takes committed player intention + scene + accumulated events from other characters → produces personalised solid narrative + events skeleton + domino signals.
- **Hard-LLM** (Sonnet) — background admin. Reads world blocks (spatial, events, characters, rules) via BSP walks, produces a frame that Soft and Medium consume. Runs rarely.

Currently, the prompt templates for these agents are hardcoded JavaScript objects in `block-factory.ts`. That's wrong. They should be pscale blocks that BSP walks compose into context windows.

The game also needs world blocks:
- **Spatial** — geography as nested containment (floor 3, accumulation block)
- **Events** — what has happened (Form 2, living block that accumulates)
- **Characters** — who exists, where they are (mixed: NPCs authored, players dynamic)
- **Rules** — constraints, physics, game mechanics by location
- **Faces** — player/author/designer mode instructions

### Step 3: Design the blocks

Create these as pscale JSON blocks in `blocks/xstream/`:

1. **`medium-agent.json`** — The medium-LLM reads this as its own identity. BSP walk at `0.1` gives its role. `0.2` gives constraints. `0.3` gives output schema. `0.4` gives mode-specific instructions (the domino modes: auto/informed/silent should be different spindle addresses). When the kernel composes a prompt, it walks this block to extract the relevant sections.

2. **`soft-agent.json`** — Same pattern for the soft-LLM. Role, constraints, knowledge-gating rules, response style.

3. **`hard-agent.json`** — Same pattern for the hard-LLM. What it reads, what it produces, how it thinks (BSP interrogation, not free-form).

4. **`spatial-thornkeep.json`** — A small test world. Floor 3 (village/building/room). The Broken Coast, Thornkeep, The Salted Dog tavern with main room, back room, stairs up. Enough to test BSP walks for scene context.

5. **`rules-thornkeep.json`** — Basic rules for Thornkeep. Social norms, what's allowed where.

### Design principles

- Every underscore must be a **complete thought**, never a heading. Test: read it without its children — if meaningless, it's a heading.
- The agent blocks are **Form 1** (rendition blocks, floor 1). They describe themselves. They don't grow.
- The spatial block is **Form 1 with floor 3** (accumulation addressing: `111` = room scale, `110` = building, `100` = village).
- The events block is **Form 2** (living block that accumulates forward). Start with a few seed events.
- A spindle through any block should produce coherent, self-contextualising content at every level.
- The agent reading its own block should understand what it is, what it does, and how to behave — from the spindles alone.

### What the kernel will do with these blocks

```
// Instead of this (current, bad):
const prompt = block.prompt_template.role + block.prompt_template.constraints.join('\n')

// It should do this (target):
const role = bsp(mediumAgent, 0.1).nodes.map(n => n.text).join(' ')
const constraints = bsp(mediumAgent, 0.2, 'dir').subtree  // all constraint branches
const outputSchema = bsp(mediumAgent, 0.3).nodes.map(n => n.text).join(' ')
const modeInstructions = bsp(mediumAgent, 0.41) // 0.41 = auto, 0.42 = informed, 0.43 = silent
```

The number IS the query. The block IS the intelligence. The kernel is just a loop.

### Step 4: Write them

Save the blocks to `blocks/xstream/`. When you're done, I'll copy them into the xstream-play repo and start wiring BSP walks into the kernel.

### Reference

The repo https://github.com/happyseaurchin/xstream-play has:
- `CLAUDE.md` — project philosophy and current state
- `docs/STATUS.md` — what works and what's missing
- `docs/medium-llm-coordination-spec.md` — tested coordination spec
- `docs/cc-seed-spec-v3.md` — v3 build spec with earlier (non-pscale) agent block designs
- `docs/kernel-reference.py` — Python reference implementation

You can fetch these if helpful, but focus on the block design. The code will adapt to the blocks, not the other way around.
