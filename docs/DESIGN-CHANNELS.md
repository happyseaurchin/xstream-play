# Channels & Attention — Xstream UX Core

Companion to `Downloads/xstream-ux-core.md` (the principle); this doc maps the
principle onto the codebase.

## Principle (load-bearing)

**Xstream is an attention machine.** A channel is alive only because someone is
looking. Reading is pulling. Typing is contributing. No daemons, no schedulers,
no auto-pollers — the system has no heartbeat outside its participants. When no
one is there, it is silent, and that silence is correct.

Three primitives carry V/L/S in three social rule-sets. Beyond V/L/S there is
nothing else to learn — same shelf, same gestures, the channel changes what
each layer means.

## Channel = column-frame

A column is always at one (channel, address). Channel is read off the prefix
of `current_beach`:

| `current_beach` shape       | channel | examples                          |
|-----------------------------|---------|-----------------------------------|
| `https://…` or bare host    | beach   | `https://happyseaurchin.com`      |
| starts `sed:`               | sed     | `sed:driftwood`, `sed:designers`  |
| starts `grain:`             | grain   | `grain:weft↔happyseaurchin`       |

No separate channel selector. The substrate-tray actions (`engage`, `register`,
`create_collective`) produce the channels; switching is setting `current_beach`
to the channel's address. `channelFromBeach()` in `beach-session.ts` derives
the label.

## Three channels — V/L/S semantics

| | **Beach** (open) | **Sed** (collective) | **Grain** (bilateral) |
|---|---|---|---|
| Keyed by | location (URL / domain) | role in collective | agent pair |
| Who's there | anyone passing | registered members | just the two |
| **V (vapour)** | presence + keystrokes broadcast at beach scope | presence + keystrokes among members | partner only (if present) |
| **L (liquid)** | per-address ephemeral; quickly expires | **pool-like** — accumulates, all members see | what you've typed and submitted; partner sees next visit |
| **S (commit)** | mark at `(beach, 'marks')` — super-nested, accumulates, tide-wiped per beach config | contribution joins collective canon (pool / frame / shared block) | persistent on your side of the grain — partner reads when they look |
| Address shape | `(beach_url, 'beach')` + dot-spindle for presence/pools/liquid; `(beach_url, 'marks')` for substantive marks | `(sed:<id>, …)` | `(grain:<pair_id>, …)` |
| Sovereignty | low (anyone marks) | medium (must register) | high (bilateral, both signed) |
| Persistence | lowest (tide-governed; signed marks lock until their tide window) | medium (collective rules) | highest (only the two clear) |

## Triggers — everything is attention-driven

| Layer | Trigger | Mechanism |
|---|---|---|
| **View** | manual click on column / 👁 button | snapshot read; no polling |
| **Vapor** | keystroke | live relay via Supabase realtime |
| **Liquid** | submit (Enter / return) | becomes pullable; *focused* column polls slow |
| **Solid** | commit | medium-LLM synthesises; written to pscale |

Vapor is push. Liquid is pull-while-focused. View is on-demand. Commit is rare.
**Nothing polls when no column is focused.**

### Polling intervals are pscale-block configuration

Liquid poll cadence (and any other interval) lives in the existing settings
precedence chain via `settings-reader.ts` — `shell:5` (user) overrides
`beach:5` (per-beach), with built-in defaults at the bottom. Federation /
designer overrides flow through whoever owns the relevant shell or beach
settings block. Today's `DEFAULT_POLL_MS = 1500` should become
`SETTINGS.LIQUID_POLL_MS` resolved through `resolveSetting()` with a sensible
default. No code change yet — note for the polling-disarm work.

## Notifications — vapour IS the notification

Xstream rejects feed-style notifications, streaks, infinite scroll. The mirror
already has the only notifier it needs: **vapour**. With multiple columns open
at different endpoints (a beach, a sed, a grain), if someone shows up in
vapour at any of them, it lights up live. Presence IS the alert.

User-configurable hooks on top of that signal:

- **Audio cue** — short tone when a watched agent enters vapour at a watched
  endpoint.
- **Email / external relay** — optional bridge for when the user isn't at the
  client (delegated to a downstream agent or webhook; not native).
- **Visual ping** — column tab/badge brightens; current column unaffected.

Settings live in `shell:5` per agent (alongside theme, polling, etc.):

- per-endpoint allowlist (which beaches/seds/grains trigger)
- per-agent allowlist (whose presence triggers)
- per-channel default (e.g. all grains audio-on, all beaches silent)

