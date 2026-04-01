# Session 02 Handover — Jump 4: Systemic Faces

**Branch:** `feature/hard-llm` at commit `b289503`
**Date:** 1 April 2026
**Tag:** `pre-jump4` marks rollback point at `96bc12d`

---

## What was done this session

### The systemic build — all 8 steps of Jump 4

Jump 4 enables three faces (character, author, designer) using the same mechanical loop with different agent block configurations. The uniform pattern:

```
vapor → liquid → [accumulate peer liquid at proximity scope] → commit → medium synthesises → output
```

What varies per face: which agent block drives the prompt, what address the player is "at", what the output writes to.

### Step 1: Mutable block store

Replaced static `block-registry.ts` (15 lines, 2 blocks) with `block-store.ts` (mutable, 12 blocks). All JSON blocks in `blocks/xstream/` seeded via `structuredClone` so edits don't mutate originals. All callers (`prompt.ts`, `soft-prompt.ts`, `harness.ts`) migrated from `blockRegistry[ref]` to `getBlock(ref)`. Agent blocks retrieved from store at call time — designer editing `medium-agent` at runtime changes what the next medium prompt walks.

### Step 2: Face state + UI selector

Face state (`character | author | designer`) in App.tsx with localStorage persistence. `data-face` attribute on root div drives CSS theming (amber/blue/pink). Select dropdown in header for switching. `edit_address` and `edit_target` optional fields on Block type for author/designer attention.

### Step 3: Author agent block + prompt routing

`author-agent.json` — floor 2 block, same structural pattern as medium-agent. Star ref to `spatial-thornkeep`. 6 rules for authoring, produce spec asks for `{edit, summary, preview}` JSON. `buildAuthorPrompt()` walks author-agent via BSP, shows target block content at edit address. Kernel routes author commits through `callAuthorMedium` (Sonnet). `applyBlockEdit()` in block-store with snapshot rollback.

### Step 4: Designer agent block + prompt routing

`designer-agent.json` with 4 star refs (medium-agent, rules-thornkeep, soft-agent, author-agent) — sees the full system. `buildDesignerPrompt()` shows all star-referenced system blocks. `DesignerResult` includes rationale field. Same `applyBlockEdit` path as author.

### Step 5: Proximity-scoped peer liquid

Peer liquid filtering generalised per face. Character: exact `spatial_address` match (same room). Author: same `edit_target` + shared address prefix (spindle overlap). Designer: same `edit_target`. Author prompt also uses prefix matching for nearby author intentions.

### Step 6: Auto/manual/informed commit modes

`face_commit_mode` on Block with per-face settings (default: manual). Commit mode toggle in header — character face shows domino mode, author/designer shows commit mode. Modes cycle manual → informed → auto.

### Step 7: Hard reconciler

`hard-agent.json` redesigned as reconciler (was perception frame). Star refs to spatial-thornkeep + rules-thornkeep. Produces BlockEdits that promote lasting events into permanent block content. Kernel cycle step 4: Hard triggers when event density at current address exceeds threshold (5 events) OR periodic fallback (60s). Calls Sonnet, applies BlockEdit if warranted.

### Step 8: Block navigator shelf

Minimal shelf bar between header and zones, visible only in author/designer face. Shows `edit_target` (dropdown of all blocks in store) and `edit_address` (text input for BSP address). Author/designer can pick any block and any address.

---

## BSP CLI navigator

`test-bsp.mjs` — walks any block from the command line the way the triad does. All modes: spindle, ring, dir, star, point, disc. Used extensively during development to verify block structure before writing code.

```bash
node test-bsp.mjs                              # list all blocks
node test-bsp.mjs spatial-thornkeep 111         # spindle to main room
node test-bsp.mjs spatial-thornkeep 111 '*'     # star (hidden dirs)
node test-bsp.mjs medium-agent 0 '*'            # agent star refs
node test-bsp.mjs author-agent 0.2 dir          # produce section
```

---

## Current block inventory

```
blocks/xstream/
  medium-agent.json       # 1 star ref (spatial). 8 rules, produce, format.
  soft-agent.json         # 1 star ref (spatial). Role/gating/style/format.
  hard-agent.json         # 2 star refs (spatial, rules). Reconciler. Event→BlockEdit.
  author-agent.json       # 1 star ref (spatial). 6 rules. Produces BlockEdits.
  designer-agent.json     # 4 star refs (medium, rules, soft, author). Systemic edits.
  spatial-thornkeep.json  # World spatial. Hidden dirs at 111 (S×I, S×T, rules).
  rules-thornkeep.json    # Spatial-mirrored rules. Hidden dir at root (universal).
  harness.json            # Output constraints P-4 through P0.
  character-essa.json     # NPC. 3 branches (appearance, identity, purpose).
  character-harren.json   # NPC.
  character-kael.json     # NPC.
  character-template.json # Template for player characters.
```

---

## Known issues and crude defaults

1. **edit_target defaults are hardcoded in App.tsx** — author defaults to `spatial-thornkeep`, designer defaults to `rules-thornkeep`. The shelf addresses this by letting the user pick, but the initial value is crude. Eventually the agent block's star refs should inform the default.

2. **LLM edit precision is untested** — the author/designer mediums must produce valid BlockEdits (correct block name, valid address, appropriate operation). Sonnet minimum for this. The few-shot examples in the agent blocks may need tuning after live testing.

3. **applyBlockEdit is simple** — walks to address, modifies key. Does not validate pscale structure after edit. Does not check star ref integrity. Snapshot rollback catches crashes but not semantic errors.

4. **Hard reconciler is coarse** — event density threshold (5) and fallback interval (60s) are arbitrary starting points. The spec suggests trigger-based cascades eventually.

5. **No persistence** — block edits live in memory only. Closing the browser loses all author/designer work. Relay persistence is future work.

6. **Character blocks still not wired** — character-essa.json etc. are in the store but no agent block references them via star. Soft/medium don't walk character blocks for NPC descriptions.

---

## Architectural observation: star as semantic HTTP

The block space is a semantic internet. Star references are the protocol:

| Web | Pscale |
|-----|--------|
| Domain name | Block name |
| DNS resolution | `getBlock()` |
| URL path | BSP address |
| HTTP GET | Star walk |
| Hyperlink | Star reference in hidden directory |
| Web server | Block (sovereign JSON) |
| Browser | Kernel (walker) |

The difference: star preserves navigational continuity across the boundary. HTTP fetches opaque bytes. Star fetches navigable structure — the walk continues seamlessly into the referenced block. The spindle grows. The context chain doesn't restart.

`getBlock()` is currently local resolution (in-memory map). The spec's layer 0 trajectory: `getBlock()` becomes remote resolution — block names resolve to wherever the authoritative block lives. Another player's store, a shared registry, a URL. The blocks are sovereign. The star refs are the connections. Hard manages resolution. This is the path to SAND.

---

## The test

From the Jump 4 spec, after steps 1-4:

1. Start as Kael (character). Play in the Salted Dog.
2. Switch to author. Type "There's a loose flagstone near the hearth hiding old letters." Commit.
3. Switch back to character. "I search the floor." → narrative discovers the letters.

After step 7:

4. As character, "I pour water on the fire." → event filed.
5. Wait for Hard reconciler threshold. Hard runs, updates hearth description.
6. New character joins. Their first scene includes the cold hearth.

**Status: structurally complete, not yet live-tested.**
