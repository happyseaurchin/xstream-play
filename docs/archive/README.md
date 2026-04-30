# docs/archive — pre-bsp-mcp game-era documents

**Do NOT use these as orientation.** Canonical orientation lives in [../../CLAUDE.md](../../CLAUDE.md).

These files are retained for historical reference only. They were written for an earlier iteration of this project — `xstream-play` as a multiplayer narrative RPG built on the (now legacy) `pscale-mcp-server`'s 25-tool surface. That whole approach has been superseded.

What changed:

- The substrate moved from pscale-mcp (25 categorised tools) to **bsp-mcp** (one `bsp()` function plus five non-geometric primitives — six entry points total).
- The teaching block moved from `pscale-touchstone.json` to **sunstone.json** (in `pscale-commons/bsp-mcp-server/src/`).
- The operational reference moved from `bsp.js` to **whetstone.json** (same location).
- The product itself reframed from "narrative RPG" to **xstream beach client** — a real-world coordination interface against federated beaches via bsp-mcp, with the V/L/S surface as the user's reflexive engagement (not as a fiction-narration loop).

The runtime code in `src/` is bsp-mcp-native and has nothing to do with anything described in these archive files. References in here to `spatial-thornkeep`, `character-essa`, `relay_blocks`, the game kernel, the pscale-mcp bridge, GRIT-as-narrative-coordination, the Salty Dog, etc. — all gone from runtime.

Files retained:

| File | What it described |
|---|---|
| `BLOCK-GUIDE.md` | Authoring guide for the legacy game blocks; pointed at touchstone + bsp.js |
| `HANDOVER-SESSION-{01..04}.md` | Session handovers from the game-era iteration |
| `PROMPT-FOR-HERMITCRAB.md` | A prompt for a different project (hermitcrab); may belong elsewhere |
| `PSCALE-MCP-BRIDGE.md` | Documented the pscale-mcp bridge (deleted in the bsp-mcp-native cut) |
| `STATUS.md` | Status snapshot from the game-era iteration |
| `cc-seed-spec-v3.md` | Game-kernel seeding spec |
| `example-{essa,kael}.json` | Game character blocks |
| `kernel-architecture-for-cc.md` | Game kernel design |
| `kernel-reference.py` | Python kernel reference (game) |
| `medium-llm-coordination-spec.md` | Game-mode medium-LLM spec |
| `onen-rpg-xstream-architecture.md` | The fantasy game architecture as a whole |

If anything in here is genuinely useful for the beach client, lift it into a fresh doc under `../` with bsp-mcp-aligned framing — don't link from current code or CLAUDE.md back into this directory.
