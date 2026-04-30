# Xstream SEED — CC Build Spec v3

**Branch**: `feature/block-agents` (create from main)
**Deploy**: Vercel (existing xstream project, team_iTERHQuAAemSTP39REAvULJr)
**Supabase**: Project `piqxyfmzzywxzqkzmpmm` — JSON locker only
**This IS the direction.** Old edge-function architecture is superseded.

---

## One Sentence

Three LLM agents defined as self-describing pscale JSON blocks, reading and writing to other JSON blocks via BSP walks, with Supabase as a dumb store for shared blocks and the browser doing all LLM calls using the player's own API key.

---

## Architecture

```
BROWSER (per player)
  ├── Agent blocks (hard.json, medium.json, soft.json) — bundled in app
  ├── BSP utility — walks blocks, extracts spindles
  ├── Engine files — compose context windows, call Claude, parse responses
  ├── localStorage — character block, knowledge block, API key
  └── Supabase client — read/write JSON blocks by key

SUPABASE (shared JSON locker)
  └── One table: shelf
      ├── thornkeep:spatial     → JSONB (the world)
      ├── thornkeep:events      → JSONB (what has happened)
      ├── thornkeep:rules       → JSONB (constraints)
      ├── thornkeep:characters  → JSONB (who exists, where)
      ├── kael:knowledge        → JSONB (what Kael knows)
      ├── mira:knowledge        → JSONB (what Mira knows)
      └── ...
```

That's the whole infrastructure. One table. JSON in, JSON out.

---

## Supabase Setup

```sql
CREATE TABLE shelf (
  id TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE shelf ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_all" ON shelf FOR ALL TO anon USING (true) WITH CHECK (true);
```

Five lines. Done.

Seed with world blocks from `blocks/worlds/thornkeep/*.json`. Player blocks are created dynamically when a player joins.

---

## How It Works

### The Normal Cycle

```
1. Player types (vapor — ephemeral, in browser only)
2. Player hits ASK → Soft-LLM called
   - Reads: soft.json + frame (cached) + knowledge spindle + vapor
   - Model: Haiku (fast, cheap)
   - Returns: reflection/condensation/fork to help shape intention
   
3. Player hits COMMIT → liquid locked
   - Written to shelf as committed entry in the characters block
   
4. Medium-LLM called
   - Reads: medium.json + frame (cached) + committed text + 
     nearby characters' committed text (from characters block on shelf)
   - Model: Sonnet (synthesis quality)
   - Returns: solid narrative — what happened
   
5. Solid is written:
   - New entry in events block on shelf
   - Knowledge updates to character's knowledge block on shelf
   - Character state/location updated in characters block on shelf
   
6. Next time any player's Hard-LLM reads these blocks, 
   it gets the updated content via BSP. No notification needed.
```

### When Hard-LLM Runs

Hard does NOT run every cycle. It builds a frame (cached context for Soft and Medium) and only reruns when the frame goes stale:

- **On entry**: Player joins. Hard builds initial frame.
- **On location change**: Character moves. Frame rebuilt for new coordinates.
- **Before Medium, if stale**: If significant time has passed or the player suspects things have changed, Hard refreshes before Medium synthesises.
- **Player-triggered**: Player can request a "look around" which triggers Hard to rebuild.

Hard reads:
- Spatial block via BSP at character's coordinates → where am I, what's here
- Events block via BSP filtered by spatial proximity → what happened here
- Characters block → who is nearby
- Rules block via BSP at current location → what constraints apply
- Knowledge block → what my character knows

Hard produces a frame (a JSON object): character_state, proximate_characters, environment, active_rules, available_actions. This frame is cached in the browser and reused by Soft and Medium until it goes stale.

### Multiplayer Coordination

No realtime subscriptions. No push notifications. BSP on shared blocks IS the coordination.

Player A commits an action → Medium writes solid to events block on shelf → 
Player B's Hard-LLM (whenever it next runs) reads events block → 
BSP extracts the new event at that spatial coordinate → 
Player B's frame now includes what Player A did.

