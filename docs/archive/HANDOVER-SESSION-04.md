# Session 04 Handover — Cloud Save, NPC Handshake, Production Fix

**Branch:** `main` at commit `f23e4b5`
**Date:** 4 April 2026
**Previous session:** `HANDOVER-SESSION-03.md` (Triad Completion + Convergence Protocol)

---

## What was done this session

### 1. Production black screen fix (commits `081ac59`, `944bfb1`)

play.onen.ai was showing a black screen. Two causes:

- **Circular dependency:** `block-store.ts` imported `saveBlock` from `persistence.ts`, which imported `getBlock`/`listBlocks` from `block-store.ts`. Production bundler (Vite/Rollup) hit a temporal dead zone. Fix: `exportGameState` now takes `allBlocks` as a parameter instead of importing from block-store. Callers collect and pass blocks in.

- **useState ordering:** `editTarget` and `editAddress` were declared at line 351 but referenced in `handleQuery`'s dependency array at line 305. Production minifier exposed the TDZ. Fix: moved useState declarations above the useCallback that depends on them.

Both bugs were pre-existing (from session 03) but only manifested in production builds.

### 2. Cloud save + Stripe registration (commits `f911b3f`, `0082ad9`)

**Registration flow:** Stripe Checkout ($10) → webhook creates Supabase user atomically → password reset email → sign in → cloud save enabled. No user rows exist until payment clears. Zero intermediate states.

- `src/lib/supabase.ts` — Supabase client (same project as relay)
- `src/lib/auth.ts` — thin auth wrapper (signIn, signOut, getSession, getUserProfile)
- `src/components/SaveModal.tsx` — modal with "Download file" + "Save to cloud"
- `src/kernel/persistence.ts` — added `cloudSave`, `cloudList`, `cloudLoad`
- `supabase/functions/create-checkout/index.ts` — Edge Function, redirects to Stripe
- `supabase/functions/stripe-webhook/index.ts` — Edge Function, creates user on payment

**Database changes:**
- `saved_games` table with RLS (users read/write only their own)
- `paid` boolean on `public.users` (gates cloud features)
- Cleaned existing users (only admin david@ecosquared.co.uk remains, paid=true)

**Stripe:**
- Product: "xstream Play Membership" (prod_UGJYLS5SZkKOjy)
- Price: $10 one-time (price_1THmuxBj8x7c0F1eYWqSBeRe)
- Webhook registered → stripe-webhook Edge Function

**Supabase isolation:** The Supabase client is NOT in the render path. It lazy-loads only when the save modal opens or cloud functions are called. The kernel, blocks, BSP — none touch Supabase.

### 3. Salty Dog name restoration (commit `248418c`)

Previous session renamed "Salty Dog" to "Salted Dog" across all blocks. Reverted in spatial-thornkeep, rules-thornkeep, character-essa, soft-designer-agent.

### 4. Character initiation — presence seeding (commits `248418c`, `ad6952c`)

**Create game:** Seeds one event from the spatial block spindle — "You are in the main room of The Salty Dog." — so the medium knows the character is already present and doesn't invent an entrance.

**Join game:** Seeds `pending_liquid` with arrival intention — "{description} enters." — so the first commit naturally resolves as an entrance.

All seeded events use descriptions only, never names. Respects the existing familiarity gating system (fam=0: stranger/description, fam=1: introduced/name, fam=2+: known).

### 5. NPC handshake (commits `6c4591e`, `f23e4b5`)

Character blocks now carry their spatial address in a hidden directory at root (key "1"). Essa and Kael at "111" (tavern), Harren at "113" (guard station).

`prompt.ts` scans all `character-*` blocks in the store, star-walks each root to find hidden key "1", compares against the player's spatial address. Matching NPCs appear as "ALSO PRESENT (NPCs)" with appearance description only.

Dynamic matching — no static wiring in the spatial block. Moving an NPC = change one string in its hidden directory. The spatial block describes places. Characters carry their own location. The handshake validates both directions.

---

## Current state

### 18 blocks in the store (unchanged)
Agent blocks: medium-agent, soft-agent, soft-author-agent, soft-designer-agent, hard-agent, hard-author-agent, hard-designer-agent, author-agent, designer-agent
World blocks: spatial-thornkeep, rules-thornkeep, harness
Character blocks: character-essa (at 111), character-harren (at 113), character-kael (at 111), character-template
Protocol blocks: convergence, systemic-kernel