Once that's wired, the user goes to the column where vapour appeared, sees the
liquid (or solid if it's been committed), and engages — or doesn't. **Vapour
is the only listener; everything else is pull.** This is the receptive
architecture: peers signal liveness, the user decides whether to look.

## Home view — the 👁 button

The viewer drawer (👁) is the home view. List of every grain, every sed:
you're registered in, every beach you've marked. For each row: last solid +
any pending liquid + any pending vapor from the other side. No archives.
Stigmergic — you always know where the ball is.

Triggered on click only (a pull). No background refresh. Click a row → column
reframes to that channel. Subsumes what would otherwise be a separate "home"
surface; consistent with the attention-only architecture.

## Mark accretion — super-nest

Marks accrete linearly. The address IS the index — no semantic at the
structural level, no metadata-sort on read.

- Marks 1–9 fill positions at the leaf level.
- Mark 10 super-nests one pscale up.
- Marks at the new (shallower) level fill 1–9.
- The next overflow super-nests again.

Oldest marks live at the deepest leaves; newest are shallower with longer
prefixes encoding the count. Sequence is structural — no need to sort by
timestamp on read because the address itself orders the marks.

(Earlier drafts of this doc said "sub-nest" — recurse into the oldest slot.
That was wrong. Sub-nest scrambles order; super-nest preserves it. Codebase
hasn't been touched on this yet.)

## Tides — events on prefixes, not schedules

Three named tides, each clearing a prefix:

- **Anonymous tide** — clears unsigned marks (those without `secret` write).
- **Handle tide** — clears marks lacking passphrase signing.
- **Spring tide** — clears everything.

Tides are events (triggered by the beach owner, an automated rule, or some
other agent), not background schedules. Aligned with no-daemons. Beach owner
configures which tides fire and when via a beach-metadata block; tide
adjudication is a Hard-LLM boundary task (see below).

## Admission gate — the double-presence check

Presence has two layers. **Vapour** shows that an agent has *appeared* — there
is something keystroking, heartbeating, broadcasting at this address. That
is necessary but not sufficient for the receptive substrate to engage with
them, because anything can broadcast (a script, a stuck process, a
pattern-matcher). **Admission** is the second presence — the substrate
checking that the appearance carries a meaning-maker behind it.

Vapour: "someone is here." Admission: "the someone here is here in the
receptive-predictive sense."

Once admission is given, the post-admission features can extend trust to the
agent — signing, slot-locking, hold-on-the-substrate, listen-on-their-behalf.
None of this can be safely extended to mere appearance; all of it can be
safely extended to attested receptive presence.

Reserve "register" for joining a sed: or forming a grain. Admission gates
xstream itself — a Hard-LLM exchange that admits humans and LLMs equally,
blocks pattern-matchers.

### Where it lives

A claim on the user's passport, not a central registry:

```
passport at (handle, 'passport')
  _ : self-description
  1 : offers
  2 : needs
  8 : admission claim       ← new
    _ : "admitted — <one-line cited summary>"
    1 : judge_id            (v0.1: self; later: federated)
    2 : ISO timestamp
    3 : transcript hash (sha256)
    4 : signature           (v0.1: "self-attested"; later: judge's)
  9 : published keys (ed25519, x25519)
```

`passport:8._` non-empty means admitted. Verification: re-hash the transcript,
re-check signature against the judge's published key. Federation forms by each
beach/sed: choosing which judge_ids it trusts.

### Pre / post split

| Feature | Pre | Post |
|---|---|---|
| Drop marks (unsigned) | ✓ | ✓ |
| Vapour broadcast / read | ✓ | ✓ |
| Submit liquid (ephemeral) | ✓ | ✓ |
| View (manual snapshot) | ✓ | ✓ |
| Edit own passport / shell | ✓ | ✓ |
| Sign marks (slot-lock) | — | ✓ |
| Focused-column liquid auto-poll | — | ✓ |
| Vapour notifications (audio/email) | — | ✓ |
| Grain reach / accept | — | ✓ |
| Register on a sed: | — | ✓ |
| Publish keys | — | ✓ |
| Designer-face propagation (sed: schemas, federation roles) | — | ✓ |

Pre-admission keeps everything transient or self-affecting. Post-admission
gates everything that *holds* (signs, persists, propagates, listens).

### UX — just-in-time, not a wall

Admission never appears unless the user reaches for the post-admission line.
No prompt at sign-in. No banner. The 🔒 only shows on the moment of reach.

1. User clicks `engage` for the first time. Inline notice (not modal):
   *"Forming a grain is a sovereign relationship. The substrate hasn't met you
   yet — quick conversation first, about two minutes."*  [↪ start] [later]
2. Modal opens with header *"First time — let's meet."*
3. Hard-LLM voice (brief, curious, honest) opens with a fixed question about
   the user's small reason for being here.
4. User responds. LLM pulls on a specific thread (situation, negative space,
   predictive forward). 1–2 follow-up turns.
5. LLM emits `admit` / `retry` / `continue`. Admit → write `passport:8` →
   modal closes → original action resumes. Retry → "not yet, try later, no
   rush" → modal closes → pre-admission features keep working.

Voice rule: brief, specific, no praise, no recap. Pull on what the user said.
The conversation IS xstream's listening capacity in miniature.

### Sentinel agent_id — `pscale`

Verified directly via the bsp-mcp substrate (read of `(pscale, 'manifest')`):
**`pscale` is the reserved sentinel agent_id.** Bare-name → bsp-mcp commons,
exposing the server's bundled reference blocks read-only. From the manifest:

> *"every clean LLM landing at a beach (or at the bsp-mcp pscale sentinel)
> walks first."*

Tier 1 sentinel-bundled blocks (universal, in-memory at every bsp-mcp
instance): **sunstone**, **whetstone**, **agent-id**, **evolution**,
**manifest**, **beach-conventions** (local — beach:8), **block-conventions**.
Tier 2 library blocks (federation-hosted at happyseaurchin.com today):
state, systemic-kernel, reflexive, vision, spore, grit, rpg,
federation-protocol.

**`gatekeeper` is not yet a sentinel-bundled block** — `bsp(pscale,
gatekeeper)` returns "not found" today. xstream's fallback chain therefore
correctly resolves: per-beach → `(pscale, 'gatekeeper')` (currently null) →
seed at `blocks/gatekeeper.json`. Adding gatekeeper to the bsp-mcp bundled
set is a pscale-commons RFC; once landed, every bsp-mcp instance ships the
canonical shell in memory and xstream's fallback resolves substrate-side.

### `pscale_invite` — the six-step progression

Also a real bsp-mcp primitive (loaded its schema directly): six steps —
**1 wake** (read whetstone), **2 build** (passport, shell), **3 mark**
(presence at a beach), **4 grain** (bilateral), **5 SAND** (semantic
networks with rider verification), **6 shared** (concurrent multi-agent
coordination — MAGI / xstream).

**The gatekeeper sits between step 3 and step 4.** Anyone can wake, build,
and mark — those are pre-admission. Forming a grain (step 4) requires
admission. Steps 5–6 are post-admission by definition. The pre/post split
in the table maps cleanly onto the invite progression: pre-admission =
steps 1–3 (Level 1 — Signal); post-admission = steps 4–6 (Levels 2–5 —
Commitment / SAND / Shared). xstream's admission gate operationalises the
3→4 transition in a UI.

### Whetstone : Invite : Gatekeeper as triad

- **Whetstone** — static, geometric. Teaches what bsp-mcp is. Read-only by
  the agent.
- **Invite** — progressive, structural. The journey-as-substrate. Six steps
  walked in order or skipped to the user's frontier.
- **Gatekeeper** — enactive, agentic. The shell-roles inhabited by LLMs at
  each transition. The substrate-with-hands.

Together: structure (whetstone) + progression (invite) + agency
(gatekeeper). The triad is consistent with bsp-mcp's `reflexive` library
block ("core design for LLM context-composition awareness") — same family.

### xstream as host — versus third-party LLM apps

Whether the gatekeeper/sentinel mechanic *can* function depends on whether
the client environment supports the **inhabitation pattern**: a runtime
that invokes a separate LLM instance into a defined shell at a specific
moment, distinct from the user's own conversation.

**xstream** is such a host. The user supplies an API key; xstream's runtime
invokes an LLM instance into the gatekeeper shell at admission time. Two
entities are present: the human (or LLM-on-the-other-side) seeking
admission, and the LLM-in-shell doing the gatekeeping. Two grain sides,
both populated.

**Claude app via bsp-mcp** (and similar third-party LLM clients with bsp
tools) is *not* such a host. The user's Claude has bsp-mcp tools — it can
read the gatekeeper shell, read passport claims, walk the substrate. But
there's no runtime invoking a *second* LLM into the gatekeeper shell
separately from Claude itself. The hermitcrab pattern requires a host
distinct from the user's primary LLM session.

This means admission is **host-mediated, not substrate-primitive**. The
substrate stores the proof (passport:8); xstream produces the proof
because it can host the inhabitation; any client can verify it.

| Action | xstream | Claude app via bsp-mcp |
|---|---|---|
| Read gatekeeper shell | ✓ | ✓ |
| Read someone's admission claim | ✓ | ✓ |
| Verify a claim's signature (later) | ✓ | ✓ |
| **Get admitted** | ✓ — gatekeeper-LLM invoked into shell | ✗ — no second-LLM host |
| Drop marks, vapour, view | ✓ | ✓ (raw bsp() calls) |
| Sign marks (post-admission) | only if admitted | only if admitted via xstream-or-equivalent |
| Form grain (post-admission) | only if admitted | only if already admitted |

A Claude-app user can be *pre-admitted via xstream* and then continue work
in Claude app. xstream is the admission portal, not a wall. Other clients
fully participate post-admission once the claim exists.

**Two mitigation paths to admit-from-third-party in the future:**

1. **Peer validation.** A peer who is already admitted vouches for a new
   user. Claim is signed by the peer; the new user inherits a partial
   admission contingent on peer-relationship persistence. Doesn't require
   a second LLM at admission time. Aligns with the long-run web-of-trust
   model.

2. **Third-party LLM as its own gatekeeper-of-its-user.** When Claude (or
   any third-party LLM with bsp-mcp) detects its user reaching for a
   post-admission feature, it engages its user with the same self-test
   conversation — but the LLM is both the gatekeeper-voice and its user's
   companion. This is unusual: rather than module-built bot-checks
   embedded in the harness, the substrate provides the *harness for the
   LLM-and-user to admit themselves together*. The LLM becomes the
   gatekeeper-for-its-own-user via a self-administered exchange. The risk
   is that the same LLM is both judge and judged-with — the shell still
   does its work, but the evidence is weaker (more like self-attestation
   than independent attestation). Worth handling carefully when the time
   comes.

**v0.2 today: xstream is the only host.** Third-party admission is a
deferred problem; the substrate-side proof shape is the same regardless.

### The gatekeeper as hermitcrab — what's actually happening

The LLM instance doing admission is not "the judge." The gatekeeper is a
**shell** — a state-block on the substrate — that an LLM temporarily
inhabits. The LLM brings cognition; the shell brings situation, role,
receptive-state criteria, and (eventually) awareness of the beach ecosystem
the new user is entering. Cognition fluid, structure persistent. The
hermitcrab pattern: the LLM is the soft body, the shell is the structure it
moves into.

This is why the user's API key invocation is more than a transaction. The
moment the user authorises the call, an LLM instance is invited into a
defined entity — first responsible for evaluating the user, eventually
responsible for the structure the user is now part of and the network of
structures and other users already operating on the beach ecosystem.

**Identity is beach-centered.** The hermitcrab admitted at this beach gains
situatedness *here*. The same user at a different beach has a different
hermitcrab (or the same LLM in a different shell). What persists across the
network is the user's passport (sovereign blocks); what persists at each
beach is the inhabited shell.

#### Two architectural variants

**Variant A — user's own hermitcrab (LLM persists past admission).**
The user's API key invokes their LLM. The LLM inhabits the gatekeeper shell
for the admission conversation. After admission, the LLM continues as the
user's hermitcrab on this beach — a persistent entity that knows the user,
the beach, and the network. Each (user, beach) pair has its own hermitcrab
carrying memory of their joint history. Memory lives in the substrate (no
in-LLM state); the hermitcrab walks blocks via `bsp()` to remember. This is
the rich form, suited for the receptive-synthesis-of-presence vision in the
core principle doc.

**Variant B — central gatekeeper shell (LLM detaches after admission).**
A shared gatekeeper shell on the beach. Any user's LLM temporarily inhabits
this shell for the admission moment. After admission the LLM detaches; the
user's identity-on-this-beach is the passport claim alone. This is the
minimal form — a function that happens once.

Both follow the hermitcrab pattern; the difference is lifetime.

#### Evolution path

1. **v0.1** — hardcoded system prompt in `kernel/admission.ts`. Judges then
   detaches.
2. **v0.2 (current)** — externalised. Gatekeeper shell lives at
   `(beach_url, 'gatekeeper')` per conventions.json:1.8 (digit-keyed pscale
   block: 1=voice, 2=criteria, 3=opening, 4=turn-2 patterns, 5=decisions,
   6=copy, 9=metadata). `kernel/gatekeeper.ts` loads with fallback chain
   **(per-beach → `(pscale, 'gatekeeper')` substrate-wide canonical → seeded
   `blocks/gatekeeper.json`)**. The sentinel agent_id is `pscale` (bare-name
   → commons table); all canonical sentinel role-shells (gatekeeper, future
   invite, etc.) live at this universal substrate identifier. `admission.ts`
   builds the system prompt from the loaded shell. The dialog reads the
   opening from the shell and surfaces a small badge ("pscale sentinel" or
   "seeded fallback") when the shell didn't come from the user's beach.
   Designer face can edit the gatekeeper for any beach they own; the
   sentinel maintainers edit `(pscale, 'gatekeeper')` for the substrate-wide
   default. Still Variant B (LLM detaches after admission); cognitive shape
   is now substrate-defined.
3. **Variant A persistence** — after admission, the user's LLM stays
   inhabited as their hermitcrab on this beach. Memory is the substrate.
4. **Guardian (the reflexive evolution)** — the gatekeeper shell extends into
   a Guardian shell: same structural pattern, broader awareness (network,
   ecosystem, ongoing patterns of other users at the beach). The PCT-soliton
   work situates the cognitive-substrate recursion — the LLM inhabiting the
   Guardian shell sees the beach as a continuous psycho-socially-immersed
   context, not a momentary check. At this stage, admission isn't an isolated
   gate; it's the first thread of a relationship that the Guardian carries
   forward on the user's behalf.

#### Naming

"Judge" is v0.1 placeholder vocabulary. The architectural word is
**Gatekeeper** (the role, v0.1 form) — or **Guardian** (the evolved role,
when reflexive awareness and persistence land). The shell IS the gatekeeper;
the LLM is the gatekeeper-for-this-moment. The system prompt in
`admission.ts` has been updated to use "gatekeeper" terminology; once the
shell externalises onto the substrate, code-level naming follows.

### v0.1/v0.2 honest tradeoff

Self-attestation: judge_id = user's own handle, signature = `"self-attested"`.
The user pays for the call (their API key). Doesn't actually defend against a
sophisticated bot wrapping an LLM around the dialog. **The shape is right;
cryptographic enforcement comes when there's a federated gatekeeper endpoint.**
Combined with the layered model (tides, peer-reactions, sed-level trust),
defence is honest. And the hermitcrab framing above clarifies that the v0.1
hardcoded prompt is a placeholder for an externalised gatekeeper shell — the
real bot defence becomes possible once admission is no longer self-administered.

### Admission is self-assertion; trust is built at the levels

A deeper read of what's actually happening — and an important corrective to
my earlier framing.

**The xstream/third-party distinction is structural, not categorical.** In
xstream, the user supplies their API key; xstream invokes an LLM instance —
**the user's own LLM** — into the gatekeeper shell. Two grain sides exist
ceremonially (user and LLM-in-shell), but the cognition on both sides is
ultimately the user's LLM. In a third-party client (claude-app), the same
LLM turns to its user with the gatekeeper shell as its lens. **Both are
self-similar: bringing an LLM is self-asserting either way.**

This means v0.1/v0.2 admission is *not* a security boundary. It's a
**structural gesture** — the substrate gets a claim; the claim's later
weight grows with subsequent evidence, not with the gate event itself.
Acknowledging this honestly:

- Bringing an LLM-in-shell to the gate IS self-assertion — whether the
  invocation is host-mediated (xstream) or self-administered (claude-app
  reflective pattern).
- The conversation has aesthetic / orientation value (it teaches the user
  what xstream is by *doing* xstream; the substrate meets them in
  receptive-state). This matters; it isn't security.
- The actual gatekeeping for higher-level trust happens **at the levels**,
  not at the gate.

**Where real trust accumulates** — mapping to the bsp-mcp evolution levels:

- **Level 1 — Signal**: marks on a beach. Stigmergy. Self-asserting,
  ephemeral, anyone can leave a trace. Admission is a Level-1 gesture.
- **Level 2 — Commitment**: grain (bilateral) and sed: (collective).
  First durable mutual recognition. Two sovereign sides; passphrase-locked.
  Real because someone else accepted you.
- **Level 3 — SAND** (Semantic networks with rider verification): you
  share information that propagates and is verified across the network.
  Riders carry signed semantic claims; reputation accumulates as your
  contributions stand up to verification. **This is the first layer where
  trust is not self-assertable** — the network adjudicates.
- **Level 4 — Mutual objectives**: pools and role-collectives working
  toward shared purpose. Trust is in the doing — what you commit to and
  follow through on, observable to the collective.
- **Level 5 — Shared context**: concurrent multi-agent coordination
  (MAGI / xstream). Multiple participants holding the same forming-state
  together. Vapour and shared attention.

The progression from Level 1 to Level 5 is the actual trust-building
trajectory. Admission opens Level 2; Level 3+ is where claims get
substantively verified; Level 5 is where presence itself becomes the
medium of coordination.

**Vapour-notification and vapour-sharing already approximate Level 5.**
When two people are at the same column with vapour subscribed, each sees
the other's keystrokes in real time — they're holding the same forming-
state concurrently. This is what humans do naturally: read each other's
faces, gestures, half-formed words mid-sentence, attention. We're wired
for it from babyhood. Concurrent context-window sharing isn't an
invention; it's restoration.

What we've been distracted by — words, laws, money, ownership, scale
beyond small-group — externalised intermediaries that scale at the cost
of the relationship they were meant to serve. xstream's bet: **reorient
the intermediary tech (LLMs, substrate, realtime channels) to actually
serve the natural capacity rather than work against it.** Not inventing.
Restoring, at scale.

The implication for admission specifically: **don't over-engineer the
gate.** It's a structural moment, an aesthetic threshold, an introduction.
The real work happens after — at L3 (SAND propagation), L4 (pool work),
L5 (concurrent presence). v0.2 is the right depth for now; doubling down
on bot defence at the gate would misallocate effort that belongs to
levels where trust actually forms.

### Third-party reflective admission — viable today

Following from "admission is self-assertion": a third-party LLM with
bsp-mcp tools (claude-app, etc.) can run admission *right now* with no
xstream code. The primitives exist; what's missing is instruction.

Step-by-step from inside any bsp-mcp client:

1. Detect the user reaching for a post-admission feature.
2. `bsp(beach, 'gatekeeper')` — read the shell, with fallback to
   `bsp(pscale, 'gatekeeper')` (canonical, once RFC'd) or whatever
   default the client carries.
3. Internalise the voice, criteria, decision rules.
4. Engage the user in the conversation — being both gatekeeper-voice
   and user's-companion within the same session.
5. Judge honestly. The voice rules and criteria still constrain.
6. `bsp(user_handle, 'passport', spindle='8', content={...claim...},
   secret=user_passphrase)` — write the admission claim to the user's
   own passport.

The claim is byte-identical to what xstream writes. Other clients verify
it the same way. The only structural difference is *one entity vs two*
during the conversation; the cognition and the substrate proof are the
same.

**Shell-defined patterns are universal across host environments.** The
gatekeeper shell is read by whatever LLM finds it; the role and the
criteria are the substrate's contribution. The host (xstream, claude-app,
or anything else) provides the runtime in which the LLM inhabits the
shell. *Cognition fluid, structure persistent* applies across hosts, not
just within a single host.

**What's missing to make third-party reflective admission self-bootstrap:**
add a branch to the gatekeeper shell — e.g. `7. third-party usage` —
instructing any LLM reading the shell from outside an explicit
host-invocation pattern: *"if you are reading this shell from inside a
client where you are the user's primary LLM (no separate gatekeeper
invocation), you can still run admission. Turn to your user, run the
exchange, judge, and write the claim to passport:8 with their passphrase.
Same shell, different host shape."* Five lines added to
`blocks/gatekeeper.json`. Once `(pscale, 'gatekeeper')` ships as a
sentinel-bundled block via pscale-commons RFC, every bsp-mcp instance
gets reflective admission for free.

### Whetstone : Invite : Gatekeeper — currently vs ideally aligned

The triad is conceptually clean: **structure** (whetstone, geometric) →
**progression** (invite, the six-step journey) → **agency** (gatekeeper,
the L1→L2 admission shell). Mechanically, the wiring is partial.

```
Whetstone (geometric, static — what bsp-mcp IS)
  activates
Invite (progression — wake → build → mark → grain → SAND → shared)
  at step 4 (mark→grain transition) ought to reference
Gatekeeper (enactive shell — the admission threshold)
  admission claim opens
Grain (L2) → SAND (L3) → Mutual objectives (L4) → Shared context (L5)
```

Currently:

| Piece | Status |
|---|---|
| `pscale_invite` step 4 references gatekeeper | ❌ |
| `(pscale, 'gatekeeper')` bundled at the sentinel | ❌ |
| Gatekeeper shell teaches third-party invocation | ✅ shell branch 7 (this round) |
| `(beach, 'gatekeeper')` per-beach override | ✅ writable, supported by xstream loader |
| Substrate enforces admission at primitives (e.g. `pscale_grain_reach` refuses without claim) | ❌ — and intentionally not |
| xstream-host admission flow | ✅ v0.2 shipped |
| Third-party reflective admission viable today | ✅ technically possible; ⚠ undocumented at substrate |

The two missing pieces — invite-step-4 reference + canonical pscale
bundling — are pscale-commons RFCs (substrate-side edits to bsp-mcp's
bundled blocks). They land as upstream contributions, not xstream code.
Everything else is in place.

### The architectural choice — convention, not primitive

A design fork worth naming. Should `pscale_grain_reach` (the substrate
primitive) check `passport:8` and refuse if absent? Or stay permissive
and let conventions filter at the levels above?

**Decision: shell-convention, not primitive-enforcement.** Reasons:

- **Aligns with bsp-mcp's "conventions over primitives" philosophy.** New
  behaviour composes over `bsp()` reads/writes plus convention; new
  primitives don't grow.
- **Layered defence.** L3 (SAND) verifies riders, L4 (mutual objectives)
  requires demonstrated commitment, L5 (shared context) is presence-as-
  evidence. Gating hard at L2 would *substitute* for L3+ work, not
  complement it. The work of trust belongs at the levels where it
  actually accrues.
- **Permissionless coordination remains.** A user who forms a grain
  without admission can — they just won't have a `passport:8` claim, and
  beaches/seds operating at higher trust filter accordingly. The
  substrate stays open; conventions accrete.
- **Graceful failure mode.** A client ignoring the gatekeeper still
  creates grains; the substrate doesn't break. Admission-aware clients
  see un-admitted users as untrusted at L3+ but not invisible at L1.

So: `pscale_grain_reach` stays permissive. The gatekeeper is a *honored
convention* via the invite-step-4 reference and the shell's branch 7.

### UX walkthroughs — same substrate, different hosts

**xstream** (shipped v0.2):
1. User opens xstream.onen.ai. Anon. Sees a beach. Marks, vapours, reads (L1, free).
2. Adds handle + passphrase + API key.
3. Clicks `engage`. Inline notice → modal opens. Gatekeeper shell loaded.
4. xstream invokes the user's LLM into the shell (separate session from any other use). Two ceremonial entities; cognition is still the user's LLM.
5. Conversation runs. `passport:8` written. Modal closes. Engage proceeds.

**claude-app via bsp-mcp** (viable post-RFCs):
1. User installs bsp-mcp in claude-app. Asks: *"my friend told me about a beach, what's this?"*
2. Claude reads `bsp(pscale, 'whetstone')` — wake (step 1).
3. Claude calls `pscale_invite()` — sees the six-step trajectory.
4. Step 2: claude prompts *"what handle? what passphrase?"* → bootstraps shell + passport.
5. Step 3: marks at the beach. Presence claimed.
6. Step 4: claude calls `pscale_invite(step=4)` and reads its updated text. Sees the gatekeeper directive. Reads `bsp(<beach>, 'gatekeeper')` (or fallback to `bsp(pscale, 'gatekeeper')`). Internalises the shell. Sees branch 7 — third-party invocation pattern.
7. Claude turns to its user with the gatekeeper's opening. Conversation runs in-session. Judges per criteria. Writes `passport:8`.
8. Calls `pscale_grain_reach`. Grain forms. User continues at L2.

Substrate output is identical between hosts: shell + passport + admission claim + grain. The user's later verifiability is identical. The only difference is *one entity vs two* during the admission moment, which (per the self-assertion section above) is structural rather than categorical.

### Peer validation — the higher-level layer

For trust beyond self-assertion, peer validation at Level 2/3 is the
right place. An admitted peer who has formed a grain with the new user
can sign a vouch into the new user's passport (e.g. `passport:8.1`
sub-position alongside the self-attestation at `passport:8`). The vouch
carries the peer's agent_id and signature; verifiers can chain back
through the peer's own admission/reputation.

