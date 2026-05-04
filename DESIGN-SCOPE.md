# DESIGN-SCOPE — substrate-as-program in xstream

**Purpose**: pin the line between code and pscale blocks for xstream-play, define the runtime interpreters that mediate it, and sequence the work that moves behavioural policy out of TypeScript and into substrate. This is a scoping document, not an implementation plan — it is the contract subsequent sessions build against.

**Context**: this session ratified two architectural decisions: (a) the substrate (federated beach + bsp-mcp) is the single source of truth for liquid; (b) the surface (kernel + components) mirrors the substrate. The next direction is to move *policy* (settings, recipes, dispatches, gates) out of TypeScript and into pscale blocks, accessed via a small set of generic runtime interpreters. Designer face becomes the operational interface for editing those policy blocks via the standard bsp() primitive — no bespoke "designer toolset," just contextualised soft-LLM authoring blocks at the right addresses.

The deep payoff is that the kernel becomes a *thin walker* over substrate-authored programs, the same architecture supports any rule-bound process (governance, simulation, RPG, settings, conversation conventions), and Designer face lets a community author its own behaviour without code changes.

---

## 1. Inventory of behavioural choices

Every place the kernel makes a hardcoded behavioural decision today, classified by where it belongs.

### 1.1 — L1 (configurations: values that change in seconds, no shape change)

These are pure values. The kernel reads the value, the behaviour stays in code. Strong block candidates.

| Choice | Where (file:line approx) | Default | Scope |
|---|---|---|---|
| Vapour staleness | [Column.tsx](src/components/Column.tsx) `VAPOUR_STALENESS_MS` | 12000 ms | per-rendezvous (or per-user) |
| Vapour broadcast debounce | [Column.tsx](src/components/Column.tsx) `vapourBroadcastDebounceRef` | 80 ms | per-user |
| Liquid staleness | [beach-kernel.ts:58](src/kernel/beach-kernel.ts:58) `LIQUID_STALENESS_MS` | 60000 ms | per-rendezvous |
| Presence staleness | [bsp-client.ts](src/lib/bsp-client.ts) `DEFAULT_STALENESS_MS` | 30000 ms | per-rendezvous |
| Kernel poll cadence | [beach-kernel.ts](src/kernel/beach-kernel.ts) `DEFAULT_POLL_MS` | 1500 ms | per-user (perf trade-off) |
| Inbox scan frequency | [beach-kernel.ts](src/kernel/beach-kernel.ts) `WATCH_EVERY_N_CYCLES` | every 5th tick | per-user |
| Default beach URL | [bsp-client.ts](src/lib/bsp-client.ts) `DEFAULT_BEACH` | happyseaurchin.com | per-user (or per-deployment) |
| Initial zone heights | [Column.tsx](src/components/Column.tsx) | 35% / 30% / 35% | per-user |
| Construction button width / position defaults | [ConstructionButton.tsx](src/components/xstream/ConstructionButton.tsx) | 352px / bottom-center | per-user |
| Vapour scope visibility | (not yet implemented) | `everyone-here` | per-user |
| Per-handle vapour mute list | localStorage `xstream:vapour-mutes:<handle>` | empty | per-user (already substrate-adjacent) |

### 1.2 — L2 (recipes: shaped data that templates LLM behaviour)

Each entry encodes "what the LLM does in some moment." These have shape (gather-list + template + model + mode) but are interpreted by a fixed runner.

