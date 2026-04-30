# Handover — xstream beach client

**Date**: 2026-04-30
**Branch**: `feature/bsp-mcp-native`
**Latest commit**: `ae13f95` — *isPresenceMark: match underscore pattern*
**Live**: <https://xstream.onen.ai>
**Vercel project**: `xstream-play` (team `happyseaurchins-projects`); domain `xstream.onen.ai` is bound to this branch; `play.onen.ai` stays on `main` (legacy fantasy game).

> Read this file FIRST. It captures everything the previous session learned, so you don't repeat the same wrong turns.

---

## What this is

xstream as a bsp-mcp-native beach client. The user lands on a V/L/S surface (vapour, liquid, solid zones with draggable separators), identifies via a popover inside the floating `#` button, and engages with a federated beach (`https://happyseaurchin.com`) plus the bsp-mcp commons. **The substrate is the context engine**, not a content firehose; what the user sees is filtered by *who they are* (identity + face) and *where they are* (beach + address + frame).

The previous "xstream-play" was a multi-character RPG kernel. The game kernel is **gone**. What survives is the substrate (`bsp-client.ts`, `beach-kernel.ts`) and the original UI components (zones, separators, button).

---

## Architecture

### Substrate dispatch (per `bsp-client.ts`)

`bsp()` routes by `agent_id` prefix:
- `https://...` → federated beach (POST/GET to `<origin>/.well-known/pscale-beach`).
- `sed:`, `grain:`, bare → bsp-mcp Supabase commons (`pscale_blocks` table).

URL agent_ids land at the WellKnownAdapter on the bsp-mcp server side (Stage 3 + 4 of v2 protocol — confirmed live as of 2026-04-29). No "substrate toggle" UI — the prefix IS the dispatcher.

**Live verification**: see `read_network_requests` in any session — federated GETs return 200 with the beach block body; POSTs return `{"ok":true}`.

### Beach kernel (`beach-kernel.ts`)

Poll loop, every 4s:
1. Heartbeat presence at `current_beach:1.<digit>` (only if `agent_id` set).
2. Read presence at `current_beach:1`, filter by address prefix → live peers.
3. Read marks at `current_beach:1`, filter by address prefix → marks list.
4. Read frame disc at `current_beach:current_frame` if in-frame → entity rows.

`dropMark(text)` → POST to `<beach>/.well-known/pscale-beach` with `{block: 'beach', spindle: '1.<next>', content: { _: text, '1': agent_id, '2': address, '3': ts }}`.

`commitLiquid(text)` → same shape but at `frame:<scene>:<entity>.1` when in-frame.

### UI surface

| File | Role |
|---|---|
| `src/App.tsx` | Composition: header (face / address / frame / substrate tray / viewer / presence), three zones with separators, floating button, viewer drawer overlay |
| `src/components/xstream/SolidZone.tsx` | Top zone — user's contributions / canon they belong to |
| `src/components/xstream/LiquidZone.tsx` | Middle zone — pending commit + present peers; click commit dot on self card → bsp() write |
| `src/components/xstream/VapourZone.tsx` | Bottom zone — soft-LLM response + (future) peer vapour |
| `src/components/DraggableSeparator.tsx` | Resizable borders between zones |
| `src/components/xstream/ConstructionButton.tsx` | Floating `#` button — vapour input, settings menu (theme + identity panel) |
| `src/components/ViewerDrawer.tsx` | Slide-down overlay (👁) — marks + presence at address; faces other than character/observer are placeholders |
| `src/components/SubstrateTray.tsx` | Five buttons (Reach / Register / Publish keys / Verify rider / Create collective) — **stubs** |
| `src/lib/bsp-client.ts` | Whetstone-signature `bsp()`, presence helpers, shell helpers, ref resolver |
| `src/kernel/beach-kernel.ts` | Poll loop, drop-mark, commit-liquid |
| `src/kernel/beach-session.ts` | `BeachSession` shape |
| `src/kernel/block-store.ts` | Tiny in-memory store seeding the three agent JSONs (`medium-agent`, `soft-agent`, `hard-agent`) |
| `src/kernel/claude-direct.ts` | Browser → Anthropic API (current soft-LLM transport) |
| `blocks/xstream/{medium,soft,hard}-agent.json` | Beach-flavoured agent prompts; nested-underscore form with hidden directory at `_.1` populated at runtime with the user's beach URL |