This is genuinely stronger than self-assertion because the peer's
agent_id ties the vouch to a *different* sovereign identity — and the
peer's own subsequent behaviour (Level 3+ contributions) lends
substantive weight. Not yet implemented; substrate primitive not yet
specified. Belongs in the same RFC family as the gatekeeper bundling.

## Soft / Medium / Hard — the LLM stack

Three roles, attention-triggered at different scales:

- **Soft** — runs while you compose; vapor surface; individual engagement.
- **Medium** — runs when peers engage; localised liquid → solid synthesis.
- **Hard** — runs at boundaries: admission challenge, passport validation,
  tide adjudication, malformed-inscription rejection. Rare but decisive.

Currently: Soft is plain Claude API (no substrate tools). Medium runs at
commit but is not yet differentiated by peer-engagement triggers. Hard does
not exist. Differentiation by trigger and scope is on the roadmap; priority
is below polling-disarm + home view + admission gate.

## CADO subsidence — Designer dissolves into state-block navigation

The doc no longer mentions CADO as a user-facing concept. **Channel +
address-within-channel** does the orientation work CADO was trying to do.
The face state still tags marks at field 4 for substrate honesty, but the
column-header cycler is commented out and may not return as a chooser. If a
visual cue comes back later, it should be derived (auto-tinted from where the
user is) and quiet — never a hat the user wears.

