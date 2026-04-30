# Session 03 Handover — Triad Completion + Convergence Protocol

**Branch:** `main` at commit `74d839f`
**Date:** 1 April 2026
**Previous session:** `HANDOVER-SESSION-02.md` (Jump 4: Systemic Faces)

---

## What was done this session

### 1. Soft triad across faces (commit `195769d`)

The soft-LLM now receives face-appropriate context for all three faces:

- **Character soft:** spatial scene, character state, knowledge-gated (unchanged)
- **Author soft:** block content at edit address, spindle/dir/ring/star walks, **nearby author activity from peers**
- **Designer soft:** block content, star refs, **reverse star lookup** (which blocks reference the edit target)

`buildSoftPrompt` now takes `peerBlocks` parameter. Kernel exposes `lastPeerBlocks` getter. App.tsx passes peers, fixed stale dependency array, fixed hardcoded face in error branch.

### 2. Persistence — localStorage (commits `9c2e225`, `8a572d4`)

**First version** dumped all 16 blocks as one blob on every commit. David pointed out this was crude — two tabs would overwrite each other.

**Second version** (current): per-block localStorage keys. Each pscale block gets its own key (`xstream:game:{code}:block:{name}`). Kernel block saves separately (`xstream:game:{code}:kernel:{charId}`). Block store has write-through: `applyBlockEdit` and `setBlock` save just the changed block. Two tabs editing different blocks can't collide.

**UI additions:**
- Setup screen: Resume saved games, Import save file, Clear all saves
- During play: 💾 Export save button (JSON download), 📜 Story export (text)

### 3. Hard triad across faces (commit `298bf17`)

Two new agent blocks:
- `hard-author-agent.json` — post-edit consistency check (are siblings contradictory?)
- `hard-designer-agent.json` — post-edit blast radius report (which blocks are affected?)

Two new prompt builders: `buildAuthorHardPrompt`, `buildDesignerHardPrompt`. Kernel step 4 is now face-aware: author/designer hard fires after their commits; character hard unchanged (event density threshold).

The triad is structurally complete across all three faces:

| | Soft | Medium | Hard |
|---|---|---|---|
| Character | Inner voice | Narrative + events | Event → block promotion |
| Author | Editorial advisor | Block edits | Consistency check |
| Designer | Systems analyst | Rule/agent edits | Blast radius report |

### 4. Convergence protocol block (commits `2b24f82`, `74d839f`)

The defining work of this session. A pscale JSON block that describes how mediums negotiate reality:

```
convergence.json — 5 branches:
  0.1  Provisional loop (commits produce drafts, not solids)
  0.2  Convergence criteria (when provisionals solidify)
  0.3  Divergence handling (block versions differ — this is normal)
  0.4  Reconciliation (hard facilitates, players decide, three paths)
  0.5  Ecology (variation is the medium, narrative coherence > textual exactitude)
```

Star-wired from `medium-agent`. The medium now walks the convergence protocol alongside the spatial block. The behaviour change comes from the block, not from TypeScript.

### 5. Systemic kernel (commit `74d839f`)

David's `systemic-kernel.json` — a pscale block for recognising, evaluating, and composing systems. 6 branches covering the generative distinction, emergent hierarchy, conformal self-similarity, evaluation method, comparison method, and the game as systemic test. Star-wired from convergence.

**Star chain:**
```
medium-agent → spatial-thornkeep (where)
             → convergence (how to negotiate reality)
               → systemic-kernel (why systems work this way)
               → medium-agent (self-reference)
               → hard-agent (the janitor)
```

18 blocks in the store. The convergence block is signed: Claude Opus 4.6 (1M context), session 3.

---

## What the session discovered

The previous session's handover said: "spend less time on the protocol and more time on what the page shows." This session went deeper — the convergence block is a protocol, but it's also the content that the medium reads. The distinction between infrastructure and experience collapsed: the protocol IS what the medium inhabits when it produces narrative.

The key insight: solid isn't "what one medium produced." Solid is "what multiple mediums converged on." The current implementation still produces immediate solids. The convergence block describes what the implementation should become — provisional loop, ACK-based convergence, narrative reconciliation of divergence. The design is in the block, ready for implementation.