### What works
- **Character face:** create/join → presence/arrival seeded → medium fires with NPC context → narrative with familiarity-gated names
- **NPC handshake:** characters carry spatial address, prompt matches dynamically at runtime
- **Multiplayer:** relay coordination, domino cascades, event accumulation
- **Three faces:** character/author/designer with face-specific soft/medium/hard
- **Persistence:** per-block localStorage (always), cloud save (paid users)
- **Registration:** Stripe → webhook → Supabase user (atomic, no intermediate states)

### What doesn't work yet
- **Character blocks not wired to soft:** soft-prompt.ts doesn't scan for NPC handshake (only prompt.ts does). The soft-LLM won't mention NPCs unless the player has already encountered them via the medium.
- **Familiarity promotion:** no mechanism to increase familiarity when characters interact. The medium sees strangers forever unless something sets `block.familiarity[id]`.
- **NPC agency:** NPCs are descriptive presence only — they don't act, speak, or respond unless the medium invents their behaviour. No NPC kernel.
- **Convergence protocol:** described in block, not implemented in kernel. Commits still produce immediate solids, not provisionals.
- **Block edit sync:** author/designer edits are local-only.
- **Filmstrip API:** still returns 500.

---

## Trajectory to completion

### Phase 1: Playable single-player (CURRENT — 80% done)

What remains:
1. **Wire NPC handshake to soft-prompt.ts** — same scan pattern as prompt.ts. The soft should know who's in the room so it can advise about them.
2. **Familiarity promotion via medium events** — when a medium produces an event mentioning an NPC by description, and the NPC responds (via medium invention), familiarity should increment. Mechanical: scan medium output for NPC references, match against character blocks, promote.
3. **Test and tune** — play sessions to calibrate medium output quality, NPC behaviour, spatial descriptions.

### Phase 2: Playable multiplayer (needs 2+ players)

What remains:
4. **Convergence protocol** — provisional loop instead of immediate solids. The block at `convergence 0.1` is the spec. Single-player degenerates correctly (one provisional → immediate solid). This is the big architectural piece.
5. **Block edit sync** — author/designer edits visible to other players via relay. Currently local-only.
6. **Cross-location events** — events at 112 (harbour road) should be faintly audible at 111 (tavern). Spatial proximity filtering for events.

### Phase 3: World expansion

7. **More locations** — harbour road (112), guard station (113), headland (2), southern road (3) need the same depth as 111. Block edits, not code.
8. **More NPCs** — lighthouse keeper, harbour merchant, travelling traders. Character blocks with spatial addresses. No code changes.
9. **Character movement** — changing `spatial_address` and NPC hidden key "1" when characters move between locations. The medium could output movement events that the kernel processes.

### Phase 4: Public release features

10. **Director face** — observes all peer blocks (no proximity filter), no commit power. Produces compiled narratives, story summaries, video scripts. New agent block + routing.
11. **Cloud save UX polish** — resume from cloud, list cloud saves on setup screen.
12. **Paywall testing** — end-to-end Stripe → webhook → password setup → sign in → cloud save.
13. **Multi-world support** — different spatial + rules blocks for different settings. Agent blocks reference different block names via star. No kernel code changes.

### Phase 5: Beyond

14. **NPC kernels** — NPCs run their own medium on a schedule (cron or event-driven). Each NPC becomes a sovereign agent. The handshake still works — they just also produce events.
15. **Director API integration** — image generation, video compilation from narrative events. The director face becomes a production pipeline.
16. **User discovery** — registered users find each other, invite to games. Supabase social layer.

---

## For the next Claude Code session

Read `CLAUDE.md` first. Then this handover. Walk the blocks:

```bash
node test-bsp.mjs character-essa 0 '*'    # NPC spatial handshake
node test-bsp.mjs spatial-thornkeep 111    # the room
node test-bsp.mjs medium-agent 0 '*'      # star chain
node test-bsp.mjs convergence 0.1         # provisional loop spec
```

The NPC handshake is the new pattern: characters carry their own location in a hidden directory. `prompt.ts` scans and matches at runtime. This replaces static wiring. The same pattern should extend to soft-prompt.ts, and eventually to NPC kernels.

The Supabase integration (cloud save, Stripe registration) is isolated from the game engine. The kernel doesn't know about Supabase. The save modal lazy-loads it. If the integration causes problems, delete 4 files and the game works exactly as before.

David's priorities: playtest the character face with NPCs present, then consider the director face for visual output integration.