| Choice | Where | Current shape | Scope |
|---|---|---|---|
| Soft-LLM system-prompt assembly | [claude-tools.ts](src/kernel/claude-tools.ts) `composeContext` + `buildSoftSystemPrompt` | code, with prompt parts coming from `blocks/xstream/soft-agent.json` | per-face |
| Soft-LLM gather-list (which substrate reads feed context) | [claude-tools.ts](src/kernel/claude-tools.ts) `composeContext` | hardcoded set: shell, frame, marks, presence, user-msg | per-face |
| Soft-LLM tool catalogue | [claude-tools.ts](src/kernel/claude-tools.ts) | hardcoded list (six bsp-mcp + propose_liquid) | per-face (face gates which tools are exposed) |
| Medium-LLM synthesis recipe per face | [medium-llm.ts](src/kernel/medium-llm.ts) `parseRecipe` (`personal`, `quaker`, `bypass`) | dispatch on string mode | per-face |
| Medium-LLM gather-list | [medium-llm.ts](src/kernel/medium-llm.ts) `synthesise` | hardcoded: pendingLiquid + marks + presence + frame + pool | per-face — **CRITICAL: see §4** |
| Medium-LLM prompt template | [medium-llm.ts](src/kernel/medium-llm.ts) | per-mode hardcoded strings | per-face |
| Default models (soft / medium) | [beach-session.ts](src/kernel/beach-session.ts) `claude-sonnet-4-6` | constant | per-user |
| Mark structured shape on write | [beach-kernel.ts](src/kernel/beach-kernel.ts) `dropMark` | `{_, 1=agent, 2=address, 3=ts, 4=face}` | protocol — code-side |
| Liquid slot structured shape on write | [beach-kernel.ts](src/kernel/beach-kernel.ts) `writeBeachLiquid` | same | protocol — code-side |
| Frame entity / synthesis shape | [beach-kernel.ts](src/kernel/beach-kernel.ts) `readFrame` | `{1=liquid, 2=solid}` per entity, `_synthesis._ + ._envelope` | protocol — code-side |
| Liquid scope filter (prefix vs exact match) | [beach-kernel.ts](src/kernel/beach-kernel.ts) `readLiquid` | prefix match | per-rendezvous |

### 1.3 — L3 (state-machine geometry: ordered/conditional dispatch)

These describe *flow*, not values or templates. Strongest substrate-as-program candidates.

| Choice | Where | Current shape | Notes |
|---|---|---|---|
| Substrate verb router | [Column.tsx](src/components/Column.tsx) `handleSubmit` | big regex/switch over `passport:`, `register sed:`, `engage`, `pool:`, `keys` | adding a new verb today = editing TS; should be: edit a verbs block |
| Kernel cycle order | [beach-kernel.ts](src/kernel/beach-kernel.ts) `cycle()` | hardcoded: heartbeat → presence → marks-and-liquid → pool → frame → inbox-every-5th | useful when columns want different cycles (frame mode skips inbox; archive mode skips heartbeat) |
| Inbox needle patterns | [beach-kernel.ts](src/kernel/beach-kernel.ts) `scanInbox` | hardcoded: `[me, '@'+me]` | should be designer-editable |
| Action button state machine | [ConstructionButton.tsx](src/components/xstream/ConstructionButton.tsx) `actionMode` | hardcoded 4-state: idle / submit / commit / committing | **borderline** — small enough that L3 overhead exceeds editability win; keep code-side |
| Vapour scope derivation | [realtime.ts](src/lib/realtime.ts) `deriveScope` | hardcoded formula `vapour:<beach>:addr:<addr>` (or frame variant) | could be a block; low value today |
| Vapour relationship filter | (not yet implemented) | placeholder | will need block when added |
| Resolution / precedence chain | (not yet implemented) | — | **central** — see §3 |
| Commit propagation (star-walks after solid lands) | (not yet implemented) | — | this is the hard-LLM-replacement: see §4 |

### 1.4 — Stays code-side (interpreters and runtime mechanics)

| Why it stays | Examples |
|---|---|
| Substrate I/O | bsp() dispatch, federated HTTP, MCP-HTTP wrapper, supabase realtime channel join |
| React reconciliation, drag/focus management, browser APIs | `useState`, drag handlers, localStorage/sessionStorage access |
| Boot, identity load, anon-id mint | initial app load before substrate is reachable |
| Protocol-bound formats | presence-mark underscore pattern, lock hash format, agent_id parsing — changing client-side breaks federation |
| The interpreters themselves | the L1/L2/L3 readers; their narrowness is the invariant the system runs on |

