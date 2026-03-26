# XStream Play — Project Status

## What Works (March 2026)

### Multiplayer narrative coordination
- Two+ players create/join games via 6-character codes
- Each player's browser runs its own kernel (JavaScript, no server)
- Kernels poll a Vercel Blob relay every 3 seconds
- Medium-LLM (Haiku) fires on player commit, produces:
  - **Solid**: personalised narrative in second person present
  - **Events**: factual, observable, deposited to outbox for peers
  - **Dominos**: signals targeting affected characters
- Peer kernels discover events and dominos via polling
- Domino cascades produce emergent narrative between characters
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
- Relay stores blocks with API key redacted
- 24h TTL on relay blobs (abandoned games auto-clean)
- play.onen.ai production deployment

---

## What's Missing (Priority Order)

### 1. Pscale blocks for prompts and agents
**Status**: Not started. Most important next step.

The medium prompt template is a plain JavaScript object in `block-factory.ts`. It should be a pscale block — the medium-LLM agent reading its own identity from a BSP-navigable structure. Same for soft-LLM.

**What this enables**: Designer face can edit agent behaviour by modifying block content. Different games can use different agent blocks. The kernel doesn't change.

**Reference**: See `docs/cc-seed-spec-v3.md` for the v3 agent block designs (soft.json, medium.json, hard.json).

### 2. Hard-LLM for frame building
**Status**: Not started in xstream-play. Existed in the parent repo (xstream, feature/block-agents branch) but used BSP partially.

The scene is currently a static text string chosen at game creation. Hard-LLM should:
- Read spatial block via BSP walk at character's coordinates
- Read events block for recent history
- Read characters block for who's nearby
- Produce a **frame** that Soft and Medium consume

**What this enables**: Characters move through spaces. The world has geography. Events are spatially/temporally located. Proximity matters.

### 3. World blocks as pscale JSON
**Status**: Thornkeep world blocks exist in the parent repo (`xstream/blocks/worlds/thornkeep/`). Not yet ported to xstream-play.

Spatial, events, characters, rules — all as BSP-navigable blocks. The scene text gets replaced by spatial spindles.

### 4. Designer face
**Status**: Not started. The toggle exists in UI concept but no editing capability.

Let players switch to designer mode and modify layer 2: prompt constraints, scene descriptions, rules, NPC behaviour. All through the same interface, writing to blocks.

### 5. B-loop convergence for simultaneous conflict
**Status**: Tested in Python (see `docs/medium-llm-coordination-spec.md`), not implemented in JavaScript kernel.

When two players commit simultaneously and their actions physically interact, the kernel should detect the conflict, run provisional passes, then resolve.

### 6. Rules and dice evaluation
**Status**: Not implemented. Designed in architecture doc.

Rules block defines constraints. Dice/NOMAD mechanics resolve uncertain outcomes between accumulation and medium call. Results go into context as established fact.

### 7. Character persistence
**Status**: Closing the tab loses everything. No save/resume.

Minimal version: download/upload block as JSON file. Better version: optional backup to player's own storage (GitHub gist, local file, etc).

---

## Architecture Lineage

This project was extracted from `happyseaurchin/xstream` (branch: `feature/block-agents`). Key decisions:

1. **Stripped Supabase entirely** — no server database, no auth dependency
2. **Browser-side LLM calls** — player provides API key, calls go direct to Anthropic
3. **Vercel Blob relay** — dumbest possible shared storage (PUT/GET JSON, nothing else)
4. **Kernel ported from Python reference** — `docs/kernel-reference.py` is the tested original
5. **Coordination tested across 5 scenarios** — see `docs/medium-llm-coordination-spec.md`

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