### Identity model

- **Anonymous** = no handle. Reads work; writes are gated.
- **Registered** = handle (localStorage) + passphrase (sessionStorage). Substrate writes work.
- **+ API key** = sessionStorage; soft-LLM ⌘↵ works (Tier 2).

The shell at `(agent_id, "shell")` is auto-bootstrapped on first registered activation with four CADO faces (per `protocol-agent-shell.md`).

---

## Gotchas (do not relearn the hard way)

1. **Browser cache poisons federated GETs.** Reads to `/.well-known/pscale-beach` need `cache: 'no-store'` + a `?_t=<ts>` query cache-buster. Without those, the browser returns 304s and the kernel never sees new marks.
2. **Don't add `Cache-Control: no-cache` header** to GETs. It turns the request into a non-simple CORS request; the federated server's preflight doesn't allowlist that header → `TypeError: Failed to fetch`. The cache-buster + `cache: 'no-store'` are sufficient.
3. **Presence vs substantive marks.** Every mark `dropMark` writes carries the three structured fields (1=agent, 2=address, 3=timestamp). The presence filter must distinguish by *underscore pattern* (`/^\S+ @ \S+ — present at /`), not just "has all three fields".
4. **Drag handler vs input fields.** `ConstructionButton`'s `onMouseDown` for drag must exclude `input`, `label`, `textarea`, `button`, and any `[data-no-drag]` element — otherwise inputs in the settings popover become unfocusable.
5. **Vercel env vars are scoped per environment.** When you add `VITE_*` keys, tick **Production AND Preview** — branch deployments use Preview. Otherwise `getSupabase()` returns null and shell bootstrap fails on Preview.
6. **Vercel doesn't auto-rebuild on env var changes.** Push a no-op commit (`git commit --allow-empty …`) to trigger a fresh build.
7. **Vercel Domains panel is per-target.** "Branch domains" appear under their branch deployment, not the production deployment overview. `xstream.onen.ai` is bound to `feature/bsp-mcp-native`; `play.onen.ai` stays on production (`main`).

---

## What's wired vs stub