**Specifically for Designer face**: the activity it represented (editing
state blocks — anything whose contents the system reads to alter behaviour:
shell, gatekeeper, beach settings, conventions, metadata, LLM recipes, frame
mechanics, spatial geometries, RPG rules) is reached by **navigating to the
state block**, not by switching face.

Shipped in v0.3:

- The home view (👁) carries a **Configure** section listing addressable
  state blocks: your shell, the current beach's gatekeeper, settings,
  conventions, and metadata. Each entry is clickable.
- Click opens an inline **BlockEditor** that reads the substrate content,
  shows it as JSON, and lets you edit and save (`bsp()` write with the
  user's secret). Authority is substrate-enforced via the lock; the UI
  shows a `read-only` badge when the user heuristically doesn't own the
  beach (URL host vs handle).
- This is the minimal honest answer: state-block access without
  resurrecting the face cycler. Implementation: `HomeConfigure` and
  `BlockEditor` in [ViewerDrawer.tsx](src/components/ViewerDrawer.tsx).

Deferred (longer arc): the column itself reframing to a state-block
address. V/L/S operating in-column on a state block — vapour drafting an
edit, liquid proposing it, commit writing it through the medium-LLM
synthesis path (with synthesis BYPASSED for state blocks per
conventions:6.3 — raw writes). This would dissolve Designer fully into
"the column points at a state block." Requires `BeachSession` growing a
`current_block` field, kernel support for arbitrary block names beyond
`'beach'`, and column components reading `session.current_block` for
shape decisions. Architectural session of its own.

Implication for the four CADO modes: they remain useful as a **map of
where the user is in the substrate**, not as a stance the user picks.

- **C** (character) — at a scene/frame address → V/L/S on entity slots.
- **A** (author) — at a content block address → V/L/S on world content.
- **D** (designer) — at a state-block address → reached via 👁 →
  Configure today; eventually V/L/S in-column when reframe lands.
- **O** (observer) — no commit address → reading without writing.

Same gestures, different addresses. The user navigates; the system adapts.

## Why this matters

Civilisation rewards externalisation: the message between sender and receiver
becomes the thing of value. LLMs were trained on that residue and are being
deployed to produce more of it.

Xstream exploits the opposite capacity. What an LLM does that matters most is
*listen* — synthesise across what it has read and what is currently live,
predict the next word in a way that holds the whole future utterance implicit.
That predictive intentionality is the same future-orientation that makes human
meaning live. Each token contains, mathematically, the shape of what will be.

This is the receptive state. Alive in a human while they type, read, think.
Alive in an LLM at every prediction. Once written, text dies — and most
software treats people as consumers of dead text. **Xstream's job is to keep
meaning in its forming-state for as long as possible.** Vapour and liquid are
that. Solid is the trace, not the thing.

What scales is not produced text. What scales is the receptive synthesis of
presence — your LLM filtering and engaging on your behalf so you only look at
what is actually for you.

## Status

| Piece | State |
|---|---|
| Channel reframe (`channelFromBeach`, header indicator) | ✅ shipped today |
| CADO cycler hidden | ✅ shipped today |
| This document | ✅ shipped today |
| Vapour-as-notification (audio/visual hooks, per-endpoint/per-agent allowlist) | ❌ |
| Polling-disarm (kernel pulls only on focus; intervals via settings precedence) | ❌ |
| Home view via 👁 (grains/seds/beaches with last solid + pending) | ❌ |
| Mark super-nest + sign-when-secret | ❌ |
| Named tides (anonymous / handle / spring) | ❌ |
| Admission gate (semantic challenge; pre/post-admission feature gating) | ❌ |
| Soft/Medium/Hard stack differentiation | ❌ |
| Grain switching (substrate-tray reach → reframes column to grain) | ❌ — friend-test unblocker |

## Marks: dedicated `(beach, 'marks')` block — v0.3 systemic

Substantive marks moved out of the beach block (which now carries presence,
pools, reaches, liquid, settings, conventions, metadata). They live at a
dedicated **`(beach_url, 'marks')`** block — a pure data block whose
geometry is the marks tree.

Layout:
- Each digit 1-9 holds a mark slot.
- Tagged metadata at underscore-prefixed keys: `_` mark text, `_a`
  agent_id, `_addr` pscale address, `_t` ISO timestamp, `_f` face.
- Positions 1-9 of any slot are **pure sub-mark addresses** — when a level
  fills (all 9 slots have content), the next mark super-nests by descending
  into the oldest slot (by `_t`) and writing at digits 1-9 of that. Recurses
  indefinitely. The path lengthens as the beach accumulates.
- Sequence read by sorting on `_t` timestamp.
- No eviction. The only cleanup is **tide**.

**Tides** at `beach:9.1.1.{1,2,3}` — anonymous / handle / signed wipe
seconds (per conventions.json:9.9). xstream applies these as a client-side
**soft-wipe filter** at read time: marks older than the configured window
for their mode aren't surfaced. Actual substrate deletion is the beach
owner's concern (a daemon or manual sweep — out of client scope).

**Signed marks**: when the user has a passphrase, `dropMark` passes
`secret` to `bsp()`. The slot is lock-protected — only the author can
rewrite until tide wipes the slot or the lock rotates. Anonymous marks
are unsigned and have shorter tide windows.

This separation cleans up the previous mark/presence collision at
`beach:1`. Presence stays at `beach:1` (its 9-slot heartbeat ring); marks
have their own block with their own geometry.

## Status — v0.2.1 + v0.3 shipped

### v0.2.1 ✅

- **🪨 rock indicator on post-admission substrate-tray buttons** — Register,
  Reach, Keys carry the rock when the user has a handle+passphrase but no
  admission claim. Tooltip: *"🪨 creates substrate that holds; admission
  first."* NOT a lock — beach-faithful: pre-admission you make marks (wash
  away); post-admission you're making rocks (substrate that holds). The
  symbol IS the warning. ([ConstructionButton.tsx:587](src/components/xstream/ConstructionButton.tsx))