The line between "interpreter" and "interpreted" is the line between code and substrate. The interpreter is the small surface that reads a known block shape and dispatches; everything that block describes is substrate.

---

## 2. Interpreters

Five generic interpreters cover everything the substrate-as-program direction needs. Each is a fixed code-side contract; the geometry it interprets is substrate.

### 2.1 — Settings reader

**Block shape**: any `path: value` pair, addressable by spindle. Example: `(beach, "xstream-settings", "vapour.staleness_ms")` returns `12000`.

**Inputs**: setting path (string), default value (typed).

**Behaviour**: walks the precedence policy (§3), returns first non-null value at any layer. Cached per render.

**Failure modes**: substrate unreachable → return default; type mismatch → log and return default; circular precedence → log and break.

**Code surface**: a `useSetting<T>(path, default)` hook. ~50 lines.

### 2.2 — Recipe runner

**Block shape**: a recipe block with `_` = role description, `1` = gather-list (array of substrate paths to read), `2` = prompt-template (string with `{slot}` interpolations), `3` = model, `4` = mode (`bypass` | `synthesise` | `propose`).

**Inputs**: recipe block, runtime inputs (the user's pending liquid, the column's current substrate state).

**Behaviour**: walks the gather-list performing bsp() reads; fills the template with the gathered values; calls the LLM (or returns the filled template if mode=bypass); returns text + token cost.

**Failure modes**: missing slot → empty string; LLM error → bypass-fallback to raw template; timeout → return last partial.

**Used by**: soft-LLM Cmd+Enter (recipe = the soft-agent face block); medium-LLM commit (recipe = the medium-agent face block); future hard-LLM-replacement propagation (recipe = a propagation block).

### 2.3 — Verb dispatcher

**Block shape**: a verbs block where each digit = one verb, with `_` = name + hint, `1` = pattern (regex or simple prefix), `2` = primitive (string naming a known bsp-mcp tool or `bsp`), `3` = parameter extraction rules (which parts of matched input go where in the primitive call).

**Inputs**: user input string, current session context.

**Behaviour**: matches input against each verb's pattern; on match, extracts parameters per the rules and dispatches the named primitive with them; returns result envelope.

**Failure modes**: no pattern matches → fall through to "default" verb (e.g., dropMark); pattern matches but extraction fails → user-facing error.

**Used by**: Column.tsx handleSubmit, replacing the current big switch.

### 2.4 — Cycle walker

**Block shape**: an ordered list block where each digit = one operation, with `_` = name, `1` = condition (e.g., "session.is_anonymous = false" expressed as a small predicate language), `2` = primitive name.

**Inputs**: kernel session, callbacks.

**Behaviour**: per kernel tick, walks the digits in order; for each, evaluates the condition against session state; if true, runs the named primitive operation.

**Failure modes**: unknown primitive → log and skip; condition eval error → skip and warn.

**Used by**: BeachKernel.cycle() — when columns need different cycles (frame mode, archive mode, observer mode all elide certain ops). Lowest urgency; defer until needed.

### 2.5 — State-block walker

**Block shape**: any pscale block with digit children and optional weights. Walker takes (block, spindle | random-policy, P_att) and either resolves the spindle or generates one per the random policy.

**Inputs**: block, walker policy (deterministic-LLM | random-uniform | random-weighted | multi-agent), pscale-attention.

**Behaviour**: walks per the policy; at each open aperture (P_att < P_end), invokes the policy to pick the next digit; returns the resolved spindle and the leaf content.

**Failure modes**: walk hits a star → recurse via star resolver; walk hits an empty digit when policy expected content → return early with partial spindle.

**Used by**: any block that encodes state-machine geometry (per §15-17 of pscale-state-block.md): logic gates, game theory, probability sampling, RPG scenarios, governance ratification, decision trees. Generic substrate for procedural blocks.

---

## 3. Conventions and first-author blocks

