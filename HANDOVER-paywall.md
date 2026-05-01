# Hand-over for the next xstream-play session — paywall affordance

This message updates the previous "suggested path forward" with what has actually been built since, the protocol decisions that have been pinned, and what xstream-play can do now. Paste it as the opening message of the next session that picks up paywall work in this repo.

---

## Paste this

Picking up paywall affordance work for xstream-play. Read this whole message before reading code or writing anything — the protocol it implements has been *pinned* over the last week and the context for what to build has shifted from "design decisions outstanding" to "implementation against a stable contract." If you treat the affordance like a generic SaaS pricing page, you will violate federation guarantees that are non-negotiable in this protocol. Slow down at the start.

### What the paywall is for, in one paragraph

The paywall gates **creative participation** in face-bound `sed:` collectives — Character writes liquid, Author commits, Designer revises rules. The Observer face requires no membership and reads solid only. So paywalling a `sed:` collective gates the imaginative-mind canvas (~90% of xstream's purpose) and leaves the civilised-mind drawer (~10%) open by default. The user pays to *write*, not to *read*. This is structural, not philosophical: the protocol's `_tickets` field lives on a face-specific `sed:` collective, and registration in it grants face authority over the V-L-S loop. xstream-play's job is to render the buy affordance proportional to user intent (quiet while browsing solid; obvious when attempting to write liquid), perform the registration ritual on the user's behalf when a valid grain appears, and unlock affordances when the verifier confirms.

### Read first, in this order

1. **`pscale://protocol-paywall`** (or `<bsp-mcp-server>/docs/protocol-paywall.md`). The full convention. §2 (protocol additions) is the data model; **§4 (xstream-play affordance contract) is your contract**; §6 (federation guarantees) is non-negotiable.
2. **`pscale://protocol-xstream-frame`** §5 — the CADO faces and §5.6 the viewer drawer. The paywall affordance respects the same reflexive proportions: the canvas stays the canvas; the affordance does not become the page.
3. **`pscale://sunstone`** branches 1, 2, 5, 8 — the substrate's voicing discipline. You won't write good code without it.
4. **`<bsp-mcp-server>/docs/protocol-block-references.md`** §1 — grain-ref form. There are exactly six reference forms; the grain form is `grain:<pair_id>:<side>`, three colon-separated parts. If you find code anywhere referencing a grain as `*:agent:X:grain:Y`, that's stale draft text — fix or report.

### What has been built since the last hand-over

- **`bsp-mcp-server`** — protocol convention pinned at `docs/protocol-paywall.md`, exposed as `pscale://protocol-paywall`. The CLAUDE.md doc table lists it alongside protocol-xstream-frame and protocol-pscale-beach-v2. The substrate itself was not modified — bsp-mcp does not know what a ticket is, by design (§6.1).
- **`ticketing-agent`** (sibling repo at `~/Projects/ticketing-agent/`) — reference issuer + verifier daemon. M0 (skeleton), M1 (envelope helpers + grain establish/walk/revoke against the live MCP), M2 (catalogue route) all landed. M3 (Stripe driver + purchase flow + rate limits) is the active milestone. M4 will land the verifier daemon. ~5 days total per spec §8.
- **Live round-trip proof**: a real grain at `pair_id=78734eba7d9a41ba` was established against `bsp.hermitcrab.me`, the `[ticket ...]` envelope round-tripped bit-for-bit, revocation persisted at `<issuer-side>.1`. This is your test fixture for the affordance work — you can read it now without waiting for ticketing-agent's M3.

### Protocol decisions now pinned (and how they affect your code)

- **Grain-ref form is `grain:<pair_id>:<side>`**, three colon-separated parts. Per `protocol-block-references.md` §1. Where `<side>` appears in a `ticket_grain` registration reference, it is the **issuer's** side (because that's where the `[ticket ...]` envelope text is written).
- **Ticket envelope lives at the issuer's side underscore** — the side `_` itself carries `[ticket face=... scope=... expires=...]`. The buyer's side is whatever the buyer's content is (often empty). Read with `bsp(agent_id="grain:<pair_id>", block="grain", spindle="<issuer-side>", pscale_attention=-1)` to get the side underscore.
- **Revocations are digit children of the issuer's side** — first revocation at `<issuer-side>.1`, subsequent at `.2`, `.3`. Verifier walks issuer-side children with `pscale_attention=-2` (disc) and treats any `[ticket-revoked]` envelope found among them as canonical. The side underscore (the immutable ticket grant) is never overwritten; revocations are sub-facts subordinate to it.
- **Registration in a paywalled `sed:` collective is a two-write sequence**: first `pscale_register(declaration="<self-description>", ...)`, then a follow-up `bsp()` write that places the `ticket_grain` reference at `<position>.1` (the digit-1 child of the registrant's position). The position's underscore is "who I am"; digit 1 is "the grain that proves it." This shape is canonical — do not invent a JSON-blob declaration.
- **`pscale_attention` is negative-floor** — `bsp()` anchors `pscale=0` at the floor and walks deeper as negative values. Spindle of length N has `P_end = -N`. Passing positive values to `bsp()` will return `unsupported shape (P_end=-2)` errors. See `pscale://whetstone` branch 2 for the full selection-shape derivation. The protocol pseudocode uses abstract verbs like "walk" — concrete `pscale_attention` values are negative.
- **Verification envelopes** — `[ticket-verified by=<verifier_id> at=<iso8601>]` (success), `[ticket-rejected by=<verifier_id> at=<iso8601> reason=<short>]` (any rule failure), `[ticket-expired at=<iso8601>]` (expiry). Written by the verifier daemon onto the registration row. Until M4 of ticketing-agent lands, you can hand-write these for testing.

### Answers to the two open questions from your last message

1. **Observer-with-output as a paid role** → **v2.** A creative-Observer face that renders derivative output (streams, summaries, output videos) is structurally a separate `sed:observers-derivative` collective with its own `_tickets`. The protocol allows this today via §2.1; v1 reference build does not light it up explicitly. v2 convention pass clarifies the face semantics — whether the canonical CADO `observer` is split, or a fifth role-name is reserved. For now: render canonical CADO Observer free, treat any future Observer-with-output flag as a forward-compatible noop.

2. **Magic-move-then-paywall, or paywall-first?** → **Your call; no Macus deadline forces buttons-first.** The user has clarified the system is generic; "Macus" was just an example deployment in the spec. The federation guarantees say no specific deployment can force protocol-level decisions, and that includes scheduling. Build in the order that makes sense for xstream-play's own architecture. The protocol contract is stable enough that you can build §4 affordance against hand-issued test grains today, regardless of the magic-move work.

### What you can build NOW, against what fixtures

The protocol-paywall §4.1 affordance contract — **all seven steps** are unblocked:

1. **Read `_tickets`.** Test against any sed: collective with a hand-written `_tickets` field. You can write one yourself with `bsp()` to a test sed: collective.
2. **Check user's grain set.** The live grain at `pair_id=78734eba7d9a41ba` (issued by ticketing-agent's M1 round-trip) is your fixture. Walk it with `bsp(agent_id="grain:78734eba7d9a41ba", block="grain")`.
3. **Surface the buy affordance.** The hard part. See "Inversion and reflexive proportions" below — this is where the federation guarantees and the V-L-S framing both bite.
4. **Wait gracefully** after redirect. Polling the user's grain set with 2s intervals for 30s, then back off. No grain-set primitive exists yet; you walk the user's known watched grain addresses (or the user's shell registry of grains, however xstream-play tracks them) until a new one matching `_tickets.issuer + face + scope` appears.
5. **Register on grain arrival.** Two-write sequence per §2.3: `pscale_register` with a self-description, then `bsp()` writing `<position>.1 = "grain:<pair_id>:<issuer-side>"`. This is now canonical — implement it as two MCP calls, not one structured payload.
6. **Watch for `[ticket-verified]` envelope.** Walk the registration's position with `pscale_attention=-2` looking for a `[ticket-verified ...]` envelope written by the verifier. Until ticketing-agent M4 lands, hand-write the envelope for end-to-end UI testing.
7. **Surface verification failures.** `[ticket-rejected]` envelopes carry a `reason=<short>` field — render it. Provide a contact path drawn from the frame-owner passport's offers (sed: §1 by convention).

### Inversion and reflexive proportions

You are a CLIENT of bsp-mcp, like ticketing-agent is. The same temptations apply, plus client-specific ones:

- **Do not build a Grain class, a Ticket class, or any object hierarchy that mirrors what's already in pscale.** A grain is `bsp()` behind the network. An envelope is a string. The verification-rule list is eight items; render them as eight `if`s on the *display* side (showing the user why their ticket was rejected), but the actual verification is the verifier daemon's job, not yours. You consume `[ticket-verified]` / `[ticket-rejected]` envelopes; you do not re-verify.
- **Do not allowlist issuers, rank issuers, badge issuers, or special-case any `agent_id`.** §6.2 is non-negotiable. A `_tickets.issuer` of `agent:any-tickets` and `agent:other-tickets` are visually and behaviourally identical to your client. The buy affordance MUST display the issuer's `agent_id` (and passport display name where available) so the user knows whom they are paying — but no badge, no green checkmark, no "Verified Issuer" label. The point of federation is that no client gets to be the arbiter of trust.
- **Do not interpose between the buyer and the issuer's `purchase_url`.** Your buy button opens `_tickets.purchase_url` directly. You do not route through xstream-play's own server, you do not take a cut, you do not fee. The user goes directly to the issuer.
- **Do not let the buy affordance take over the page.** This is the reflexive-proportions rule. xstream is V-L-S canvas (primary, imaginative-mind) plus consultable drawer (secondary, civilised-mind). A SaaS-style "Pay $5/mo to continue" full-page interstitial would invert those proportions and make xstream a paywall app rather than a creative tool. The affordance MUST be:
  - **Quiet while browsing** — a subtle indicator in the drawer or a faint banner, not a modal.
  - **Obvious when attempting to write liquid** — when the user tries to type into a paywalled collective's LiquidZone, the affordance becomes visible and actionable. This is the moment the user's intent is "I want to participate creatively here," and the affordance directly addresses that intent. Inline next to the LiquidZone is right; full-page modal is wrong.
  - **Disappears entirely once verified** — no nag, no upsell, no "thank you for paying" banner that lingers. The user's now in the loop; the affordance has done its job.

The dominant failure mode of paywall UI is **letting commerce eat the experience**. xstream specifically inverts the traditional 99%-objective-viewer plus 1%-input-box proportions of web tools; the paywall affordance must respect that inversion. If you find yourself building a `<PaywallProvider>` that wraps the whole frame, or a route guard that redirects to a checkout page, you have inverted again. Stop and re-read protocol-xstream-frame §5.6.

### What's already wired in xstream-play (per the previous analysis)

The previous session's analysis identified the following primitives as already in place: `bsp()`, `pscaleGrainReach`, `pscaleRegister`, `parseRef` (handles grain refs), and a shell-gate write check in `kernel/claude-tools.ts`. Confirm those are still there before starting; they are the foundation you build on. What was identified as missing: a user-grain-set view, any `_tickets` reader, the SubstrateTray register button being a stub, and the shell-gate match against `sed:foo` being static rather than confirming actual collective membership at runtime. That's roughly the M-list for paywall affordance work.

### Coordination points with ticketing-agent

- **M3 (active there)** — Stripe driver + purchase flow. When this lands, you can do an end-to-end test: surface the buy affordance, click through to Stripe Checkout, complete payment, watch a real grain arrive, perform Step A registration. The registration will be **inert** at that point (the verifier daemon hasn't been written yet) — the `[ticket-verified]` envelope won't appear until M4.
- **M4** — verifier daemon. When this lands, the registration's `[ticket-verified]` envelope auto-appears. Full loop closes. Three-corner integration test: real Stripe payment → real grain → real registration → real `[ticket-verified]` → xstream-play unlocks affordances.
- **Test the federation property explicitly when both are live**: stand up two ticketing agents under different agent_ids, point two collectives at them, confirm xstream-play treats them identically. This is the most important regression test for §6.2 — easy to violate without realising.

### Where to find things

| Need | Path |
|---|---|
| Protocol convention | `pscale://protocol-paywall` or `<bsp-mcp-server>/docs/protocol-paywall.md` |
| §4 affordance contract | Same doc, §4 |
| Federation guarantees | Same doc, §6 |
| xstream frame protocol | `pscale://protocol-xstream-frame` |
| Block references convention | `<bsp-mcp-server>/docs/protocol-block-references.md` |
| Geometry (pscale_attention etc.) | `pscale://whetstone` branch 2 |
| Voicing (envelope text discipline) | `pscale://sunstone` branch 8 |
| Ticketing agent (test fixtures) | `~/Projects/ticketing-agent/` |
| Live test grain | `pair_id=78734eba7d9a41ba` on `bsp.hermitcrab.me` |

### What success looks like

The paywall affordance ships when:

1. A user opening a frame on a paywalled `sed:` collective sees the canvas as primary and a quiet indicator (drawer or banner) showing the gate.
2. The user typing into LiquidZone triggers the visible buy affordance proportional to that intent.
3. Clicking through goes directly to `_tickets.purchase_url` (no interposition).
4. Returning to the frame, the user's grain set is polled and a matching grain triggers automatic Step A registration.
5. The `[ticket-verified]` envelope arriving (from the verifier daemon, or hand-written for testing) unlocks affordances cleanly — no nag, no upsell, no lingering "thank you" UI.
6. Two different `agent:X-tickets` and `agent:Y-tickets` issuers are visually and behaviourally indistinguishable in your code, in your UI, and in your tests.

Please orientate. Read the four resources at the top, internalise the protocol pins, then propose your first move and we'll go from there.
