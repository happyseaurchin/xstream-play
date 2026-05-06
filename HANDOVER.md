# Handover — xstream beach client

**Date**: 2026-04-30 (updated end of session)
**Branch**: `feature/bsp-mcp-native`
**Latest commit**: `2691264` — *Tier 3 — watched-beach inbox*
**Live**: <https://xstream.onen.ai>
**Vercel project**: `xstream-play` (team `happyseaurchins-projects`); domain `xstream.onen.ai` is bound to this branch; `play.onen.ai` stays on `main` (legacy fantasy game).

> Read this file FIRST. It captures everything the previous session learned, so you don't repeat the same wrong turns.

---

## What landed in this session (2026-04-30)

The session delivered four coherent tiers on top of the previously-substrate-aware base. Test plan at the end of this section.

### Magic move (kernel) — `ad92903 → cb29f80`
The soft-LLM is no longer generic Claude. ⌘↵ runs an in-client tool-use loop where Claude holds the **six bsp-mcp primitives** as tools and walks the federated commons to compose its own context, face-gated from the live shell.

- `src/kernel/claude-tools.ts` — BSP_TOOLS (6 schemas), executeTool, composeContext (fills soft-agent branch 4 named slots from kernel state), buildSoftSystemPrompt (walks soft-agent via local kernel/bsp walker), callClaudeWithTools (Messages-API loop, dispatches tool_use to executor, feeds tool_result back, terminates on end_turn or max-turns=8).
- `src/kernel/claude-direct.ts` — generalised messagesApi(apiKey, body) wrapper, kept callClaude for backward compat.
- `App.tsx handleQuery` passes session, shell, face, marks, presence, frame to the loop. onToolCall surfaces every dispatch into the kernel log.
- **Verified live on production**: end-to-end tool loop with real LLM round-trips, accurate substrate references, 1–3-sentence soft-agent discipline.

Two prompt-sharpens during verification (live debugging caught LLM walking spindle="" and seeing only the root underscore):
- Explicit walking discipline + concrete recipes (marks: `bsp(spindle="1", pscale_attention=-2)` for dir).
- Always include `raw` in bsp read responses so the LLM can recover from a wrong-shape call.

Beta connector spike (`callClaudeViaMcpConnector`, behind `?mcp=connector`): proves Anthropic's `mcp_servers` parameter dispatches against `bsp.hermitcrab.me/mcp/v1` server-side. Transport works; bsp-mcp server's URL-federation routing for connector-mode is the gap (the in-client loop doesn't have this gap because it routes via xstream's own bsp-client). Default stays in-client.

### Tier 1.1 — Substrate primitives via MCP-over-HTTP — `f493147`
Reframed per user feedback: the substrate tray was the wrong shape. The five buttons are USER-FACING ACTIONS, not raw protocol primitives, and they belong on the input panel.

- `src/lib/mcp-client.ts` (new) — minimal MCP-over-HTTP client. Streamable-HTTP transport. CORS open (verified). Initialize → cache mcp-session-id → tools/call POSTs include the header. JSON + SSE response framings handled. 404/Unknown-session triggers one-shot reset+retry.
- `src/lib/bsp-client.ts` — pscaleRegister, pscaleGrainReach, pscaleKeyPublish, pscaleCreateCollective, pscaleVerifyRider — wrap mcpCallTool with the exact tool signatures probed from the live server.
- Header `SubstrateTray` removed (the row of emoji icons was visually ugly and conflated user actions with protocol primitives).
- `ConstructionButton` input panel now has a vertical lucide-icon column on the right: 📍 mark, 🪪 passport, 👤+ register, 🤝 engage, 🔑 keys. Submit (→) anchors the bottom.
- Identity-gated visually: anonymous users see only `mark` enabled; the rest are dim.
- Click an action → injects a template prefix into the textarea + focuses the cursor at the end.
- `App.tsx handleSubmit` — verb-prefix parser routes:
  - `passport: <description>` → bsp() write at (handle, "passport")
  - `register sed:<col> <decl>` → pscale_register
  - `engage <agent_id> <desc> | <my side>` → pscale_grain_reach
  - `keys` → pscale_key_publish
  - (anything else) → drop mark / liquid commit
- LLM tool descriptions in claude-tools.ts now reflect the live signatures (was guessed before).
- Same MCP backend serves both user buttons AND LLM tool calls.