The persistence conversation revealed something about how David works: he tests by experience, not by mechanism. "I still don't understand" didn't mean "explain the code differently" — it meant "I can't see myself using this." The per-block localStorage rewrite came from hearing that distinction.

---

## Current state

### Files changed this session
- `src/kernel/kernel.ts` — lastPeerBlocks getter, face-aware hard, per-block persistence, setCurrentGame on start
- `src/kernel/soft-prompt.ts` — peerBlocks parameter, nearby authors, reverse star lookup
- `src/kernel/prompt.ts` — buildAuthorHardPrompt, buildDesignerHardPrompt
- `src/kernel/persistence.ts` — NEW: per-block save/load/export/import
- `src/kernel/block-store.ts` — hydrateFromSaved, write-through on applyBlockEdit/setBlock, 18 blocks registered
- `src/App.tsx` — resume/import handlers, export button, fixed soft callsite deps
- `src/components/SetupScreen.tsx` — resume, import, clear saves UI
- `blocks/xstream/hard-author-agent.json` — NEW
- `blocks/xstream/hard-designer-agent.json` — NEW
- `blocks/xstream/convergence.json` — NEW (the session's defining artefact)
- `blocks/xstream/systemic-kernel.json` — NEW (David's systems evaluation block)
- `blocks/xstream/medium-agent.json` — star ref to convergence added

### 18 blocks in the store
Agent blocks: medium-agent, soft-agent, soft-author-agent, soft-designer-agent, hard-agent, hard-author-agent, hard-designer-agent, author-agent, designer-agent
World blocks: spatial-thornkeep, rules-thornkeep, harness
Character blocks: character-essa, character-harren, character-kael, character-template
Protocol blocks: convergence, systemic-kernel

### What works
- Soft triad across all three faces with peer awareness
- Hard triad across all three faces with face-specific triggers
- Per-block localStorage persistence (no cross-tab collision)
- Resume, import, export, clear saves
- The convergence block is in the store and star-wired from medium-agent

### What doesn't work yet
- The convergence protocol is **described but not implemented**. Commits still produce immediate solids, not provisionals. The provisional loop, ACK signalling, and convergence detection are design (in the block), not code (in the kernel).
- Block edit sync between players is still absent. Author edits are local-only.
- Character blocks (Essa, Harren, Kael) are still not star-wired from any agent block.
- Filmstrip API still returns 500 (known, non-blocking).

---

## Priorities for next session

### Priority 1: Cloud storage (optional Supabase service)
David's proposal: a thin wrapper so players can save to Supabase instead of (or alongside) localStorage. Same export/import format, just stored in the cloud. Players keep their API key in their browser. The service is optional — localStorage remains the default. This enables cross-device play and easier sharing between players.

**Design principle:** It's just like download/upload, but the destination is Supabase instead of the filesystem. No new abstractions. The existing `exportGameState`/`importGameState` format is the wire format.

**Supabase considerations:** The `relay_blocks` table already exists for live coordination. Cloud saves would be a separate table — `saved_games` or similar — keyed by player identity (if we add auth) or by a player-generated save code (if we don't).

### Priority 2: Implement the provisional loop
The convergence block describes it. The kernel needs to produce provisionals instead of immediate solids, circulate them, detect convergence via ACK, and solidify. Single-player should degenerate to immediate solid (one cycle, no peers, done). The block at `convergence 0.1` is the spec.

### Priority 3: Wire character blocks
character-essa.json, character-harren.json, character-kael.json are in the store but no agent block references them. The medium and soft should walk character descriptions for NPCs present at the spatial address.

### Priority 4: Layer 2 articulation
The convergence and systemic-kernel blocks are the foundation. The agent blocks need richer language — the difference between operator instructions ("produce solid + events") and agent-inhabitable protocols ("negotiate toward convergence through provisional revision"). This is block editing, not code.

---

## For the next Claude Code session

Read `CLAUDE.md` first. Then this handover. Then walk the convergence block:

```bash
node test-bsp.mjs convergence 0.1    # provisional loop
node test-bsp.mjs convergence 0.43   # three resolution paths
node test-bsp.mjs convergence 0.5    # ecology
node test-bsp.mjs medium-agent 0 '*' # see the star chain
```

The convergence block is not instructions to follow. It is a protocol to inhabit. The difference matters.