The interpreters consume specific block shapes. Those shapes are encoded in a single conventions block plus a small set of first-author blocks. The conventions block IS substrate — Designer face can amend it (with discipline).

### 3.1 — Where conventions live

`(<beach>, "xstream-conventions")` — a single block per beach. Holds:
- block-shape conventions for each interpreter (§2)
- the canonical recipe shape
- the canonical verb shape
- the canonical cycle op set

The xstream client ships with a built-in copy that's used as fallback when the beach doesn't host one. When the beach has its own, the beach's overrides.

### 3.2 — The precedence policy block

`(<beach>, "xstream-settings", "_resolution-policy")` — a block describing how settings are looked up. Each digit = one layer to try, in order:

```
{
  "_": "Resolution policy — settings reader walks these in order, first non-null wins.",
  "1": { "_": "per-rendezvous", "1": "(<beach>, 'xstream-settings', '<address>.<setting-path>')" },
  "2": { "_": "per-frame",       "1": "(<beach>, 'xstream-settings', 'frame.<frame>.<setting-path>')" },
  "3": { "_": "per-user",        "1": "(<handle>, 'shell', 'settings.<setting-path>')" },
  "4": { "_": "per-beach",       "1": "(<beach>, 'xstream-settings', '<setting-path>')" },
  "5": { "_": "built-in default" }
}
```

Designer face can reorder the layers, add a layer, or remove a layer. The settings reader interprets this on every lookup. This is itself an L1 setting interpreted by the same reader, so the precedence policy is bootstrapped from the built-in default and then immediately overridable.

### 3.3 — First settings to author

When phase A lands, these settings move into substrate first:
- `vapour.staleness_ms` (12000)
- `liquid.staleness_ms` (60000)
- `poll_cadence_ms` (1500)
- `vapour.scope_default` (`everyone-here`)
- `inbox.needle_patterns` (`["@<handle>", "<handle>"]`)

Each is reachable via `useSetting('vapour.staleness_ms', 12000)`.

### 3.4 — First recipes to author

The medium-LLM recipes per face migrate to:
- `(<beach>, "xstream-recipes", "medium.character")`
- `(<beach>, "xstream-recipes", "medium.author")`
- `(<beach>, "xstream-recipes", "medium.designer")`
- `(<beach>, "xstream-recipes", "medium.observer")` (always bypass)

And the soft-LLM:
- `(<beach>, "xstream-recipes", "soft.<face>")`

Designer face can edit these to change how each face synthesises. Per-user override at `(<handle>, "shell", "recipes.medium.<face>")`.

### 3.5 — First verbs to author

The substrate verb table moves to `(<beach>, "xstream-verbs")`:
- `1`: `passport`
- `2`: `register sed:`
- `3`: `engage`
- `4`: `pool:` (deprecated; can drop)
- `5`: `keys`

Adding a sixth verb (e.g., `frame:create`) becomes block authoring, not TS editing.

---

## 4. Simultaneity — medium-LLM as collective synthesiser

This is the deepest property of medium-LLM and the one most under-served by the current code. It deserves its own section because it changes what the recipe runner (§2.2) does in the medium case.

### 4.1 — The current behaviour

Today, [Column.tsx](src/components/Column.tsx) `handleCommit` reads the user's OWN liquid slot from the substrate (via `peerLiquid.find(lp => lp.is_self)`) and synthesises only that into solid. The substrate has 9 slots per address — one per agent currently present — but the kernel reads only one of them at commit.

### 4.2 — The intended behaviour

Medium-LLM exists to synthesise **multiple simultaneous inputs**. Three (or N) users at the same address each contribute liquid; one of them hits commit; medium reads ALL liquid slots at that address, synthesises into one solid. The result captures the collective input, not just the committer's voice.

This turns the V/L/S loop from "personal commit-helper" into "convergent group synthesis." The substrate already supports it geometrically — beach:7.<address>.<digit> with one slot per present agent. What's missing is the gather-list at commit time and the clear-policy after.