### Tier 1.2 — Live peer vapour over Supabase Realtime — `df784f5`
Vapour is the imaginative-canvas tier per protocol-xstream-frame.md §3.1 — humans typing toward each other in real time, never persisted to substrate.

- `src/lib/realtime.ts` (new) — `joinVapourChannel({ scope, agent_id, face, onPeer })` wraps Supabase Realtime. `deriveScope({ beach, address, frame, entity_position })` keys the channel.
- Channel naming: `vapour:<beach>:addr:<address>` beachcombing, `vapour:<beach>:frame:<scene>:entity:<n>` in-frame.
- Self-echo guard at both transport (broadcast `self: false`) and receive layer (agent_id match).
- App.tsx — peerVapour state keyed by peer agent_id. Channel re-joins on (handle, beach, address, frame, entity) changes; face is *not* a scope axis. 80 ms debounced broadcast on vapour change. 12 s staleness window — peers fade when they stop typing.
- Anonymous users receive but don't broadcast.
- Non-Supabase deployments fall back gracefully (null channel, no crash).
- **Verified locally end-to-end**: real `POST .../realtime/v1/api/broadcast → 202`, OPTIONS preflight 200.

### Tier 2 — Designer-face shell editor + Author-face viewer — `dbfba8d`
The reflexive move. Designer face is no longer a placeholder — it's a focused block editor for the user's own `shell:1.<digit>` faces.

- ViewerDrawer `FaceDesigner` — 4 cards (one per CADO face), each with editable label / default address / knowledge_gates / commit_gates / persona. Save → `bsp({ agent_id, block: "shell", spindle: "1.<digit>", content: {_, 1, 2, 3, 4}, secret })`. After save: readShell() + onShellSaved bubbles up so face gates take effect on the next soft-LLM call without reload.
- `FaceAuthor` — passport card (with the bsp() signature shown verbatim), block manifest list (shell:3), watched beaches list (shell:2) with current beach highlighted.
- ViewerDrawer now takes `agentId, secret, shell, onShellSaved` props.

### Tier 3 — Watched-beach inbox / cold contact — `2691264`
The inbox-replacement layer. shell:2 holds the user's watched beaches; the kernel scans them every ~20 s and surfaces marks whose underscore mentions the user's agent_id.

- `BeachKernel.setWatchedBeaches(beaches)` — caller pushes shell:2 in. Excludes current_beach.
- `scanInbox()` runs every 5th cycle. For each watched beach: read beach:1 ring → filter out presence + own marks → keep marks whose text/address contains `<my_agent_id>` or `@<my_agent_id>`. Sorted newest first via `onInbox(items)`.
- New header indicator: 📬N badge next to 👁 (only when identified). Click toggles `InboxDrawer`.
- `src/components/InboxDrawer.tsx` (new) — slide-down overlay listing tagged marks. Each is a click-to-navigate button — tapping jumps active beach + address to the mark's location. Empty-state hint points to Designer face for editing shell:2.

---

## Test plan for tomorrow

The session shipped fast and pushed straight to production after each tier. Some live verifications were deferred (passphrase + per-call consent for substrate writes; two-tab vapour reception). Recommended order:

1. **Smoke test** — open <https://xstream.onen.ai>, identify (button → Identity → handle + passphrase + API key already cached), confirm V/L/S renders, presence count is sane.
2. **Magic move (re-verify)** — type a vapour question like "what's at this address?" and ⌘↵. Watch tool-call summary in the response footer (`(N tool call · M turns)`). Response should reference real substrate state.
3. **Action column (mark)** — already verified. Drop a substantive mark, confirm it appears in solid + on the federated beach via direct fetch if you want.
4. **Action column (passport)** — click 🪪, fill in a description after the `passport: ` prefix, ⇧↵. Verify by reading <https://piqxyfmzzywxzqkzmpmm.supabase.co> (or just walking `bsp(agent_id="happyseaurchin", block="passport")` via the soft-LLM).
5. **Action column (register)** — careful: positions are permanent. Use a test sed: like `register sed:test-2026-04-30 first registration in xstream`. Confirm the mcp call returns a position.
6. **Action column (keys)** — `keys` + ⇧↵. Server derives Argon2id keypair and publishes public halves to passport:9. Verify by walking passport.
7. **Action column (engage)** — same caution as register; creates a permanent grain. Use a test partner_agent_id.
8. **Designer face** — toggle face=D, open viewer (👁). Edit your character face's `commit_gates` to `happyseaurchin:passport,happyseaurchin:notes`. Save. Confirm via re-opening the editor that the new value is read back.
9. **Inbox (📬)** — drop a mark on the federated beach mentioning your own handle from a different identity (or from a second tab). Within ~20 s, the 📬 indicator should show 1. Click → drawer opens with the mark. Click the mark → beach + address swap to the mark's source.
10. **Two-tab vapour** — open xstream.onen.ai in two browsers with different handles at the same address. Type in one. The other should see live keystroke deltas in their VapourZone.
11. **Connector spike** — append `?mcp=connector` to the URL, fire any LLM query. Should still respond (Anthropic dispatches bsp-mcp tools server-side). Server-side federation routing is currently the gap (server doesn't see https://happyseaurchin.com), but the connector path itself works.

If anything breaks, the gotchas section below covers the recurring ones from the previous sessions.

---

## Late-session additions (after Tier 3 ship)

Three small follow-ups landed before the test session:

### Inbox ack/dismiss — local — `<commit>`

The 📬 indicator now shows *unread* count, not total. Each item in InboxDrawer has a `✕` button that ACKS the mark locally (localStorage `xstream:inbox-acks`, JSON array of `<beach>#<digit>` keys). Acked marks are filtered from the list and from the badge count. Local-only — persistence-across-devices is a Tier-4 concern (would need a `bsp()` write to a private `inbox-acks` block keyed by the user, follow-up).

### Shell lock on save — sovereignty closes — `<commit>`

The bootstrap shell was created unlocked, meaning anyone who knew the agent_id could rewrite gates. Now the in-client `bsp()` accepts `new_lock: string` and the `FaceCard.save()` always passes `new_lock: secret`. Per bsp-mcp lock semantics:

- **R1** (block doesn't exist + new_lock): create locked, no secret needed.
- **R2** (block unlocked + new_lock): set lock, no secret needed.
- **R3** (block locked + secret): proves authority for content writes.
- **R4** (block locked + secret + new_lock): rotate (with optional content).

Result: the first save by an agent locks their shell with their session passphrase. Subsequent saves match (R3) and re-write the same hash (R4 idempotent). The Designer face is now genuinely sovereign — anyone can READ the user's gates, but only the passphrase holder can write them.

Implementation note: lock is rooted at position `_` for v0.1 — a single root-level lock covers the whole shell. Per-position locking is a substrate feature for later.

### Pool surface — discovery — `<commit>`

The Author face now lists pools at the current beach. Pure read: walks `bsp(agent_id=beach, block="beach", spindle="2")`, enumerates `2.1..2.9`, and shows each pool's underscore (purpose) plus its `_synthesis._` if present. Doesn't yet wire pool *contributions* — see the operational design below for what that needs.

---

## How pool is operational on bsp-mcp

A pool isn't a separate primitive. It's a *block shape* on a beach. The geometry does the work; bsp() is the only function involved.

### Address shape

A beach block has the canonical structure:

```
beach (the block at agent_id=<beach-url>, block="beach")
  _    : "Beach at <origin> — public commons..."     ← the beach's own description
  1    : { 1: <mark>, 2: <mark>, ... }                ← marks ring (open billboard, tide-cleared)
  2    : { 1: <pool>, 2: <pool>, ... }                ← pools ring (each Nth slot is one pool)
```

Each pool at `2.<N>` is itself a small block:

```
beach:2.<N>
  _           : "Pool purpose — what we're trying to converge on"
  1           : <contribution>     ← contribution slot 1
  2           : <contribution>     ← contribution slot 2
  ...
  9           : <contribution>     ← contribution slot 9
  _synthesis  : { _: "<canonical render>", _envelope: "[SYNTHESIS rule=... by=... at=...]" }
```

Same pscale geometry as a frame disc, just rooted under `2.<N>` instead of being a separate `frame:<scene>` block. The reason it sits inside the beach block (rather than as its own `pool:<id>` block) is that **pools belong to the beach**: discovery is "what pools are at this beach?", which is just `bsp(spindle="2")` at the beach.

### Operating on a pool — every action is a bsp() call

| Action | Call |
|---|---|
| List pools at a beach | `bsp(agent_id=<beach>, block="beach", spindle="2", pscale_attention=-2)` — dir at "2" |
| Read a pool's purpose | `bsp(agent_id=<beach>, block="beach", spindle="2.<N>", pscale_attention=0)` — point at the underscore |
| Read all contributions | `bsp(agent_id=<beach>, block="beach", spindle="2.<N>", pscale_attention=-2)` — dir |
| Read latest synthesis | `bsp(agent_id=<beach>, block="beach", spindle="2.<N>._synthesis", pscale_attention=0)` |
| Create a new pool | `bsp(agent_id=<beach>, block="beach", spindle="2.<next-free>", content={_: "purpose"}, secret: <beach-owner-secret>)` |
| Contribute to a pool | `bsp(agent_id=<beach>, block="beach", spindle="2.<N>.<next-free>", content="<my contribution>", secret: <my-write-token-if-locked>)` |

The "next-free" digit is computed by reading the ring first and finding the first absent slot 1..9. When all 9 are full, GRIT triggers (or in v0.1, the oldest gets overwritten, depending on tide rules).

### GRIT — synthesis daemon

The synthesis itself is **out of bsp-mcp** — it's a daemon running on the pool host that watches for "round closed" conditions and dispatches. Per `protocol-xstream-frame.md` §7:

1. **Trigger**: signal (e.g. user-fired commit), quorum (M of N contributors have written), or timer (window elapsed).
2. **Read full state**: `bsp(spindle="2.<N>", pscale_attention=-2)` — full pool.
3. **Fetch skill**: resolve `*:<owner>:skill-pack:<pool-kind>` for the rendering rule.
4. **Call medium-LLM**: skill + context → solid synthesis.
5. **Write commitments**: clear contributions to `2.<N>.<m>.2`-equivalents (or just rotate them out), write synthesis to `2.<N>._synthesis._`, stamp `_envelope`.

The daemon only uses bsp() — no new primitive. Its `agent_id` must be registered in the appropriate `sed:` collective (e.g., `sed:<game>-resolvers`) for the pool to accept its writes. This is the existing sed: face authority machinery; nothing new.

### What the xstream client needs to do pools fully (the open work)

We have **discovery** today (Author face lists pools). The remaining client-side work to make pools operational is:

1. **Join a pool** — set `current_address` to `2.<N>`. The address bar already accepts this; navigating works for browsing.
2. **Pool-aware reads** — the kernel today reads marks from `beach:1`. When the user is "in a pool" (current_address starts with `2.<digit>`), it should additionally read `beach:2.<N>` ring and surface contributions in the Solid/Liquid zones (instead of marks).
3. **Pool-aware contributions** — when the user submits and is at a pool address, the write goes to `beach:2.<N>.<next-free>` instead of `beach:1.<next-free>`. This is a small branch in `dropMark` / `commitLiquid`.
4. **Pool synthesis surfacing** — when present, render `2.<N>._synthesis._` as the canonical solid above the contributions, just like the frame synthesis.
5. **Create-a-pool affordance** — a 6th action button (or a verb prefix `pool: <purpose>`) that writes a new pool at the next free `2.<N>`. Beach-owner secret needed unless the beach allows open pool creation.

That's roughly 100 LOC of kernel branch plus a UI affordance. Not done in this session. The cleanest sequencing:

- (a) Decide whether pools are discovered-at-beach or also at federated URLs (today: beach-local — simpler). Probably this is fine for v0.1.
- (b) Add a `current_pool: string | null` to BeachSession (parallel to current_frame), set by parsing `current_address` — if it starts with `2.<digit>`, that's the pool position.
- (c) Branch `dropMark` and `commitLiquid` on `current_pool`: when in pool, write at `beach:2.<pool>.<next>` shape.
- (d) Branch the kernel cycle's marks-read: when in pool, ALSO read `beach:2.<pool>` and surface as a `poolContributions` callback. UI renders these in Solid (because pool contributions are committed, not draft).
- (e) Pool creation: a verb prefix `pool: <purpose>` parses to a write at the next free `2.<N>`, or a dedicated UI affordance.

The whole thing remains six entry points: nothing new. Pools are just where on the geometry the contributions land.

---

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
