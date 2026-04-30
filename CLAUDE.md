# CLAUDE.md — xstream beach client

## FIRST THING YOU DO

**Before any code, fetch and walk these.** They are the canonical orientation for the substrate this client speaks to.

The substrate (bsp-mcp):
```
https://raw.githubusercontent.com/pscale-commons/bsp-mcp-server/main/CLAUDE.md
https://raw.githubusercontent.com/pscale-commons/bsp-mcp-server/main/src/sunstone.json
https://raw.githubusercontent.com/pscale-commons/bsp-mcp-server/main/src/whetstone.json
https://raw.githubusercontent.com/pscale-commons/bsp-mcp-server/main/src/evolution.json
```

Protocol specs:
```
https://raw.githubusercontent.com/pscale-commons/bsp-mcp-server/main/docs/protocol-pscale-beach-v2.md
https://raw.githubusercontent.com/pscale-commons/bsp-mcp-server/main/docs/protocol-agent-shell.md
https://raw.githubusercontent.com/pscale-commons/bsp-mcp-server/main/docs/protocol-block-references.md
https://raw.githubusercontent.com/pscale-commons/bsp-mcp-server/main/docs/protocol-xstream-frame.md
https://raw.githubusercontent.com/pscale-commons/bsp-mcp-server/main/docs/presence-via-marks.md
https://raw.githubusercontent.com/pscale-commons/bsp-mcp-server/main/docs/happyseaurchin-v2-implementation.md
```

**Read sunstone first.** It is a self-teaching pscale block. Walk it with `bsp()` to learn how to walk anything.

**Whetstone is the operational reference**: branch 1 is the `bsp()` signature; branch 2 is the selection-shape derivation table; branch 3 is modifier composition (face, tier, secret, gray); branch 5 is the translation map from the legacy pscale-mcp era.

If you previously read `pscale-touchstone.json` or `bsp.js` from `pscale-commons/pscale`: those are LEGACY (pre-bsp-mcp era). Do not use them. Sunstone supersedes touchstone; whetstone supersedes bsp.js.

---

## What this is

`xstream-play` is the **xstream beach client**: a browser app at <https://xstream.onen.ai> that lets a human (or agent) engage a federated beach via the bsp-mcp substrate. V/L/S — vapour, liquid, solid — three zones that mirror the user's engagement, plus a viewer drawer for "looking up" at what's around. Identity in the floating button. Federated dispatch to `https://happyseaurchin.com/.well-known/pscale-beach` when the agent_id is a URL; bsp-mcp commons (Supabase) when bare/sed:/grain:.

The previous direction (xstream-play) was a multiplayer narrative RPG. The game kernel is **gone**. This is a beach client for real-world coordination, not a game.

---

## bsp-mcp discipline

The substrate exposes **six entry points total**:

1. `bsp()` — the geometric primitive. Whetstone signature: `bsp(agent_id, block, spindle, pscale_attention, content?, face?, tier?, secret?, gray?)`. Read when content is omitted; write when content is provided. Selection shape derives from (S, P) per whetstone branch 2.
2. `pscale_create_collective` — admin op on a sed: substrate.
3. `pscale_register` — server-assigned position in a sed:.
4. `pscale_grain_reach` — bilateral commitment via reach/accept across `pair_id`.
5. `pscale_key_publish` — Argon2id key derivation + publication.
6. `pscale_verify_rider` — ecosquared rider signature verification.

**Everything else is a convention over `bsp()`**, not a separate tool:

- Passport — block at `(agent_id, "passport")`, conventional shape (`_` description, `1` offers, `2` needs, `9` keys). Read/written via `bsp()`.
- Inbox — replaced. There is no inbox primitive. Cold contact = a structured mark on a beach the recipient watches.
- Beach mark — `bsp()` ring write at `1.<n>` of the beach block.
- Pool / liquid pool — `bsp()` ring write at `2.<N>.<n>`.
- GRIT — daemon script polling a pool via `bsp()`, writing a synthesis envelope via `bsp()`. No primitive.
- Presence — structured mark with three required tags (`1=agent_id, 2=address, 3=ts`); read-side staleness filter.

If you find yourself listing `pscale_passport_publish` or `pscale_pool_send` or `pscale_inbox_send` as a tool, stop. Those are pscale-mcp legacy. Use `bsp()` to read/write the underlying block at the conventional shape.

---

## Architecture (this client)