### 4.3 — What changes

Medium-LLM gather-list (§1.2) is currently `pendingLiquid + context`. It becomes:

```
gather:
  - all_liquid_at_address: bsp(<beach>, "beach", "7.<address>", -1)
  - (filtered by staleness; map by agent_id)
  - context: marks, presence, frame, pool
```

The recipe template receives an array of slots (each `{agent_id, text, face, ts}`), not a single string. The template can iterate them ("Alice said X. Bob said Y. Carol said Z. Synthesise their convergence:") or aggregate them ("All inputs at this address: ...").

Clear policy after commit becomes a per-recipe choice:
- `clear_self_only` — current behaviour
- `clear_all` — collective synthesis absorbs all inputs
- `clear_with_consent` — only those agents who hit commit themselves
- `clear_referenced` — only slots whose text was actually used in the synthesis (LLM marks which it consumed)

Each option is a substrate-readable string in the recipe. Designer-editable.

### 4.4 — Commit gate (governance hook)

Today: anyone present can commit, fires immediately. For governance scenarios, this is wrong — a community might want N-of-M agreement before commit fires. The recipe gains a `commit_gate` field:
- `single` (default — first to commit wins)
- `quorum_<n>` — wait until N participants have hit commit
- `consensus` — wait until all present have hit commit
- `designer_only` — only Designer-face members can commit

The kernel honours the gate; the recipe (block) names it. New gate types = new code in the gate evaluator (small interpreter), not new TS in handleCommit.

### 4.5 — Implications

This single change (gather-list reads all slots; clear-policy per recipe; commit-gate per recipe) opens:
- Group brainstorming → commit synthesises the convergence
- Co-authored writing → medium produces unified prose from N drafts
- Voting → liquid contributions are votes; quorum gate fires; commit logs the tally as solid
- Treaty negotiation → multiple parties propose; quorum required; clear policy preserves dissent
- RPG group decision-making → players each contribute intent; medium narrates the resolution

All on the same V/L/S substrate. All editable by Designer. All federated.

This is the simultaneity insight made operational. The current handleCommit-reads-self is a vestigial linearity from when V/L/S was scoped to personal commit; the architecture's deeper purpose is the collective case.

---

## 5. Sequencing

Order of attack, with a clear "done" definition for each phase.

### Phase A: settings reader + precedence policy + first setting

**Build**: §2.1 settings reader, §3.2 precedence policy block, one setting (`vapour.staleness_ms`) migrated.

**Done when**: the kernel reads vapour staleness via `useSetting(...)` instead of the constant; Designer face can edit the per-user setting via the existing block editor and watch behaviour change without reload.

**Estimate**: half a day.

### Phase B: extend L1 to all current configurations

**Build**: migrate every L1 entry from §1.1 to substrate-readable, served via the same reader.

**Done when**: no `const VAPOUR_STALENESS_MS = ...` etc. in the kernel; all values come from substrate or built-in defaults via the reader.

**Estimate**: 1 day.

### Phase C: recipe runner + per-face recipes

**Build**: §2.2 recipe runner; soft-agent and medium-agent prompt assembly migrate from code to recipe blocks per face.

**Done when**: changing a face's prompt template via Designer face changes the LLM's behaviour on the next call without reload.

**Estimate**: 2-3 days.

### Phase D: collective gather-list (medium reads all liquid)

**Build**: §4 — medium-LLM recipe gathers all liquid slots at the rendezvous; clear policy and commit gate per recipe.

**Done when**: three browsers at the same address can each contribute liquid; one commits; medium synthesises across all three; clear policy honours the recipe.

**Estimate**: 2 days. THIS is the highest-leverage phase per "simultaneity rather than linearity."

### Phase E: verb dispatcher

**Build**: §2.3 verb dispatcher; verbs migrate from Column.tsx switch to a verbs block.

**Done when**: adding a new verb is a block edit (via Designer face), not a TS edit.

**Estimate**: 1-2 days.

