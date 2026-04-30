# Sovereign Kernel: Architecture and Instructions for CC

## What This Is

A single Python file (`kernel.py`) that implements the medium-LLM coordination architecture as a sovereign, distributed kernel. One instance per character. Each instance serves its own JSON block via HTTP, polls peers to discover events and dominos, and fires the medium-LLM when triggered. No central server. No shared database. No WebSocket. Just JSON over HTTP.

This is the minimal layer 0 — the mechanical loop that everything else builds on.

---

## The Sovereignty Principle

**No kernel ever calls another character's medium-LLM.** This is the critical constraint CC's original Step 3 violated.

What happens instead:

1. Kael's kernel fires Kael's medium. The medium produces events + domino signals.
2. Kael's kernel writes these to Kael's block (the outbox).
3. Essa's kernel, on its next poll cycle, fetches Kael's block via HTTP GET.
4. Essa's kernel reads the outbox. Discovers events → accumulates them. Discovers a domino addressed to "essa" → fires Essa's medium.
5. Essa's kernel writes Essa's output to Essa's block.
6. Kael's kernel, on its next poll, fetches Essa's block. Discovers Essa's events. Accumulates them.

The trigger decision belongs to the kernel whose medium fires. Character A deposits signals in A's block. Character B discovers them by reading A's block. This is stigmergic — ants modifying the environment, other ants reading the environment. No messages. No routing. No central coordinator.

---

## Block Structure

Each character has a JSON block with two layers:

**Layer 2 (designer-editable content):**
- `character` — id, name, state, solid history
- `scene` — shared environment description
- `peers` — URLs of other kernels' blocks
- `trigger` — when to fire the medium (poll interval, domino behaviour)
- `medium` — model, API key, max tokens
- `prompt_template` — role, constraints, output format (all editable by designer face)

**Layer 0 (kernel-managed runtime state):**
- `pending_liquid` — player's submitted intention (or null)
- `accumulated` — events from peers not yet incorporated
- `outbox` — latest solid, events, domino signals, sequence number
- `status` — idle, waiting, resolving, domino_responding
- `last_seen` — tracks which peer sequence numbers have been processed (dedup)

The kernel never touches layer 2 content. It reads it to compose prompts and determine behaviour. The designer face (or the human editing JSON) changes layer 2. The kernel changes layer 0.

---

## The Loop

Every cycle (default 3 seconds):

```
STEP 1: Poll peers
  For each peer URL:
    HTTP GET their /block
    Compare their outbox.sequence to our last_seen for that peer
    If new:
      Accumulate their events into our block
      Check their dominos for any addressed to us

STEP 2: Process dominos
  If domino found addressed to us AND trigger.domino_fires_medium:
    Fire our medium-LLM with trigger_type="domino"
    Write output to our outbox
    (Peers will discover our response on their next poll)

STEP 3: Process player commit
  If status == "resolving" (player hit /commit):
    Fire our medium-LLM with trigger_type="commit"  
    Write output to our outbox
    Clear pending liquid

STEP 4: Sleep for poll_interval_s, repeat
```

That's the entire kernel. The rest is prompt composition and HTTP plumbing.

---

## How to Run

### Prerequisites

Python 3.10+. Optional but recommended: `pip install httpx` (faster HTTP). Falls back to stdlib `urllib` if not installed.

### Two characters, same machine (testing)

Terminal 1:
```bash
python kernel.py --config kael.json --port 8001
```

Terminal 2:
```bash
python kernel.py --config essa.json --port 8002
```

Both configs need `"api_key": "sk-ant-..."` set in the `medium` section.

Kael's config has `"peers": ["http://localhost:8002/block"]`.
Essa's config has `"peers": ["http://localhost:8001/block"]`.

### Two characters, different machines

Machine A runs Kael's kernel on port 8001. Expose via ngrok:
```bash
ngrok http 8001
# Gives you https://abc123.ngrok.io
```

Machine B runs Essa's kernel on port 8002. Expose via ngrok:
```bash
ngrok http 8002
# Gives you https://def456.ngrok.io
```

Kael's config: `"peers": ["https://def456.ngrok.io/block"]`
Essa's config: `"peers": ["https://abc123.ngrok.io/block"]`

Cloudflare tunnels work identically. Any method of exposing a local HTTP port works.

### Player interaction