```
src/
  lib/
    bsp-client.ts         — bsp() wrapper. Federated URL dispatch. Presence helpers
                            (heartbeat / claim-digit / read). Shell helpers (read /
                            bootstrap). Block reference resolver (parseRef /
                            resolveRef / resolveStarRefs) covering all five forms
                            (URL, sed:, grain:, qualified, bare) per
                            protocol-block-references.md.
    supabase.ts           — thin Supabase client (bsp-mcp commons fallback).
  kernel/
    beach-kernel.ts       — poll loop: heartbeat presence, read presence, read marks,
                            read frame disc when in-frame. dropMark, commitLiquid.
                            No LLM in the loop.
    beach-session.ts      — BeachSession type (agent_id, secret, current_beach,
                            current_address, current_frame?, entity_position?,
                            vapor, liquid_pending, last_solid, api_key).
    bsp.ts                — local pure-form walker. Implements the geometry per
                            whetstone branches 1-2. Used for in-memory walks of
                            blocks already loaded into the session.
    block-store.ts        — in-memory store. Seeds the three agent JSONs only.
                            injectBlock for substrate-fetched blocks (no
                            localStorage write).
    claude-direct.ts      — browser → Anthropic API. Soft-LLM transport.
  components/
    xstream/
      ConstructionButton.tsx  — floating # button; vapour input panel; settings menu
                                with identity (handle / passphrase / API key) and
                                theme cycle. Home of primary action.
      SolidZone.tsx           — top zone — user's contributions / canon they belong to.
      LiquidZone.tsx          — middle zone — pending commit + present peers.
                                Click commit dot on self card → bsp() write.
      VapourZone.tsx          — bottom zone — soft-LLM response + (future) peer vapour.
    DraggableSeparator.tsx    — resizable borders between zones.
    ViewerDrawer.tsx          — slide-down overlay (👁) — marks + presence at address.
                                Faces other than character/observer are placeholders
                                (per-face viewer content is a follow-up).
    SubstrateTray.tsx         — five buttons matching the non-geometric primitives.
                                Currently STUB: dialogs capture inputs but only log.
                                Wiring to real bsp() / pscale_register / etc. is
                                next-track work.
  App.tsx                 — composition. Header (face / address / frame / substrate
                            tray / viewer toggle / presence), three zones with
                            separators, floating button, viewer drawer overlay.

blocks/xstream/
  medium-agent.json       — beach-flavoured medium prompt (synthesises emerged
                            content from a commit at the address).
  soft-agent.json         — beach-flavoured soft prompt (thinking partner; vapour
                            → liquid refinement). Names the system-prompt context
                            slots at branch 4: 4.1 shell, 4.2 frame, 4.3 solid
                            history, 4.4 user message.
  hard-agent.json         — beach-flavoured hard prompt (mechanical reconciler).
```

---

## What's wired vs stub

