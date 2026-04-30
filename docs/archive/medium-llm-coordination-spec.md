# Medium-LLM Coordination Architecture
## Tested Specification for Xstream Implementation

*Generated from convergence testing, March 2026. All examples are actual LLM outputs from Haiku-cost test runs.*

---

## One Mechanism

There is one mechanism: **context window composition determines narrative outcome.**

A medium-LLM wakes. Its context window has been composed from accumulated inputs. It produces narrative. Everything else — accumulation, domino triggers, B-loop convergence, timing — answers a sub-question about that single operation:

- **What goes into the context window?** → accumulation model
- **When does the medium wake?** → trigger model (player commit, domino, timer)
- **What constrains the output?** → established canon + character state + physical reality
- **What happens to the output?** → deposit events into other mediums' blocks + deliver solid to player

These are not four systems. They are four questions about one API call's input and output.

---

## Core Concepts

### The Block

Each character has a JSON block. This block contains:

- **Character state** — position, skills, knowledge, possessions
- **Accumulated context** — events deposited by other mediums (canon)
- **Pending liquid** — player's submitted intention (if any)
- **Scene context** — shared spatial/environmental state

The medium-LLM reads the block. All coordination happens through what is written in the block and what is read from it. There are no notifications, no messages between agents. There is writing to blocks and reading from blocks.

### Solid, Provisional, and Events

When a medium fires, it produces three things:

- **Solid narrative** — 2-4 sentences from the character's sensory perspective. This is what the player reads.
- **Events skeleton** — factual observations that others could perceive (sounds, movements, visible actions). NOT internal thoughts. These are deposited into other characters' blocks as accumulated context.
- **Provisional flag** — does this action interact with other characters? If yes, the solid may need revision before delivery to the player.

### Canon

Events deposited by a resolved medium become **canon** — established fact in the shared world. Later mediums MUST incorporate canon. They cannot contradict it. They CAN perceive it differently based on their character's position and attention, but the events themselves are fixed.

---

## Three Trigger Modes

### 1. Player Commit

The player hits commit. Their medium wakes, reads the block (liquid + accumulated context), produces solid + events. Events are deposited into other characters' blocks.

**Cost:** One medium-LLM call per commit.

### 2. Domino Trigger

A medium's output directly affects another character. The affected character's medium is triggered without their player committing. The domino carries specific context: what happened to them, why they must respond.

**Cost:** One additional medium-LLM call per domino target.

### 3. Accumulation (Silent)

Events land in a character's block but don't demand immediate response. The character's player hasn't committed. The events sit in accumulated context, waiting for the next player commit or domino trigger to incorporate them.

**Cost:** Zero. No LLM call until something triggers the medium.

---

## Tested Patterns

### Pattern 1: Sequential Commit (Relaxed Async)

Three characters in a quiet tavern. Each commits independently. Each medium resolves with whatever has accumulated.

**Tested result:** The first committer shapes the world. The last committer sees the most context and produces the richest narrative. Events survive translation across perspectives — a stranger entering is perceived as a visual figure by those facing the door, as a draught and sound by those facing away.

**Key finding — position-constrained perception:** A character whose position blocks their view of an event does NOT see it, even when the event is canon in their accumulated context. The medium respects physical constraints without explicit filtering logic. The prompt constraint is sufficient.

Example (tested): Maren sits at a corner table, back to the door, screened by a partition. The stranger enters (canon). Maren's solid:

> *The map lies flat under my weathered hands, candlelight pooling across the Greymarch passes. The fire beside me has burned lower, and I feel the draught before I hear it — a cold breath from the front of the tavern that makes the candle flame shudder and lean. I anchor the map case closer with my elbow, jaw tightening at the interruption.*

She gets draught, candle flicker, rain-smell. Never sees the stranger. Canon respected, perception filtered.

### Pattern 2: Commit Order Determines Outcome

Same intentions, different commit order, different results. This is the initiative mechanic.

**Tested with direct conflict:** Kael wants to draw his sword. Essa wants to grab his arm before he draws.

- **Kael commits first:** His solid establishes the sword is drawn. Essa's medium, resolving second, cannot undo this. She's mid-grab, but the blade is already out.
- **Essa commits first:** Her solid establishes "Sit down, Kael" and her palm-slam on the bar. Kael's medium, resolving second, respects this canon. His hand **freezes halfway to his sword belt**. He stays seated. Jaw tightens. Eyes locked on stranger. But he doesn't draw.

Same intentions. Opposite outcomes. Purely from timing.