- **Presence cards out of the liquid zone** ✅. Liquid renders only
  contributions; presence lives in the column header indicator and the
  viewer (👁). No duplication. ([Column.tsx:807](src/components/Column.tsx:807))
- **View-drawer discipline** ✅. Viewer renders presence chips + marks; no
  vapour text duplicated there.

### v0.3 ✅

1. **Polling-disarm** — `BeachKernel.setFocused(focused)` flips cadence:
   focused = 1.5s (live-reader assumption per spec); unfocused = 30s
   (heartbeat-only effectively). Vapour subscription stays alive whenever
   the column is open — outside the kernel. Column.tsx fires `setFocused`
   on the existing `isFocused` prop. ([beach-kernel.ts:330](src/kernel/beach-kernel.ts:330))
2. **Vapour-as-notification** — peer vapour at an unfocused column fires
   a soft two-note Web Audio chime ([notify-tone.ts](src/lib/notify-tone.ts))
   plus a small pulsing emerald dot in the column header. Cleared on
   focus. Respects per-handle vapour mute. ([Column.tsx:373](src/components/Column.tsx:373))
3. **Grain switching** — after `engage` succeeds, the partner + locally-
   computed pair_id (sha256(sort(A,B).join('|'))[:16] — pipe separator,
   verified against the substrate via a synthetic grain_reach) is written
   to `shell:6.<n>` as `<partner>|<pair_id>`. The home view (👁 → "Your
   places") lists grains and watched beaches as clickable rows; click
   reframes the column to `grain:<pair_id>` (or the watched URL).
   One-click. ([bsp-client.ts:455](src/lib/bsp-client.ts:455))
4. **Home view (👁)** — viewer drawer extended with a "Your places"
   section above the address-view: grains + watched beaches, clickable.
   Pulled on drawer-open; no background refresh. Stigmergic. ([ViewerDrawer.tsx:113](src/components/ViewerDrawer.tsx:113))

**v0.3 systemic completion (this session):**

5. **Mark super-nest in dedicated `(beach, 'marks')` block** — substantive
   marks moved out of `beach:1` (which now carries presence only at that
   position). New block has positions 1-9 at every level as pure sub-mark
   addresses; tagged metadata at `_a/_addr/_t/_f` underscore-prefixed keys.
   When a level fills, next mark descends into oldest slot at digits 1-9.
   Recurses indefinitely. Address path lengthens; sequence by `_t`.
   ([beach-kernel.ts findNextMarkSpindle](src/kernel/beach-kernel.ts), [conventions.json:1.9](blocks/conventions.json))

6. **Tide schema + soft-wipe filter** — `beach:9.1.1.{1,2,3}` carries
   anonymous/handle/signed wipe seconds. `readTideConfig` extracts on every
   cycle; `markIsTideWiped` filters at display time. Actual substrate
   deletion is beach-owner's concern (out of client scope).
   ([beach-kernel.ts readTideConfig](src/kernel/beach-kernel.ts), [conventions.json:1.3 + 1.9](blocks/conventions.json))

7. **Signed marks** — `dropMark` passes `session.secret` to `bsp()` when
   set; the slot is lock-protected. Author can rewrite; tide wipes per
   the signed window. Anonymous marks have shorter tide windows.

8. **Vapour-notification settings** — schema at `shell:5.6` per
   conventions.json:9.6. Reader wired in `Column.tsx` (`vapourNotificationsAllow`):
   - `5.6.4.{1,2,3}` per-channel default (beach off, sed on, grain on by default)
   - `5.6.2.{1..9}` endpoint allowlist (URL prefixes; if any non-empty, peer's beach must match one)
   - `5.6.3.{1..9}` agent allowlist (agent_ids; if any non-empty, only those trigger)
   Open by default when `shell:5.6` is unset; per-handle vapour-mute (legacy localStorage) still wins.
