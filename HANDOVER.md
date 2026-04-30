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

### bsp-mcp ≠ pscale-mcp — discipline check

The pscale-mcp era shipped ~25 categorised tools (passport_publish, inbox_send, beach_mark, pool_join, …). **bsp-mcp collapses that surface to six primitives**, and that's it:

1. `bsp()` — the geometric primitive (read/write at any spindle, any pscale_attention, any block). Whetstone signature: `bsp(agent_id, block, spindle, pscale_attention, content?, face?, tier?, secret?, gray?)`.
2. `pscale_create_collective` — instantiate a sed: collective.
3. `pscale_register` — claim a position in a sed: collective.
4. `pscale_grain_reach` — propose a bilateral grain.
5. `pscale_key_publish` — publish ed25519/x25519 keys to your passport.
6. `pscale_verify_rider` — verify a rider's signature chain.

(Names retain the `pscale_` prefix per whetstone:5 — *"carry over unchanged in name and semantics"* — but they are bsp-mcp primitives, not pscale-mcp legacy.)

**Everything else is a convention**, not a tool:
- Passport — a block at `(agent_id, "passport")` with a conventional shape; read/written via `bsp()`.
- Inbox — replaced. There is no inbox primitive. Cold contact = a structured mark on a beach the recipient watches.
- Beach mark — a `bsp()` ring write at `1.<n>` of the beach block.
- Pool / liquid pool — a `bsp()` ring write at `2.<N>.<n>`.
- GRIT — a daemon script that polls a pool via `bsp()` and writes a synthesis envelope via `bsp()`. No primitive.
- Presence — a structured mark with three required tags (`1=agent_id, 2=address, 3=ts`); read-side staleness filter.