**Implication for game design:** Committing early costs money (you're paying for the synthesis call) and gives initiative. Waiting is cheaper and gives more information but less influence. This tension emerges naturally from the accumulation model.

### Pattern 3: B-Loop Convergence (Simultaneous Conflict)

Three characters act simultaneously. No one has priority. All three commit at once.

**The problem:** Kael draws sword. Essa grabs his arm. Maren walks toward the stranger chatting about guild marks. These can't all be true at once.

**Solution — two passes:**

**Pass 0 (isolated):** Each medium fires with zero accumulated context. Each produces a provisional. Three incompatible stories.

**Pass 1 (mutual awareness):** Each medium receives the other two provisionals as context. Each produces a revised narrative.

**Tested result — converged in one pass.** All three mediums independently negotiated the same physical reality:

- Kael's draw is **interrupted** — Essa's grip catches his arm with the blade 6-8 inches out
- Essa's intervention is **partial** — she slows Kael but can't fully stop his forward momentum
- Maren's recognition is **partial** — she speaks and reaches toward the stranger, but freezes mid-gesture as she registers the sword and shouting behind her

Every medium agreed with every other medium. Zero remaining conflicts. The physical resolution respects distance and timing: Essa is closest to Kael (across the bar), so her grab lands. Maren is closest to the stranger, so her words arrive first. Kael is furthest from both, so his draw is most interruptible.

**Minor perspectival disagreement (desirable):** Kael's medium says Essa "anchors him mid-draw" (fully stopped). Essa's medium says she "slows him but doesn't stop him" (partially stopped). Both are valid character perspectives on the same physical event. This is exactly the kind of disagreement that works for per-character narrative.

**Cost:** 6 Haiku calls (3 initial + 3 convergence) for a three-way simultaneous conflict.

### Pattern 4: Domino Trigger (Reactive Narrative)

Kael's player commits. His action (lunging with sword) directly endangers Maren (standing 2 metres from the stranger) and breaks Essa's grip. Both are domino-triggered without their players committing.

**Tested result — coherent reactive narrative from character state alone:**

Essa (domino-triggered, no pending liquid):
> *Essa's grip tears away, and for a fraction of a second her instinct screams to lunge after Kael. But she doesn't chase the sword. Instead, she pivots hard on the bar's edge, moving with surprising speed toward the hearth's opposite flank, putting herself between Kael's momentum and the stranger's body. Her voice cracks out low and urgent: 'Stand down. Both. Now.'*

Maren (domino-triggered, no pending liquid):
> *Maren's instinct screams danger as Kael's lunge cuts through the space where she stands. She throws herself backward with a sharp intake of breath, her outstretched hand snapping back to her chest. Her merchant's training abandons her — there's no negotiation possible in a sword's arc.*

No player input. Character state + domino context = sufficient for coherent, character-appropriate reactive narrative.

### Pattern 5: Pending Liquid Shapes Domino Response

The critical finding for the architecture. When a character has submitted liquid (intention) but hasn't committed, and a domino arrives, the pending liquid **inflects the reactive behaviour without controlling it**.

**Tested:** Same domino (Kael lunges). Maren has pending liquid: *"I step closer to the stranger and reach for the clasp. 'That mark — are you from the southern chapter?'"*

Maren's domino response WITH pending liquid:
> *Maren's outstretched hand jerks back as Kael's lunge cuts the air — the merchant stumbles sideways, heart hammering. The instinct to flee wars with the instinct to de-escalate; instead, Maren plants her feet and raises both hands in a placating gesture, positioning herself as a human barrier between Kael's blade and the stranger. 'Wait —' Maren calls out, 'they're guild. They're Greymarch. Not a threat.'*

Compare with Maren WITHOUT pending liquid (Pattern 4): pure flight, retreats to bar.

The pending liquid transformed the response. The specific action (reach for clasp, chat about tolls) was overridden — the medium tagged it `liquid_status: overridden`. But the knowledge (guild identification) and the motivation (establish contact) shaped her reactive behaviour. She became a human shield instead of fleeing.

**Implication:** Pending liquid is not a queued command. It is context that colours the character's instinctive response to unexpected events. This is psychologically realistic — your intentions shape how you react to surprises, even when the specific plan becomes impossible.

### Pattern 6: Domino Cascade Signals

Each domino response can generate further domino signals. These were not auto-executed in testing but were generated by the medium:

Essa's domino response generates:
> *⚡ Kael must now choose: commit to violence with Essa in the way, or break his lunge*
> *⚡ The stranger receives a brief window to react*

These are the B-loop triggers. If Essa's interposition creates a new situation that demands Kael's response, Kael's medium would fire again — not from player commit, but from cascade. The chain continues until no new dominoes are generated.

---

## Implementation Architecture

### Per-Character Block Structure

```json
{
  "character": {
    "id": "kael",
    "state": "position, skills, knowledge, possessions",
    "solid_history": ["previous solid narratives — canon for this character"]
  },
  "accumulated": [
    {
      "source": "essa",
      "events": ["observable event 1", "observable event 2"],
      "timestamp": "relative ordering"
    }
  ],
  "pending_liquid": "player's submitted intention or null",
  "scene": "shared spatial/environmental context"
}
```

### Medium-LLM Prompt Pattern

The prompt that works (tested across all scenarios):

1. **Role declaration** — "You are the medium-LLM for [character]"
2. **Scene context** — shared environment
3. **Character state** — position, capabilities, constraints
4. **Committed intention** (liquid) — what the player wants to do
5. **Accumulated context** — canon events from other mediums, labelled as ESTABLISHED
6. **Constraint rules:**
   - Character can only perceive what position and attention allow
   - Accumulated events are established reality — must incorporate
   - Physical reality matters: distance, timing, what's reachable
   - If accumulated events contradict intention, resolve honestly
7. **Output schema** — solid, events, internal, provisional flag, interaction list

For domino triggers, replace "committed intention" with "domino context" (what happened to the character) and optionally include pending liquid as context that may be used or overridden.

For B-loop convergence, include all other characters' provisionals as "happening simultaneously" and ask for revised narrative that resolves timing and physical conflicts honestly.

### Trigger Logic (Non-LLM)

The kernel/system layer handles trigger routing. This is code, not LLM:

```
On player commit:
  1. Compose medium prompt from character block
  2. Call medium-LLM
  3. Parse response: solid, events, domino targets
  4. Deposit events into other characters' blocks (accumulated)
  5. For each domino target:
     a. Compose domino prompt for target character
     b. Call target's medium-LLM
     c. Parse response, deposit events, check for cascade dominoes
  6. If provisional flag AND interacts_with is non-empty:
     → Hold solid, enter B-loop (see below)
  7. Else: deliver solid to player

On B-loop entry:
  1. All interacting characters have provisionals
  2. Compose convergence prompt for each (includes others' provisionals)
  3. Call all mediums (can be parallel)
  4. Check conflicts_with fields
  5. If all empty → converged, deliver solids
  6. If conflicts remain → iterate (max 3 passes)
```

### When to B-Loop vs Sequential

**Sequential (one medium at a time):** When commits arrive at different times. First committer's events become canon. Later committers incorporate them. No B-loop needed — the accumulation mechanism handles it.

**B-loop (simultaneous resolution):** When multiple characters commit within the same action window AND their actions interact. The window could be defined by pscale (finer pscale = shorter window) or by explicit simultaneous trigger.

**Domino (reactive chain):** When one character's resolved action directly affects another. The affected character's medium fires without player commit. Can cascade.

Most play will be sequential + domino. B-loop is for the rarer simultaneous conflict case. The system should handle all three patterns with the same block structure and prompt patterns — only the trigger logic differs.

### Cost Model

| Pattern | Calls per event | Model | When |
|---------|----------------|-------|------|
| Sequential commit | 1 per player | Haiku | Normal play |
| Domino (single) | 1 initiator + 1 per target | Haiku | Direct interaction |
| Domino cascade | +1 per cascade level | Haiku | Chain reactions |
| B-loop convergence | 3 initial + 3 per iteration | Haiku | Simultaneous conflict |
| Solid rendering | 1 per player (optional) | Haiku/Sonnet | Upgrade narrative quality |

The events skeleton (what happened) can be Haiku. The final solid narrative (what the player reads) could optionally be upgraded to Sonnet for richer prose. This separation means the coordination logic stays cheap while the player-facing output can be quality-tiered.

---

## Transport

The tests ran with Python dictionaries standing in for blocks. The actual transport — how events from Medium-A's output arrive in Medium-B's block — is independent of the coordination logic. Options:

- **Shared JSON storage** (file, database, KV store) — mediums read/write to a common location
- **Direct injection** — the kernel that calls Medium-A parses its output and writes events directly into Medium-B's prompt composition
- **Peer-to-peer** — blocks are exchanged between browser instances

The coordination logic doesn't care which transport is used. It only requires: when Medium-B wakes, its context window includes events deposited by Medium-A. How they got there is a plumbing question.

The architecture should maintain distributed implementation — no central server holding truth. Each character's block is sovereign. Events are deposited as semantic content at BSP addresses. The medium reads its own block and produces output. The kernel handles routing.

---

## What Was NOT Tested

- **Dice/rules evaluation** — the skeleton events could include a rules evaluation step between provisional and solid (e.g., stealth check: 6 vs awareness: 4). This would constrain the medium's narrative. Not yet tested but the insertion point is clear: between accumulation and medium call, or between provisional and convergence.
- **Pscale-based action windows** — finer pscale actions should resolve faster. The window duration determines what accumulates before the medium fires. Not yet tested.
- **More than 3 characters** — the patterns should scale (each medium only needs its own block + accumulated deposits from others) but this hasn't been verified.
- **NPC/stranger responses** — every test skipped the stranger's domino. In production, NPCs would have their own medium (possibly cheaper, rule-driven) or the hard-LLM would determine NPC behaviour.
- **Solid history as constraint** — the tests used single-moment scenes. Over multiple rounds, the medium would need prior solid as constraint (PCT reference signal: new solid must be consistent with established narrative).

---

## Summary

The medium-LLM coordination architecture is one mechanism: compose context window, call LLM, deposit events. Accumulation handles async play. Domino handles reactive chains. B-loop handles simultaneous conflict. All three use the same block structure, the same prompt pattern, and the same event deposition model. The only difference is trigger logic — when and why the medium wakes.

Tested at Haiku cost with three characters across five scenarios. The mechanism produces coherent, position-aware, character-appropriate narrative that respects established canon and resolves physical conflicts through mutual context rather than message-passing.