### Phase F: cycle walker (defer)

Build only when columns genuinely need different cycles. Today they don't.

### Phase G: state-block walker

**Build**: §2.5 state-block walker. No specific use case in xstream-play yet — this serves any procedural block (RPG, governance ratification, simulation, decision tree) that the user or Designer authors.

**Done when**: a procedural block at e.g. `(<beach>, "rpg:dragon-encounter")` can be walked by the kernel and its leaves act as scripts.

**Estimate**: 2-3 days, dependent on what the first procedural block calls for.

---

## Outcomes

After phases A–D, xstream-play has:

- **Designer-editable settings** at three precedence layers (per-rendezvous / per-user / built-in)
- **Designer-editable LLM behaviour** per face (soft and medium)
- **Collective synthesis** across multiple agents' liquid at the same rendezvous — the V/L/S loop becomes a group-coordination primitive, not just personal commit
- **Commit gates** that turn the same V/L/S surface into governance, voting, brainstorming, or co-writing depending on the recipe
- **Federated discipline preserved** — beach owners author beach-level conventions, users author per-user overrides, no silent global commons

After phase E, adding a new substrate verb is a Designer-face act, not a code change.

After phase G (independent of E), xstream-play hosts authored procedural blocks (RPGs, simulations, governance processes) without per-scenario code. The state-block walker is the runtime; the geometry is the program.

The Designer face is not a kind of LLM. It's the same soft + medium operating on substrate-policy blocks instead of substrate-content blocks, with the face-gate determining write scope. The block IS the language; bsp() is the only tool needed; the kernel walks the substrate.

---

## What's NOT in scope

- Hot-loading LLM-emitted JS into the running app. Substrate-authored blocks interpreted by fixed code is much safer and equally expressive.
- Replacing React reconciliation, browser APIs, or substrate I/O with blocks. These are runtime mechanics, not policy.
- Per-component bespoke configuration (e.g., button icon set in a block). Components are surface; surface is reflexive of substrate; component internals stay code.
- Bespoke "Designer LLM toolset." The standard six bsp-mcp primitives are sufficient — Designer-face just receives different context and write scope.
- Hard-LLM as a tier. Replaced by recipe-driven star-walk propagation; lives in the same recipe runner with mode = `propagate`.

---

## Why this matters beyond xstream

Every section above generalises. A community on this substrate can author its own:
- Settings (how their coordination space behaves)
- Recipes (what their soft and medium do)
- Verbs (what shorthand commands their members use)
- Procedural blocks (their games, governance processes, decision trees)

All federated. All sovereign per beach / per community. All edited via the same Designer face the xstream client provides today.

xstream-play is the reference implementation of this pattern. The substrate-as-program direction makes it a *toolkit* for federated coordination — V/L/S happens to be the canvas, but the underlying mechanism (interpreters reading substrate-authored policy) serves any rule-bound process. Governance is the high-stakes case; chat / brainstorm / RPG are the immediate test cases.

The line between code and pscale isn't a technical question — it's the question of what the kernel knows by being shipped vs. what it learns by reading. Phase A starts the answer; phase D demonstrates the value; phase G generalises it.

---

## Appendix — Environmental checks before phase A

Six pre-flight checks worth running before any phase starts. They give 80% of the predictive insight at zero implementation cost. Three are data-gathering against live infrastructure; three are design pinning that goes back into this document.

### Branch strategy per phase

Risk-tiered, not all-or-nothing:

| Phase | Risk | Where | Why |
|---|---|---|---|
| A (settings reader + 1 setting) | very low | current branch direct | half-day work, single hook, easy `git revert` |
| B (generalise L1) | low–medium | current branch direct | each setting migrates independently; per-commit revert |
| C (recipe runner) | medium | sub-branch `feature/recipe-runner` | changes soft + medium prompt assembly; preview URL before xstream.onen.ai |
| D (collective synthesis) | **high** | sub-branch `feature/collective-synthesis` | multi-user race conditions; needs orchestrated 3-browser testing |
| E (verb dispatcher) | low after C–D | current branch direct | pattern established; verbs independent and per-verb revertable |
| F (cycle walker) | defer | n/a | only build when needed |
| G (state-block walker) | low (independent) | sub-branch `feature/state-block-walker` | new affordance; doesn't touch existing UX |

