"""
Sovereign Medium-LLM Kernel
============================

One instance per character. Each kernel:
  1. Serves its own JSON block via HTTP (readable by any peer)
  2. Polls peers' blocks to discover new events and domino signals
  3. Fires the medium-LLM when trigger conditions are met
  4. Writes results back to its own block (sovereign — never writes to peers)

Two instances on two machines = distributed multiplayer coordination.
No central server. No database. No WebSocket. Just JSON over HTTP.

Usage:
  Machine A:  python kernel.py --config kael.json --port 8001
  Machine B:  python kernel.py --config essa.json --port 8002

The block IS the transport. The kernel IS the loop. Intelligence IS in the blocks.
"""

import json
import time
import copy
import threading
import argparse
import sys
from http.server import HTTPServer, BaseHTTPRequestHandler
from datetime import datetime, timezone

# Optional: pip install httpx for async HTTP. Falls back to urllib.
try:
    import httpx
    HAS_HTTPX = True
except ImportError:
    import urllib.request
    HAS_HTTPX = False


# ============================================================
# BLOCK STRUCTURE
# ============================================================
# This is the canonical block shape. Character configs override
# the character-specific fields. Everything else is runtime state.

DEFAULT_BLOCK = {
    # ── Layer 2: Content (designer-editable) ──
    "character": {
        "id": "",
        "name": "",
        "state": "",          # Position, skills, knowledge, possessions
        "solid_history": []   # Previous solids — canon for this character
    },
    "scene": "",              # Shared spatial/environmental context
    "peers": [],              # URLs of other kernels' blocks
    "trigger": {
        "poll_interval_s": 3,         # How often to fetch peers (pscale timing)
        "domino_fires_medium": True,  # Auto-fire medium on domino discovery
        "accumulation_threshold": 0   # 0 = don't auto-fire on accumulation alone
    },
    "medium": {
        "model": "claude-haiku-4-5-20251001",
        "api_key": "",        # Set in config, not committed to repo
        "max_tokens": 800
    },
    "prompt_template": {
        # These are layer-2 content — designer face edits these
        "role": "You are the medium-LLM for {name} in a narrative coordination system.",
        "constraints": [
            "{name} can ONLY perceive what their POSITION and ATTENTION allow.",
            "Accumulated events are ESTABLISHED FACT — incorporate them.",
            "Physical reality matters: distance, timing, what's reachable.",
            "If accumulated events contradict the intention, resolve honestly.",
            "Do not invent major events not implied by the liquid or accumulated context."
        ],
        "output_instruction": "Respond in JSON only. No markdown. No backticks."
    },

    # ── Layer 0: Runtime state (kernel-managed) ──
    "pending_liquid": None,   # Player's submitted intention
    "accumulated": [],        # Events from peers, not yet incorporated
    "outbox": {
        "solid": None,        # Latest solid narrative (for player display)
        "events": [],         # Observable events (peers read these)
        "domino": [],         # Domino signals addressed to specific peers
        "sequence": 0,        # Monotonic counter — peers track what they've seen
        "timestamp": None
    },
    "status": "idle",         # idle | waiting | resolving | domino_responding
    "last_seen": {}           # {peer_id: last_sequence_seen} — dedup tracking
}


# ============================================================
# HTTP SERVER — serves this kernel's block as GET /block
# ============================================================

class BlockServer(BaseHTTPRequestHandler):
    """Minimal HTTP server. GET /block returns the JSON block.
    POST /liquid accepts player input."""

    block_ref = None  # Set by main thread

    def do_GET(self):
        if self.path == "/block":
            data = json.dumps(self.block_ref, indent=2).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.write(data)
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        if self.path == "/liquid":
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length).decode()
            try:
                data = json.loads(body)
                self.block_ref["pending_liquid"] = data.get("liquid", body)
                self.block_ref["status"] = "waiting"
                log(f"  ✏️  Liquid received: {str(self.block_ref['pending_liquid'])[:60]}...")
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(b'{"ok":true}')
            except Exception as e:
                self.send_response(400)
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode())
        elif self.path == "/commit":
            # Player hits commit — trigger medium
            self.block_ref["status"] = "resolving"
            log("  ⚡ Commit received — medium will fire on next cycle")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"ok":true,"status":"resolving"}')
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        pass  # Suppress default HTTP logging

    def write(self, data):
        """Helper to handle broken pipe gracefully."""
        try:
            self.wfile.write(data)
        except BrokenPipeError:
            pass