Submit liquid (type your intention):
```bash
curl -X POST http://localhost:8001/liquid \
  -H "Content-Type: application/json" \
  -d '{"liquid": "I draw my sword and step toward the stranger."}'
```

Commit (trigger medium — this costs an API call):
```bash
curl -X POST http://localhost:8001/commit
```

View current block state:
```bash
curl http://localhost:8001/block | python -m json.tool
```

### What you'll see

Kael's terminal:
```
[14:30:01] 🦀 Kernel started: Kael on port 8001
[14:30:15]   ✏️  Liquid received: I draw my sword and step toward the stranger...
[14:30:22]   ⚡ Commit received — medium will fire on next cycle
[14:30:25]   🎯 Player committed. Firing medium...
[14:30:28]   ✅ Solid: Kael's hand closes on the sword belt as he rises...
[14:30:28]      Events: 4 deposited
[14:30:28]      Domino targets: ['essa']
```

Essa's terminal (3 seconds later):
```
[14:30:31]   📥 Events from kael: 4 events accumulated
[14:30:31]   💥 DOMINO from kael: A guard has drawn his sword near Essa's bar...
[14:30:31]      Firing medium (domino-triggered)...
[14:30:34]   ✅ Solid: Essa's palm cracks against the bar...
[14:30:34]      Events: 3 deposited
```

Kael's terminal (3 seconds later):
```
[14:30:37]   📥 Events from essa: 3 events accumulated
```

Those events sit in Kael's block. Next time Kael's player commits, the medium will see them.

---

## What This Proves

When two instances are running on two machines, polling each other's blocks via HTTP:

1. **Sovereignty** — each kernel only writes to its own block, only fires its own medium
2. **Stigmergic coordination** — events propagate through block reads, not messages
3. **Domino triggering** — one character's action can wake another character's medium without their player committing
4. **Accumulation** — events that don't trigger a domino sit in the block waiting for the next commit
5. **Distributed** — no central server, no shared state, just HTTP polling of sovereign JSON endpoints

---

## What This Doesn't Do (Yet)

- **B-loop convergence** — simultaneous conflict resolution. The kernel would need to detect when multiple characters have provisional outputs that interact, hold them, and iterate. The mechanism is tested (see medium-llm-coordination-spec.md) but not yet in the kernel loop.
- **Pscale-based timing** — poll interval is fixed. It should vary by pscale (finer = faster polling, coarser = slower).
- **Dice/rules evaluation** — no mechanical resolution step yet. Would go between accumulation and medium call: read rules block, evaluate, inject skeleton outcome into medium context.
- **Cascade dominos** — the kernel processes dominos it receives but doesn't yet process cascades from its own domino responses (dominos that its medium generates in response to an incoming domino).
- **UI** — this is pure terminal/curl. A browser UI would render the block's `outbox.solid` and provide input fields for liquid/commit instead of curl.
- **Designer face** — the prompt template and constraints are in JSON (layer 2) but there's no UI for editing them yet.

---

## File Inventory

| File | Purpose |
|------|---------|
| `kernel.py` | The kernel. One instance per character. |
| `kael.json` | Character config for Kael (guard). |
| `essa.json` | Character config for Essa (barkeeper). |
| `medium-llm-coordination-spec.md` | Full tested spec with examples. |
| `cc-medium-llm-response.md` | Context for how this relates to CC's original analysis. |

---

## Architecture Notes for CC

**The kernel is layer 1. It should never change during gameplay.** All behavioural variation comes from layer 2 (the JSON blocks). Different characters, different scenes, different rules, different prompt patterns — all JSON. Same kernel.

**The outbox sequence number is the coordination primitive.** Each kernel tracks `last_seen[peer_id]` — the last sequence number it processed from each peer. When a peer's sequence increases, there's new content. This is how deduplication works and how kernels know what's new without timestamps or message IDs.

**The block IS the API.** There's no separate API for "get events" or "send domino." You GET the block. Everything is in it. The outbox is the peer-facing surface. The accumulated array is the private inbox. The kernel moves data from peers' outboxes to its own accumulated array.

**Prompt patterns are in the block, not in the kernel.** The `prompt_template` section contains the role declaration, constraints, and output format. A designer can change how the medium-LLM behaves by editing this JSON. The kernel just reads it and composes the prompt. This is the layer 1 / layer 2 separation in practice.