Pattern: anything that changes user-observable existing behaviour → sub-branch with preview URL. Anything additive or per-item revertable → direct.

### Data-gathering checks (run against live infra)

**Check 1 — Substrate call-volume baseline.** Instrument the kernel for one minute at typical load. Count federated requests per active column per second. Project post-phase-A (settings reads × precedence depth) and post-phase-D (gather across all liquid slots). If projected load exceeds 10 reqs/sec per column, caching strategy needs to be tighter than the default below.

**Check 2 — Vercel KV headroom.** Open the xstream-play project's Vercel dashboard → Storage → KV. Note current requests/day and bandwidth. If at <30% of limits, substrate-as-program is comfortably affordable. If at >70%, design phases A–D with caching as a hard requirement, not an optional optimisation.

**Check 3 — Supabase realtime headroom.** Open Supabase project → Realtime. Note concurrent connections and message rate. The vapour transport already uses this; phase D doesn't add to it. But if we're near limits already, vapour scope partitioning (per-grain channels etc.) becomes urgent.

### Design pinning (go into this document, not code)

**Check 4 — Reader cache strategy.** Decision pinned now: **TTL = 10s for settings; no cache for liquid/marks/presence.** Settings change manually via Designer face; 10s lag is invisible. Liquid/marks/presence are the realtime stream — staleness windows already absorb their refresh cadence; an additional cache would just add confusion.

**Check 5 — Race-condition semantics for phase D.** Pinned cases:
- A and B both typing; A submits liquid, B is mid-keystroke; A commits 1s later. **B's vapour-not-yet-submitted is NOT included.** Only liquid is gathered.
- A and B both submit liquid 100ms apart; A commits at +500ms. **B's liquid may or may not be in A's read** depending on poll timing. This is acceptable for brainstorm and group-write use cases. For governance, recipes MUST set `commit_gate: quorum_n` to make timing deterministic.
- A commits with `clear_all` policy; B is still typing more for THEIR liquid slot. **B's liquid slot gets clobbered.** This is the exact reason `clear_all` is opt-in per recipe. Default is `clear_self_only`.
- Recommendation: governance recipes use `commit_gate: quorum_<n>` + `clear_referenced` (only slots actually used in synthesis are cleared). Brainstorm recipes use `commit_gate: single` + `clear_all` (collective absorbed). Co-writing recipes use `commit_gate: single` + `clear_self_only` (each author retains autonomy over their own slot).

**Check 6 — Versioning convention.** Pinned now: every conventions block carries `9.version: <semver-string>`. Interpreter accepts a range; reads outside range fail loud with a user-visible "convention version <X> not supported by this client; please update." This prevents Designer-authored shape drift from silently mis-interpreting at the kernel.

### Block-size projection (run during phase A)

A sanity check, not pre-flight: once the conventions block is sketched (during phase A), measure its JSON size when fully populated through phase E. If >100KB, slice into sub-blocks per category. If >500KB, the conventions-as-one-block model is wrong and we revisit.

### Pre-flight checklist

Before phase A starts:
- [ ] Check 1 (call-volume baseline) — instrument-and-measure, ~30 min
- [ ] Check 2 (Vercel KV headroom) — dashboard read, ~5 min
- [ ] Check 3 (Supabase realtime headroom) — dashboard read, ~5 min
- [x] Check 4 (cache strategy) — pinned above
- [x] Check 5 (race-condition semantics) — pinned above
- [x] Check 6 (versioning) — pinned above

Result: substrate budget known, transport budget known, collective-synthesis semantics fixed at the design level, cache + versioning policies pinned. Phases A through E proceed with no remaining open architectural questions.
