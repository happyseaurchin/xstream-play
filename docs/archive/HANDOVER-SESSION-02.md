# Session 02 Handover — Jump 4: Systemic Faces

**Branch:** `feature/hard-llm` at commit `7cb7da8`
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

**Status: LIVE-TESTED. Author and designer commits fire and produce output. See post-test notes below.**

---

## Post-test feedback and fixes (same session)

David tested on the deployed preview. Author and designer commits both fired successfully. Key findings:

### What worked
- Face selector switches correctly
- Author commit fires Sonnet, produces BlockEdit, returns summary in solid zone
- Designer commit fires, produces rule change
- The shelf renders with block dropdown and address input
- Character narrative continues to work as before

### What was wrong (and fixed)
1. **Soft was face-blind** — always answered as character's inner voice, even in author/designer mode. Fixed: created `soft-author-agent.json` (editing assistant that explains block structure and suggests edits) and `soft-designer-agent.json` (systems analyst that traces rule implications). `buildSoftPrompt` now accepts face parameter and routes to the right agent block.

2. **Solid zone was shared across faces** — author edit summaries mixed with character narrative. Fixed: three separate state arrays (`characterSolids`, `authorSolids`, `designerSolids`). Switching face shows only that face's output. `onSolid` callback reads `kernel.face` to route to correct array.

3. **Temporal dead zone crash** — `face` was used before declaration in component body. Moved face/theme state above solidBlocks.

### What's still wrong (not yet fixed — next session)
1. **No visibility of actual block changes** — author sees "[author] Added a mysterious stranger" but not the actual content that was added. Author solid zone should show the block content at edit address, not just a summary.

2. **Shelf is cryptic** — block names like `spatial-thornkeep` and addresses like `111` mean nothing without context. Need preview of what's at the address, or at minimum labels.

3. **No dashboard/drawer** — the cogwheel settings infrastructure exists in `AppHeader` and `DirectoryDrawer` but isn't wired. David expected a slide-down panel: character sheet for character, world navigator for author, rules overview for designer.

4. **Can't verify designer changes took effect** — designer said it added a d10 dice roll but no way to check if it actually modified the block. Need a way to inspect block state (filmstrip, log viewer, or block inspector).

5. **Observer/director face** — David noted a fourth face is needed: someone who witnesses and synthesizes across character perspectives without producing. Beyond current scope but follows the same pattern (add a JSON block, add routing).

### Current block inventory (14 blocks)

```
blocks/xstream/
  medium-agent.json         # Character narrative. 1 star ref (spatial).
  soft-agent.json           # Character inner voice. 1 star ref (spatial).
  soft-author-agent.json    # Author editing assistant. 1 star ref (spatial).
  soft-designer-agent.json  # Designer systems analyst. 2 star refs (rules, medium).
  hard-agent.json           # Reconciler. 2 star refs (spatial, rules).
  author-agent.json         # Author editing. 1 star ref (spatial). Produces BlockEdits.
  designer-agent.json       # Designer editing. 4 star refs (all agents + rules).
  spatial-thornkeep.json    # World spatial block.
  rules-thornkeep.json      # World rules block.
  harness.json              # Output constraints P-4 through P0.
  character-essa.json       # NPC.
  character-harren.json     # NPC.
  character-kael.json       # NPC.
  character-template.json   # Template.
```

---

## What the next session should do

### Priority 1: Author solid = block content
When in author face, the solid zone should show the actual block content at the edit address — what a spindle walk returns, what the dir shows. The summary line from the author-medium is useful but insufficient. The author needs to SEE the world they're editing.

### Priority 2: Meaningful shelf
The shelf should show a preview of what's at the current address. When you change the address, you see the content there. Labels for common addresses (111 = "Main room of the Salted Dog"). This is the author's viewport.

### Priority 3: Wire the dashboard
`DirectoryDrawer` and `AppHeader` settings toggle exist. Wire them: character sheet, world tree for author, rules tree for designer. The cogwheel button is already in the component library.

### Priority 4: Block inspector / verification
After an author or designer edit, show what changed. Before/after diff, or at minimum a "view block" action that shows current content. This is essential for designer trust — "did my rule change actually land?"

### Priority 5: Character blocks via star refs
character-essa.json etc. are in the store but still not wired. Medium and soft don't walk them for NPC descriptions. Wire via star refs at spatial addresses — the S×I knowledge overlay should reference character blocks for NPCs at that location.