# ============================================================
# PEER POLLING — discover events and dominos
# ============================================================

def fetch_peer_block(url):
    """Fetch a peer's block via HTTP GET."""
    try:
        if HAS_HTTPX:
            r = httpx.get(url, timeout=5)
            return r.json()
        else:
            req = urllib.request.Request(url)
            with urllib.request.urlopen(req, timeout=5) as resp:
                return json.loads(resp.read().decode())
    except Exception as e:
        return None


def poll_peers(block):
    """Check all peers for new events and dominos addressed to us.
    Returns (new_events, new_dominos)."""

    my_id = block["character"]["id"]
    new_events = []
    new_dominos = []

    for peer_url in block["peers"]:
        peer_block = fetch_peer_block(peer_url)
        if not peer_block:
            continue

        peer_id = peer_block.get("character", {}).get("id", "unknown")
        peer_outbox = peer_block.get("outbox", {})
        peer_seq = peer_outbox.get("sequence", 0)

        # Check if we've already seen this sequence
        last_seen = block["last_seen"].get(peer_id, 0)
        if peer_seq <= last_seen:
            continue  # Nothing new

        # New events from this peer
        events = peer_outbox.get("events", [])
        if events:
            new_events.append({
                "source": peer_id,
                "events": events,
                "sequence": peer_seq
            })

        # Dominos addressed to us
        for d in peer_outbox.get("domino", []):
            target = d.get("target", "").lower()
            if target == my_id:
                new_dominos.append({
                    "source": peer_id,
                    "context": d.get("context", ""),
                    "urgency": d.get("urgency", "soon"),
                    "sequence": peer_seq
                })

        # Update tracking
        block["last_seen"][peer_id] = peer_seq

    return new_events, new_dominos


# ============================================================
# MEDIUM-LLM CALL
# ============================================================

def build_medium_prompt(block, trigger_type="commit", domino_context=None):
    """Compose the medium-LLM prompt from block contents."""

    char = block["character"]
    tmpl = block["prompt_template"]
    name = char["name"]

    # Role
    role = tmpl["role"].format(name=name)

    # Scene
    scene_section = f"SCENE:\n{block['scene']}"

    # Character
    char_section = f"CHARACTER — {name}:\n{char['state']}"

    # Solid history (last 3 for continuity)
    history = char.get("solid_history", [])[-3:]
    if history:
        history_section = f"PREVIOUS NARRATIVE (canon for {name}):\n" + "\n".join(
            f"• {s}" for s in history
        )
    else:
        history_section = ""

    # Accumulated context
    acc = block.get("accumulated", [])
    if acc:
        acc_section = "ACCUMULATED CONTEXT (CANON — already happened):\n" + "\n\n".join(
            f"[Established by {a['source']}'s resolution]\n" +
            "\n".join(f"• {e}" for e in a["events"])
            for a in acc
        )
    else:
        acc_section = "ACCUMULATED CONTEXT: Nothing accumulated from other characters."

    # Intention section depends on trigger type
    if trigger_type == "commit":
        liquid = block.get("pending_liquid", "")
        intent_section = f"{name}'S COMMITTED INTENTION (liquid):\n{liquid}"
    elif trigger_type == "domino":
        intent_section = f"DOMINO TRIGGER (what just happened to {name}):\n{domino_context}"
        liquid = block.get("pending_liquid")
        if liquid:
            intent_section += (
                f"\n\n{name}'S PENDING LIQUID (submitted before domino — "
                f"may be used or overridden by events):\n{liquid}"
            )

    # Constraints
    constraints = "\n".join(f"- {c.format(name=name)}" for c in tmpl["constraints"])

    # Output schema
    output = tmpl["output_instruction"]

    prompt = f"""{role}

{scene_section}

{char_section}

{history_section}

{acc_section}

{intent_section}

RULES:
{constraints}

Produce:
(a) SOLID — 2-4 sentences, {name}'s sensory perspective only
(b) EVENTS — 2-5 observable facts others could perceive (NOT internal thoughts)
(c) DOMINO — characters directly affected who must respond immediately. 
    Each entry: {{"target": "char_id", "context": "what happened to them", "urgency": "immediate"}}
    Empty list if action is self-contained.
(d) INTERNAL — one sentence on {name}'s mental state

{output}
{{"solid":"narrative","events":["event"],"domino":[],"internal":"state"}}"""

    return prompt