This is async. Text game, not console game. When Player B next acts, their Medium-LLM already has Player A's action in the frame context. Coherence through shared blocks.

For concurrent actions (both players acting at similar times): each player's Medium synthesises independently from their perspective. Both write to events. Both events exist. Hard-LLMs on next read see both. Minor inconsistencies are narrative texture, not bugs — two witnesses describe the same event differently.

### Character Knowledge

The critical constraint: **characters don't know what they haven't learned.**

Each character has a knowledge block on the shelf. It starts nearly empty (template). When the character experiences something, Hard-LLM (or Medium-LLM) writes to the knowledge block.

Soft-LLM only references what's in the knowledge block. If the barkeep's name isn't there yet, Soft says "the woman behind the bar." After the character talks to her and Medium produces "She introduced herself as Gull," the engine writes `Gull. Barkeep.` to the knowledge block. Now Soft can say "Gull."

Knowledge block is also stored on shelf (not just localStorage) so it persists across sessions and could be readable by other systems.

---

## File Structure

```
xstream/
├── src/
│   ├── main.tsx
│   ├── App.tsx                      # NEW (~150 lines)
│   ├── lib/
│   │   ├── supabase.ts             # KEEP (exists — client setup)
│   │   ├── bsp.ts                  # NEW (~50 lines)
│   │   ├── claude.ts               # NEW (~30 lines)
│   │   └── shelf.ts                # NEW (~40 lines — read/write JSON by key)
│   ├── blocks/
│   │   └── agents.ts               # NEW — exports hard/medium/soft/faces blocks
│   ├── engine/
│   │   ├── hard.ts                 # NEW (~80 lines)
│   │   ├── medium.ts               # NEW (~70 lines)
│   │   └── soft.ts                 # NEW (~50 lines)
│   ├── components/
│   │   ├── SetupScreen.tsx         # NEW (~60 lines)
│   │   ├── SolidZone.tsx           # NEW simplified
│   │   ├── LiquidZone.tsx          # NEW simplified  
│   │   ├── VapourZone.tsx          # NEW simplified
│   │   └── LogDrawer.tsx           # NEW (~40 lines)
│   └── types/
│       └── index.ts
├── blocks/                          # JSON source files
│   ├── agents/
│   │   ├── hard.json               # PROVIDED
│   │   ├── medium.json             # PROVIDED
│   │   ├── soft.json               # PROVIDED
│   │   └── faces.json              # PROVIDED
│   ├── templates/
│   │   └── knowledge.json          # PROVIDED
│   └── worlds/
│       └── thornkeep/
│           ├── spatial.json        # PROVIDED
│           ├── events.json         # PROVIDED
│           ├── rules.json          # PROVIDED
│           └── characters.json     # PROVIDED
├── scripts/
│   └── seed-shelf.ts               # Reads blocks/*.json → upserts to shelf table
└── supabase/
    └── migrations/
        └── YYYYMMDD_shelf.sql      # 5 lines
```

**Total new code: ~570 lines TypeScript + 5 lines SQL + JSON blocks.**

---

## Build Steps (one commit each)

### Step 1: BSP utility
**File**: `src/lib/bsp.ts` (~50 lines)
**Commit**: `[lib] Add BSP utility`

Four pure functions:
- `bsp(block, address) → string[]` — walk digits, collect spindle
- `bspNode(block, address) → any` — get raw node at address
- `bspSiblings(block, address) → string[]` — X~ navigation
- `blockToText(block, maxDepth) → string` — render for LLM context

Reference implementation is in the xstream-seed.html prototype file (provided).

### Step 2: Shelf client
**File**: `src/lib/shelf.ts` (~40 lines)
**Commit**: `[lib] Add shelf client — read/write JSON by key`

