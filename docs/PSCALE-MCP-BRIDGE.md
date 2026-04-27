# pscale-mcp bridge — `feature/pscale-mcp`

Branch that adds a pscale-mcp substrate bridge to xstream-play. Deployed at **xstream.onen.ai** (alongside the unchanged sovereign-localStorage version still at play.onen.ai).

## What this branch adds

A toggle on the setup screen — **pscale-mcp bridge** — that, when on:

1. **Pulls live world canon from the substrate.** On game create / join, fetches `thornkeep-gm/thornkeep-world` from the pscale-mcp Supabase relay and overlays it onto the local `spatial-thornkeep` block. Author observations integrated by the pscale-mcp world-compressor (running as a launchd daemon on the GM's mac) appear in the player's experience within a polling cycle.
2. **Identity validation.** Player provides their pscale-mcp `agent_id` + passport secret. Validated by reading their passport block from the substrate. Secret stays in `sessionStorage` (cleared on tab close) — never written to disk.
3. **Author write-through.** When face=author, the player's commit is mirrored to their pscale-mcp `{agent_id}/thornkeep-observations` block (with secret-verified ownership). The local kernel still runs its medium-LLM synthesis as before — the bridge is a *parallel* write, not a replacement. The world-compressor on the substrate side picks it up within ~60s and integrates into canon.

When the bridge is off, behaviour is unchanged: pure browser, localStorage-only, sovereign mode.

## What it deliberately does NOT do (yet)

- **Runtime kernel state stays on xstream-play's existing Supabase relay** (`relay_blocks`). Peer kernel polling at 3s is the right tool for that; pscale-mcp's substrate isn't optimised for sub-second polling.
- **Multi-game scaffolding** — Thornkeep is still hardcoded. Multi-game requires a `BRIDGE_MAP` configurator, planned for a follow-up.
- **Designer face write-through** — wiring exists; UI mode toggle for designer face is a separate PENDING from `STATUS.md`.
- **The MCP-via-Claude info-hiding kernel** (Option 4 from the handover) — remains a separate future track.

## File map

| File | Change |
|---|---|
| `src/lib/pscale-mcp.ts` | NEW. Bridge module: read/write `pscale_blocks`, lock-hash, observation write helper. |
| `src/kernel/block-store.ts` | Added `overlayBlocks()` for runtime block injection. |
| `src/components/SetupScreen.tsx` | Bridge toggle + agent_id/secret inputs + validation. |
| `src/App.tsx` | Calls `fetchBridgedBlocks()` before kernel start; mirrors author commits via `writeObservation()`. |

## Deployment

`xstream.onen.ai` (Vercel project `xstream-play`, branch `feature/pscale-mcp`). Domain alias to be set:
1. In the Vercel dashboard for `xstream-play`, add `xstream.onen.ai` as a domain.
2. Set its branch to `feature/pscale-mcp` instead of `main`.
3. `play.onen.ai` continues serving `main` — sovereign mode, no breakage.

## Smoke test (after deploy)

1. Visit xstream.onen.ai.
2. Enter Anthropic API key + character name.
3. Tick "pscale-mcp bridge" — enter agent_id + secret.
4. Create game. The world should fetch from pscale-mcp; check console: `[pscale-mcp] overlaid blocks: ['spatial-thornkeep']`.
5. Walk into Market Square — should mention Ennick the hawker (the author observation we integrated 2026-04-27).
6. Switch to author face. Commit "the cobblestones near the well are darker, polished by centuries of footfalls." Watch the kernel log for `🌊 pscale-mcp: observation written at position N`.
7. Wait ~60s for the world-compressor on the GM's mac to integrate.
8. Reload the page (or create a fresh session) — Market Square should now mention the polished cobblestones.

## Compatibility notes

- The `pscale_blocks` table is shared with the pscale-mcp server and the existing xstream-play relay's `relay_blocks`. RLS is open-beta; both projects use the same Supabase anon key.
- The bridge does not alter any existing data. Writes target `{agent_id}/thornkeep-observations` (locked by the player's secret); reads target `thornkeep-gm/thornkeep-world` (read-only on the xstream side).
- Sovereign-mode players (bridge off) are unaffected. Their data stays in localStorage / `relay_blocks`.

## What lands next

In priority order (see `docs/beach-game-handbook.md` §10 in the pscale-mcp-server repo for the full PENDING list):

1. **Resolver as long-running daemon** (sibling to compressor, on the GM's mac).
2. Designer face UI toggle in xstream-play (agent blocks already exist; just wire the UI).
3. Multi-game scaffold — let the bridge fetch from `{game}-gm/{game}-world` parameterised.
4. Author-side preview / dry-run on the compressor.
5. Hosted Anthropic endpoint (no API key required) — Supabase edge function proxy.

## Troubleshooting

- **"No passport found for X"**: the agent_id you entered doesn't have a published passport on pscale-mcp. Run `pscale_passport_publish` on the pscale-mcp side first.
- **"Block is locked. Secret required."** when committing an author observation: the secret you entered doesn't match the lock on `{agent_id}/thornkeep-observations` — check the secret you used at registration time.
- **Bridge enabled but world doesn't update**: check the Network tab for failed Supabase queries; check that `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` env vars are set in Vercel.
- **Console warning about dynamic import of supabase**: harmless build-time warning; the supabase module is imported both statically (by auth.ts and pscale-mcp.ts) and dynamically (by persistence.ts). Vite collapses it to a single chunk.