| Capability | Status |
|---|---|
| Federated read of `https://happyseaurchin.com/.well-known/pscale-beach` | ✅ live |
| Federated write (drop mark, commit liquid) | ✅ live; verified end-to-end |
| Presence heartbeat per `presence-via-marks.md` | ✅ |
| Identity in button settings (handle / passphrase / API key) | ✅ |
| Three-zone V/L/S with draggable separators + floating # button | ✅ |
| Viewer drawer (👁) — character/observer faces | ✅ |
| Soft-LLM ⌘↵ — Tier 2 plain Claude API call | ✅ (no tool-use, no substrate awareness) |
| Soft-LLM with bsp-mcp tools (face-aware, gates from shell) | ❌ NEXT TRACK — the magic move |
| Substrate-tool tray wired to real primitives | ❌ STUB |
| Viewer for author / designer faces | ❌ placeholder |
| Frame synthesis daemon | not in client scope (runs on the frame owner's host per protocol-xstream-frame.md §7) |
| Live peer vapour (realtime channel) | ❌ not wired (4s poll only) |

---

## Recommended next track

**Hook up bsp-mcp tool-use in the soft-LLM call (CADO-aware).** When the user types in vapour and hits ⌘↵, the soft-LLM:
- knows who they are (`agent_id`, current face);
- knows where they are (beach, address, frame if any);
- can call the six bsp-mcp primitives — face-gated — to answer "what's here?", "who's around?", "what has weft been thinking about?".

**Tools to expose**: exactly the six bsp-mcp primitives. No more. Conventions (passport / pool / inbox-replacement / beach-mark) are taught via *system-prompt context*, not as additional tools — the LLM uses `bsp()` to read/write at the conventional shape.

**Where the gates come from — read them, don't hardcode**:
- Active face = `shell:1.<digit>` (1=character, 2=author, 3=designer, 4=observer).
- Knowledge gates = `shell:1.<digit>.2` (read scope).
- Commit gates = `shell:1.<digit>.3` (write scope).
- Whetstone:3.2 default face/tier matrix is fallback when the shell doesn't specify. The shell is the source of truth — which means the user can edit gating from the Designer face.

**Where the system-prompt context slots come from — read the block, don't reinvent**:
- `blocks/xstream/soft-agent.json` branch 4 names the slots: `4.1` shell, `4.2` frame from hard, `4.3` solid history, `4.4` user message.
- The work is filling those named slots via `bsp()` reads. Discipline.

After tool-use lands: wire the substrate tray to real calls; per-face viewer content; live peer vapour over a realtime channel.

---

## Gotchas (do not relearn the hard way)

1. **Browser cache poisons federated GETs.** Reads to `/.well-known/pscale-beach` need `cache: 'no-store'` plus a `?_t=<ts>` cache-buster. Without those, the browser returns 304s and the kernel never sees new marks.
2. **Don't add `Cache-Control: no-cache` header** to GETs. Turns the request into a non-simple CORS request; the federated server's preflight doesn't allowlist that header → `TypeError: Failed to fetch`. The query cache-buster + `cache: 'no-store'` are sufficient.
3. **Presence vs substantive marks.** Every mark `dropMark` writes carries the three structured fields (1=agent, 2=address, 3=timestamp). Distinguish by *underscore pattern* (`/^\S+ @ \S+ — present at /`), not "has all three fields". Otherwise substantive contributions are filtered out as presence and never displayed.
4. **Drag handler vs input fields.** `ConstructionButton`'s `onMouseDown` for drag must exclude `input`, `label`, `textarea`, `button`, and any `[data-no-drag]` element — otherwise inputs in the settings popover become unfocusable.
5. **Vercel env vars are scoped per environment.** Tick **Production AND Preview** when adding `VITE_*` keys — branch deployments use Preview. Vercel doesn't auto-rebuild on env var changes; push a no-op commit to trigger.
6. **Vercel Domains panel is per-target.** "Branch domains" appear under their branch deployment, not the production overview. `xstream.onen.ai` is bound to `feature/bsp-mcp-native`; `play.onen.ai` stays on `main` (legacy fantasy game).

---

## Substrate dispatch

Per `bsp-client.ts`, the agent_id prefix routes:
- `https://...` → federated beach (POST/GET to `<origin>/.well-known/pscale-beach`).
- `sed:`, `grain:`, bare → bsp-mcp Supabase commons (`pscale_blocks` table).

There is no "substrate toggle" UI — the prefix IS the dispatcher.

bsp-mcp endpoints (reference):
- `https://bsp.hermitcrab.me/mcp/v1` — bsp-mcp custom domain.
- `https://bsp-mcp-server-production.up.railway.app/mcp/v1` — Railway direct.

---

## Working with David

David is a vibe-coder — architect and designer with deep theoretical work on coordination systems. Reflexive, imaginative, concurrent. He cares about *how it feels* — UX is design, not polish. The original V/L/S design (zones with draggable separators, floating button as home of primary action, vapour input INSIDE the button at the bottom never obscured by the viewer drawer) is non-negotiable. If you find yourself rebuilding it from scratch as a flat form, stop and ask.

**The substrate is the context engine; the surface is reflexive** — what the user sees mirrors their engagement, filtered by who/where/how, not "everything, then filter down". Default-empty zones are correct for an unfocused user; zones populate as the user picks face / address / frame / pool.

Don't conflate substrate with surface. The kernel and bsp-client are substrate; the zones, button, separators are surface. Surface components are not "coupled" to game state just because they once rendered game state — they take props. Refactor by changing the data they receive, not by deleting them.

**Code bloat is a failure mode.** If you're adding lines, justify each one. If you can delete lines, do. The geometry does the work.

---

## Commands

```bash
npm run dev      # dev server on :8080
npm run build    # vite production build
```

Local `.env.local` needs `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` for the bsp-mcp commons fallback path. Anthropic API key is entered by the user in the button's identity panel (sessionStorage; never leaves the browser except to api.anthropic.com).

---

## Scope

- **Repo**: `happyseaurchin/xstream-play`, branch `feature/bsp-mcp-native`.
- **Deployed**: `xstream.onen.ai` (Vercel project `xstream-play`, team `happyseaurchins-projects`).
- **Beach (federated)**: `https://happyseaurchin.com/.well-known/pscale-beach` (Stage 3 + 4 of v2 protocol — live).
- **Commons fallback**: bsp-mcp Supabase substrate (`piqxyfmzzywxzqkzmpmm.supabase.co`, table `pscale_blocks`).

---

## Out of scope for the beach client

- `extension/` — Chrome extension (beach-everywhere button) using legacy `bsp.js` and `visitor-*-agent.json` blocks. Separate concern. Future work to align with bsp-mcp-native.
- `docs/archive/` — pre-bsp-mcp game-era documents retained for historical reference. Do NOT use as orientation.

---

## Design principles

1. **Sovereignty** — each user owns their identity, their blocks, their API key.
2. **Stigmergy** — coordination through shared substrate (beach), not messages.
3. **Six entry points** — `bsp()` plus five primitives. Resist the urge to grow.
4. **Conventions over functions** — passport / pool / inbox / mark / GRIT live as block shapes accessed via `bsp()`, not as separate tools.
5. **Surface is reflexive** — the user sees what their engagement produces, filtered by who/where/how.
6. **Substrate is the context engine** — filtering happens at face/address/frame, not at a search box.
7. **Reads are free; writes carry sovereignty** — anyone reads, only the lock-holder writes.