```typescript
import { supabase } from './supabase';

export async function readBlock(id: string): Promise<any | null> {
  const { data } = await supabase.from('shelf').select('data').eq('id', id).single();
  return data?.data ?? null;
}

export async function writeBlock(id: string, block: any): Promise<void> {
  await supabase.from('shelf').upsert({ id, data: block, updated_at: new Date().toISOString() });
}

export async function readBlocksByPrefix(prefix: string): Promise<Array<{ id: string; data: any }>> {
  const { data } = await supabase.from('shelf').select('id, data').like('id', `${prefix}%`);
  return data ?? [];
}
```

Three functions. Read, write, list-by-prefix. That's the entire Supabase interface.

### Step 3: Claude browser caller
**File**: `src/lib/claude.ts` (~30 lines)
**Commit**: `[lib] Add browser Claude API caller`

Single function: `callClaude(apiKey, model, system, user) → string`. Uses `anthropic-dangerous-direct-browser-access` header.

### Step 4: Agent blocks as exports
**File**: `src/blocks/agents.ts`
**Commit**: `[blocks] Export agent block definitions`

Import JSON from `blocks/agents/` and export as typed constants. Bundled in app — not fetched at runtime. 

### Step 5: Supabase migration + seed script
**Files**: `supabase/migrations/...sql` + `scripts/seed-shelf.ts`
**Commit**: `[db] Shelf table and seeding script`

Migration: the 5-line SQL above. Apply to project piqxyfmzzywxzqkzmpmm.

Seed script reads each JSON file from `blocks/worlds/thornkeep/` and upserts to shelf table with appropriate keys (`thornkeep:spatial`, `thornkeep:events`, etc).

### Step 6: Engine — Hard
**File**: `src/engine/hard.ts` (~80 lines)
**Commit**: `[engine] Hard-LLM — BSP walks, frame production`

1. Read spatial, events, characters, rules blocks from shelf
2. BSP-extract spindles at character's coordinates from each block
3. BSP-extract from character's knowledge block
4. Compose system prompt: `blockToText(HARD_BLOCK)`
5. Compose user message: all spindles + trigger + face
6. Call Claude (Sonnet)
7. Parse frame JSON from response
8. Parse knowledge updates (things character should now know)
9. Return `{ frame, knowledgeUpdates, locationChange? }`

### Step 7: Engine — Soft
**File**: `src/engine/soft.ts` (~50 lines)
**Commit**: `[engine] Soft-LLM — vapor refinement`

1. BSP-extract from knowledge block at relevant address
2. Compose system prompt: `blockToText(SOFT_BLOCK)`
3. User message: frame extract (cached) + knowledge spindle + vapor + recent solid
4. Call Claude (Haiku)
5. Return response text

### Step 8: Engine — Medium
**File**: `src/engine/medium.ts` (~70 lines)
**Commit**: `[engine] Medium-LLM — synthesis`

1. Read characters block from shelf → find nearby characters' committed content
2. Read knowledge block
3. Compose system prompt: `blockToText(MEDIUM_BLOCK)`
4. User message: cached frame + own committed + nearby committed + knowledge spindle
5. Call Claude (Sonnet)
6. Parse solid narrative + knowledge updates
7. Return `{ solid, knowledgeUpdates, eventEntry }`

After Medium returns, calling code:
- Reads events block from shelf, adds new entry at appropriate address, writes back
- Updates knowledge block (localStorage + shelf)
- Updates character entry in characters block on shelf (state, possibly location)
- If location changed → re-run Hard

### Step 9: SetupScreen
**File**: `src/components/SetupScreen.tsx` (~60 lines)
**Commit**: `[ui] Setup screen`

API key input, character name input, world selector (just "Thornkeep" for now), ENTER button. Stores key in localStorage. Validates format.

### Step 10: App shell + zones
**Files**: `src/App.tsx` + zone components
**Commit**: `[ui] App shell with three zones and engine wiring`