| Capability | Status |
|---|---|
| Federated read of `https://happyseaurchin.com/.well-known/pscale-beach` | ✅ live |
| Federated write (drop mark) | ✅ live; verified end-to-end |
| Presence heartbeat | ✅ |
| Identity (handle/passphrase/API key) in button settings | ✅ |
| Three-zone V/L/S with draggable separators | ✅ |
| Viewer drawer (👁) — character/observer faces | ✅ |
| Soft-LLM ⌘↵ — Tier 2 plain Claude API | ✅ |
| Soft-LLM with bsp-mcp tools | ❌ STUB — plain Claude, no tool-use, no substrate awareness, no face-gating |
| Substrate-tool tray (Register / Reach / Publish keys / Verify rider / Create collective) | ❌ STUB — dialogs capture inputs but only log; no `pscale_register` etc. wired |
| Viewer for author / designer faces | ❌ placeholder text |
| Frame synthesis daemon | not in client scope (runs on the frame owner's host per protocol-xstream-frame.md §7) |
| Live peer vapour (realtime channel) | ❌ not wired (4s poll only) |

---

## Recommended next session — order

### 1. Hook up bsp-mcp tool-use in the soft-LLM call (CADO-aware) — *the magic move*

Goal: when the user types in vapour and hits ⌘↵, the soft-LLM:
- Knows who they are (`agent_id`, current face).
- Knows where they are (beach, address, frame if any).
- Can call `bsp()` to read the beach (and other substrate primitives appropriate to their face) to answer situated questions like "what's here?" / "who's around?" / "what has weft been thinking about?".

Implementation:
- Extend `callClaude` (or write `callClaudeWithTools`) to accept Anthropic Messages API `tools` array; loop on `tool_use` blocks → execute via `bsp-client` → `tool_result` → continue.
- Tool definitions for `bsp`, `pscale_register`, `pscale_grain_reach`, `pscale_key_publish`, `pscale_verify_rider`, `pscale_create_collective` (JSON schemas matching whetstone).
- Face-conditional tool gating per whetstone:3.2 default matrix:
  - Character: bsp (read only), grain_reach
  - Author: bsp (read + write at edit_target), grain_reach, register
  - Designer: bsp (full), all primitives
  - Observer: bsp (read only), no primitives
- System prompt receives a small context block: `face: <c/a/d/o>`, `agent_id`, `beach`, `address`, `frame?`, plus the active face's persona text from the user's shell.

Estimated scope: ~200 LOC. Lands as one coherent commit. Substantial UX win: the soft-LLM stops being generic Claude and becomes a substrate-aware partner.

**Alternative**: use Anthropic Messages API's MCP connector (`mcp_servers` parameter, currently beta) to attach `https://pscale-mcp-server-production.up.railway.app/mcp/v2` directly. Less code, but depends on the beta connector. Path A (in-client tool-use) is more reliable today.

### 2. Wire substrate-tool tray to real calls

Replace the `onAct` log in `SubstrateTray` with actual `bsp-client` calls. `pscale_register` writes to a sed: collective; `pscale_grain_reach` writes a reach mark to a beach the partner watches; etc. The dialog inputs already capture the right fields; the wiring is plumbing.

### 3. Author / Designer face viewer content

When face = author, the viewer shows blocks the user is authoring (their `edit_target` block plus any blocks owned by them at the beach). When face = designer, it shows rule blocks, agent shells, skill packs in scope. Both use `bsp()` walks on the substrate.

### 4. Live peer vapour

Supabase realtime channel keyed by `frame:<scene>:entity:<n>` (or `beach:<url>:address:<addr>` outside a frame). Broadcasts keystroke deltas; receivers render in others' vapour rows in VapourZone. Per `protocol-xstream-frame.md` §3.1: vapour is out-of-substrate.

---

## How to drive the live tab from a session

The user has Claude-in-Chrome connected to this account; `https://xstream.onen.ai` is typically open in their MCP tab group.

- `mcp__Claude_in_Chrome__list_connected_browsers` → find their browser
- `mcp__Claude_in_Chrome__select_browser` → connect
- `mcp__Claude_in_Chrome__tabs_context_mcp` → list tabs
- `mcp__Claude_in_Chrome__javascript_tool` for direct probes (capture results in `window.__name`, then read back)
- `mcp__Claude_in_Chrome__read_network_requests` filtered by `happyseaurchin.com` to debug substrate I/O
- `mcp__Claude_in_Chrome__read_console_messages` filtered by `bsp federated|kernel|federated` for bsp-client logs

For deploys: `mcp__79741c3b-...__list_deployments` (project `prj_B5kbVU2hPpwhQ3UZqmwPFF7E5VwP`, team `team_iTERHQuAAemSTP39REAvULJr`).

**Push-to-rebuild flow**: commit + push → Vercel auto-deploys the branch in ~1–2 min → the bundle hash in `xstream.onen.ai/index.html` changes → reload the user's tab.

---

## Reference docs (bsp-mcp side)

- `https://github.com/pscale-commons/bsp-mcp-server/blob/main/docs/protocol-pscale-beach-v2.md`
- `https://github.com/pscale-commons/bsp-mcp-server/blob/main/docs/protocol-agent-shell.md`
- `https://github.com/pscale-commons/bsp-mcp-server/blob/main/docs/protocol-block-references.md`
- `https://github.com/pscale-commons/bsp-mcp-server/blob/main/docs/protocol-xstream-frame.md`
- `https://github.com/pscale-commons/bsp-mcp-server/blob/main/docs/presence-via-marks.md`
- Sunstone (teaches BSP by being walkable): in this repo's parent or fetch from pscale-commons.
- Whetstone (operational reference for `bsp()` signature + face/tier matrix): same.

---

## Working with David

David is a vibe-coder — architect and designer with deep theoretical work on coordination systems. Reflexive, imaginative, concurrent. He cares about *how it feels* — UX is design, not polish. The original V/L/S design (zones with separators, floating button as home of action, vapour input INSIDE the button at the bottom never obscured by the viewer) is non-negotiable; if you find yourself rebuilding it from scratch as a flat form, stop and ask. The substrate is the context engine; the surface is reflexive — what the user sees mirrors their engagement, filtered by who/where/how, not "everything, then filter down".

Default to action with verification (Claude-in-Chrome tab open, screenshot every meaningful change). Don't delete UI components when refactoring substrate — they're orthogonal. When the user feels frustrated, slow down and reflect; don't push more code into the void.

---

End of handover.