**Implication for tool-use**: when you expose tools to the LLM, you expose **these six primitives plus nothing**. The conventions are taught in the *system prompt* via context (the user's shell, current beach state, current frame disc) — they are not additional tools. If you find yourself listing `pscale_passport_publish` or `pscale_pool_send` as tools, stop — those are pscale-mcp legacy names, not bsp-mcp. Use `bsp()` to read/write the underlying block at the conventional shape.

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
- Can call the six bsp-mcp primitives — appropriate to their face — to answer situated questions like "what's here?" / "who's around?" / "what has weft been thinking about?".

**Tools to expose**: exactly the six bsp-mcp primitives listed in §"What this is". No more, no less. Conventions (passport / pool / inbox-replacement / beach-mark) are taught via *context*, not as additional tools — the LLM uses `bsp()` to read/write at the conventional shape.

**Where the gates come from — read them, don't hardcode**:
- The active face is `shell:1.<digit>` where digit ∈ {1=character, 2=author, 3=designer, 4=observer}.
- Knowledge gates are `shell:1.<digit>.2` (read scope).
- Commit gates are `shell:1.<digit>.3` (write scope).
- The whetstone:3.2 default face/tier matrix is **fallback only**, applied when the shell doesn't specify. The shell is the source of truth — which means the user can edit gating from the Designer face. That's the whole point.

**Where the system-prompt context slots come from — read the block, don't reinvent**:
- The soft-agent block at `blocks/xstream/soft-agent.json` already names the context slots at branch 4: `4.1` shell, `4.2` frame from hard, `4.3` solid history, `4.4` user message.
- The work is filling those named slots via `bsp()` reads. Not new design — discipline.

**Implementation path**:
- Extend `callClaude` (or write `callClaudeWithTools`) to accept Anthropic Messages API `tools` array; loop on `tool_use` blocks → execute via `bsp-client` → `tool_result` → continue.
- Tool schemas match whetstone:1 (bsp signature) and the five non-geometric primitives.
- On each soft-LLM call: read `shell:1.<active digit>` for persona + gates; gate the tools array accordingly; fill the context slots from the soft-agent block via `bsp()` reads.

Estimated scope: ~200 LOC. Lands as one coherent commit. Substantial UX win: the soft-LLM stops being generic Claude and becomes a substrate-aware partner.

**Spike before coding**: try Anthropic Messages API's MCP connector (`mcp_servers` parameter, beta) attaching `https://pscale-mcp-server-production.up.railway.app/mcp/v2` (the bsp-mcp deployment — name lags). If it Just Works, the in-client tool loop collapses to system-prompt + face-gating only. 30 minutes. If the connector doesn't accept the URL or face-gating gets ugly, fall back to the in-client loop above.

### 2. Wire substrate-tool tray to real calls

Replace the `onAct` log in `SubstrateTray` with calls to the five non-geometric bsp-mcp primitives:

| Tray button | Primitive |
|---|---|
| Reach | `pscale_grain_reach` |
| Register | `pscale_register` |
| Publish keys | `pscale_key_publish` |
| Verify rider | `pscale_verify_rider` |
| Create collective | `pscale_create_collective` |

The dialog inputs already capture the right fields; the wiring is plumbing. (And no, "publish passport" is not a tray button — it's a `bsp()` write at `(agent_id, "passport")`. If the user wants a UI affordance for it, that's a *block-edit* surface, not a primitive.)

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

Specs (markdown):
- `https://github.com/pscale-commons/bsp-mcp-server/blob/main/docs/protocol-pscale-beach-v2.md`
- `https://github.com/pscale-commons/bsp-mcp-server/blob/main/docs/protocol-agent-shell.md`
- `https://github.com/pscale-commons/bsp-mcp-server/blob/main/docs/protocol-block-references.md`
- `https://github.com/pscale-commons/bsp-mcp-server/blob/main/docs/protocol-xstream-frame.md`
- `https://github.com/pscale-commons/bsp-mcp-server/blob/main/docs/presence-via-marks.md`

Self-teaching pscale blocks (these ARE pscale blocks; walk them with `bsp()` to learn):
- **Sunstone** — teaches BSP by being navigable through BSP. Eight branches (geometry / function / access / substrate / composition / commons / reflexive / voicing). Reading sunstone is how the LLM internalises the substrate. Source: `pscale-commons/pscale` repo or attached to a session as `sunstone.json`.
- **Whetstone** — operational reference for the `bsp()` primitive: signature, the 7-case selection-shape derivation, modifier composition (face / tier / secret / gray), the storage-adapter interface, and the translation map from pscale-mcp legacy → bsp-mcp. The whetstone:3.2 default face/tier matrix is the *fallback* for face-gating when the user's shell doesn't specify. Source: same. (URL lookup may return 404 on a `.md` extension — these are JSON blocks.)

Whetstone:5 lists the bsp-mcp primitives that *carry over from pscale-mcp unchanged in name and semantics*:
`pscale_create_collective`, `pscale_register`, `pscale_grain_reach`, `pscale_lock_block`, `pscale_evolution`, `pscale_key_publish`, `pscale_verify_rider`.

For the xstream client, the practically-relevant subset is the five we expose in the substrate tray + tool-use: `register`, `grain_reach`, `key_publish`, `verify_rider`, `create_collective`. Plus `bsp()` itself.

---

## Working with David

David is a vibe-coder — architect and designer with deep theoretical work on coordination systems. Reflexive, imaginative, concurrent. He cares about *how it feels* — UX is design, not polish. The original V/L/S design (zones with separators, floating button as home of action, vapour input INSIDE the button at the bottom never obscured by the viewer) is non-negotiable; if you find yourself rebuilding it from scratch as a flat form, stop and ask. The substrate is the context engine; the surface is reflexive — what the user sees mirrors their engagement, filtered by who/where/how, not "everything, then filter down".

Default to action with verification (Claude-in-Chrome tab open, screenshot every meaningful change). Don't delete UI components when refactoring substrate — they're orthogonal. When the user feels frustrated, slow down and reflect; don't push more code into the void.

---

End of handover.