Replace existing App.tsx on this branch. Three zones (solid/liquid/vapor). Input with ASK + COMMIT. LogDrawer. Face selector. Export button.

Wiring:
```
ASK → runSoft(vapor, cachedFrame, knowledge) → display in vapor zone
COMMIT → write committed to characters block on shelf →
  runMedium(committed, cachedFrame, nearbyCommitted, knowledge) →
  write event to events block on shelf →
  write knowledge updates → display solid →
  IF location changed: runHard()

On entry → runHard(trigger: 'entry') → cache frame → ready
"Look around" button → runHard(trigger: 'refresh') → update frame
```

### Step 11: Character lifecycle
**Commit**: `[multiplayer] Character registration and persistence`

On join:
- Create knowledge block from template, write to shelf as `{name}:knowledge`
- Add character entry to characters block on shelf
- Run Hard to build initial frame

On subsequent visits:
- Read knowledge from shelf (not just localStorage)
- Resume with accumulated knowledge

On "look around" or periodic check:
- Re-read shared blocks from shelf (events, characters)
- Run Hard if anything changed in vicinity

---

## What Gets Deleted (on this branch only)

- `supabase/functions/generate-v2/` — replaced by browser engines
- `supabase/functions/hard-llm/` — replaced by browser engines
- `supabase/functions/machus-agent/` — unrelated to this branch
- Old `src/App.tsx` (990 lines)
- Old hooks referencing removed edge functions
- Old components tightly coupled to old architecture

Keep all of this on main. Delete only on `feature/block-agents`.

---

## Provided Files

All JSON blocks are provided and should be committed to `blocks/` as-is:

**Agent blocks** (bundled in app):
- `blocks/agents/hard.json`
- `blocks/agents/medium.json`
- `blocks/agents/soft.json`
- `blocks/agents/faces.json`

**Templates**:
- `blocks/templates/knowledge.json`

**Thornkeep world** (seeded to shelf):
- `blocks/worlds/thornkeep/spatial.json` — floor depth 2, pscale 0 = room
- `blocks/worlds/thornkeep/events.json` — four starting events
- `blocks/worlds/thornkeep/rules.json` — location-specific constraints
- `blocks/worlds/thornkeep/characters.json` — four NPCs

**Reference prototype**:
- `xstream-seed.html` — working single-file prototype with BSP, engine logic, and UI

---

## Testing

### Smoke test (solo)
1. Open deployed URL
2. Enter API key + character name "Kael"
3. ASK: "What do I see?" → Soft responds using frame (should NOT name Gull)
4. COMMIT: "I walk to the bar and introduce myself"
5. Medium synthesises → solid appears → should describe the interaction
6. ASK: "What's her name?" → Soft should now know (if Medium's solid mentioned it and knowledge was updated)

### Multiplayer test
1. Player A enters as Kael
2. Player B enters as Mira (different browser)
3. Player A commits an action in the Salted Dog
4. Player B hits "look around" or their Hard runs → their frame now includes Kael's presence and recent action
5. Player B commits a response → Player A sees it on their next refresh

### Knowledge accumulation test
1. Fresh character — knowledge block is template
2. Talk to NPCs → knowledge block grows
3. Export knowledge → readable JSON showing what was learned
4. Close browser, reopen → knowledge loaded from shelf, character remembers

---

## Key Principles

1. **Everything is a JSON block.** No SQL queries, no relational tables, no events-as-rows. Blocks and BSP.
2. **If you are writing prompt text in TypeScript, you are doing it wrong.** All LLM instructions live in JSON blocks.
3. **Hard runs rarely. Frame is cached.** Most cycles are Soft (Haiku) + Medium (Sonnet). Two LLM calls per action.
4. **Supabase is a JSON locker.** One table. Read/write by key. No realtime subscriptions needed.
5. **No engine file exceeds 80 lines.** If it does, logic belongs in a block.
6. **Coordination through shared blocks, not messaging.** BSP on the same block from different players' LLMs = shared context without communication overhead.