def call_medium(block, trigger_type="commit", domino_context=None):
    """Call the medium-LLM and return parsed response."""

    prompt = build_medium_prompt(block, trigger_type, domino_context)
    config = block["medium"]

    try:
        if HAS_HTTPX:
            r = httpx.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": config["api_key"],
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json"
                },
                json={
                    "model": config["model"],
                    "max_tokens": config["max_tokens"],
                    "messages": [{"role": "user", "content": prompt}]
                },
                timeout=45
            )
            data = r.json()
        else:
            req_data = json.dumps({
                "model": config["model"],
                "max_tokens": config["max_tokens"],
                "messages": [{"role": "user", "content": prompt}]
            }).encode()
            req = urllib.request.Request(
                "https://api.anthropic.com/v1/messages",
                data=req_data,
                headers={
                    "x-api-key": config["api_key"],
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json"
                }
            )
            with urllib.request.urlopen(req, timeout=45) as resp:
                data = json.loads(resp.read().decode())

        text = data.get("content", [{}])[0].get("text", "")
        cleaned = text.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
        return json.loads(cleaned)

    except Exception as e:
        log(f"  ❌ Medium call failed: {e}")
        return None


# ============================================================
# BLOCK UPDATE — process medium output
# ============================================================

def process_medium_output(block, result, trigger_type="commit"):
    """Write medium output to the block's outbox and update state."""

    if not result:
        block["status"] = "idle"
        return

    # Update outbox (this is what peers will read)
    block["outbox"]["solid"] = result.get("solid")
    block["outbox"]["events"] = result.get("events", [])
    block["outbox"]["domino"] = result.get("domino", [])
    block["outbox"]["sequence"] += 1
    block["outbox"]["timestamp"] = datetime.now(timezone.utc).isoformat()

    # Add to own solid history
    if result.get("solid"):
        block["character"]["solid_history"].append(result["solid"])
        # Keep last 10
        block["character"]["solid_history"] = block["character"]["solid_history"][-10:]

    # Clear accumulated (it's been incorporated)
    block["accumulated"] = []

    # Clear liquid if it was a commit (domino may preserve it)
    if trigger_type == "commit":
        block["pending_liquid"] = None

    # If liquid was overridden by domino, clear it
    if trigger_type == "domino" and result.get("liquid_status") == "overridden":
        block["pending_liquid"] = None

    block["status"] = "idle"


# ============================================================
# LOGGING
# ============================================================

def log(msg):
    ts = datetime.now().strftime("%H:%M:%S")
    print(f"[{ts}] {msg}")


# ============================================================
# MAIN LOOP — the kernel
# ============================================================

def run_kernel(block, port):
    """The kernel loop. Mechanical. All decisions come from the block."""

    name = block["character"]["name"]
    poll_interval = block["trigger"]["poll_interval_s"]

    log(f"🦀 Kernel started: {name} on port {port}")
    log(f"   Peers: {block['peers']}")
    log(f"   Poll interval: {poll_interval}s")
    log(f"   Model: {block['medium']['model']}")
    log(f"   Submit liquid:  curl -X POST http://localhost:{port}/liquid -d '{{\"liquid\":\"I do something\"}}'")
    log(f"   Hit commit:     curl -X POST http://localhost:{port}/commit")
    log(f"   View block:     curl http://localhost:{port}/block")
    log("")

    cycle = 0
    while True:
        cycle += 1
        time.sleep(poll_interval)

        # ── STEP 1: Poll peers ──
        new_events, new_dominos = poll_peers(block)

        # Accumulate new events
        for ev in new_events:
            block["accumulated"].append({
                "source": ev["source"],
                "events": ev["events"]
            })
            log(f"  📥 Events from {ev['source']}: {len(ev['events'])} events accumulated")

        # ── STEP 2: Check domino triggers ──
        if new_dominos and block["trigger"]["domino_fires_medium"]:
            for domino in new_dominos:
                log(f"  💥 DOMINO from {domino['source']}: {domino['context'][:60]}...")
                log(f"     Firing medium (domino-triggered)...")

                block["status"] = "domino_responding"
                result = call_medium(block, trigger_type="domino",
                                     domino_context=domino["context"])
                if result:
                    process_medium_output(block, result, trigger_type="domino")
                    log(f"  ✅ Solid: {result.get('solid', '?')[:80]}...")
                    log(f"     Events: {len(result.get('events', []))} deposited")
                    domino_out = result.get("domino", [])
                    if domino_out:
                        log(f"     Cascade dominos: {[d.get('target','?') for d in domino_out if isinstance(d,dict)]}")

        # ── STEP 3: Check player commit ──
        if block["status"] == "resolving":
            liquid = block.get("pending_liquid")
            if liquid:
                log(f"  🎯 Player committed. Firing medium...")
                log(f"     Liquid: {str(liquid)[:60]}...")
                log(f"     Accumulated: {len(block['accumulated'])} deposits")

                result = call_medium(block, trigger_type="commit")
                if result:
                    process_medium_output(block, result, trigger_type="commit")
                    log(f"  ✅ Solid: {result.get('solid', '?')[:80]}...")
                    log(f"     Events: {len(result.get('events', []))} deposited")
                    domino_out = result.get("domino", [])
                    if domino_out:
                        log(f"     Domino targets: {[d.get('target','?') for d in domino_out if isinstance(d,dict)]}")
                else:
                    block["status"] = "idle"
            else:
                log(f"  ⚠️  Commit received but no liquid pending")
                block["status"] = "idle"

        # ── STEP 4: Periodic status ──
        if cycle % 10 == 0:
            acc_count = len(block["accumulated"])
            seq = block["outbox"]["sequence"]
            log(f"  ⏳ Cycle {cycle} | status={block['status']} | accumulated={acc_count} | sequence={seq}")


# ============================================================
# ENTRY POINT
# ============================================================

def main():
    parser = argparse.ArgumentParser(description="Sovereign Medium-LLM Kernel")
    parser.add_argument("--config", required=True, help="Path to character config JSON")
    parser.add_argument("--port", type=int, default=8001, help="HTTP port to serve block")
    args = parser.parse_args()

    # Load config
    with open(args.config) as f:
        config = json.load(f)

    # Merge config into default block
    block = copy.deepcopy(DEFAULT_BLOCK)
    for key in config:
        if isinstance(config[key], dict) and key in block:
            block[key].update(config[key])
        else:
            block[key] = config[key]

    # Start HTTP server in background thread
    BlockServer.block_ref = block
    server = HTTPServer(("0.0.0.0", args.port), BlockServer)
    server_thread = threading.Thread(target=server.serve_forever, daemon=True)
    server_thread.start()

    # Run the kernel loop (blocks forever)
    try:
        run_kernel(block, args.port)
    except KeyboardInterrupt:
        log(f"🛑 Kernel stopped: {block['character']['name']}")
        server.shutdown()


if __name__ == "__main__":
    main()
