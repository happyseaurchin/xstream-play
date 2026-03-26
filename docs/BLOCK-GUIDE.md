# XStream Play: Pscale Block Guide for CC

## What These Blocks Are

Five JSON files that replace the hardcoded prompt templates and scene descriptions in xstream-play. Each is a pscale block — a nested JSON structure where underscore (`_`) is digit zero, keys `1`-`9` are branches, and the BSP function walks the tree by splitting a number into digits.

**Before you touch any code, read the touchstone:**
```
https://raw.githubusercontent.com/pscale-commons/pscale/main/pscale-touchstone.json
```
It teaches the format by being an operational example of it.

**And implement or import `bsp.js`:**
```
https://raw.githubusercontent.com/pscale-commons/pscale/main/bsp.js
```
`bsp(block, number, mode?)` is the single function that replaces all direct field access.

---

## The Five Blocks

| Block | File | What it replaces | Form | Floor |
|-------|------|-----------------|------|-------|
| **medium-agent** | `medium-agent.json` | `DEFAULT_PROMPT_TEMPLATE` in block-factory.ts, prompt assembly in prompt.ts | Form 1 (rendition) | 1 |
| **soft-agent** | `soft-agent.json` | Inline soft-LLM prompt in App.tsx (~lines 179-186) | Form 1 (rendition) | 1 |
| **hard-agent** | `hard-agent.json` | Nothing yet — hard-LLM doesn't exist. This defines it. | Form 1 (rendition) | 1 |
| **spatial-thornkeep** | `spatial-thornkeep.json` | Static scene description string in block-factory.ts | Form 1 (spatial) | 3 |
| **rules-thornkeep** | `rules-thornkeep.json` | Nothing yet — rules are implicit. This makes them explicit. | Form 1 (rendition) | 1 |

---

## How BSP Walks Replace Field Access

### Current (bad — direct field access):
```typescript
const prompt = block.prompt_template.role + '\n' +
  block.prompt_template.constraints.join('\n') + '\n' +
  block.prompt_template.output_format;
```

### Target (good — BSP walks):
```typescript
import { bsp } from './bsp';
import mediumAgent from '../blocks/xstream/medium-agent.json';

// Role section: walk to 0.1, get full subtree
const role = bsp(mediumAgent, 0.1, 'dir');

// Constraints: walk to 0.2, get full subtree  
const constraints = bsp(mediumAgent, 0.2, 'dir');

// Output schema: walk to 0.3, get full subtree
const schema = bsp(mediumAgent, 0.3, 'dir');

// Trigger-specific instructions: branch by trigger type
const triggerAddress = triggerType === 'commit' ? 0.41 
  : triggerType === 'domino' ? 0.42 
  : 0.43; // convergence
const triggerInstructions = bsp(mediumAgent, triggerAddress, 'dir');

// Response format
const format = bsp(mediumAgent, 0.7, 'dir');
```

The number IS the query. Change the number, get different content. Change the block, change the behaviour. The kernel code stays the same.

---

## medium-agent.json — Address Map

This is the most important block. It encodes the entire coordination architecture.

| Address | What's there | Used by |
|---------|-------------|---------|
| `0._` | Block identity — one sentence describing the medium-LLM | System prompt preamble |
| `0.1` | Role — what the medium is and does | System prompt |
| `0.2` | Constraints — all rules the medium must respect | System prompt |
| `0.21` | Position-constrained perception | Medium prompt |
| `0.22` | Canon as established fact | Medium prompt |
| `0.23` | Physical reality constraint | Medium prompt |
| `0.24` | Honest failure over forced success | Medium prompt |
| `0.25` | No inventing events | Medium prompt |
| `0.26` | Solid history continuity | Medium prompt |
| `0.3` | Output schema — all six output fields | System prompt |
| `0.31` | solid narrative spec | Medium prompt |
| `0.32` | events skeleton spec | Medium prompt |
| `0.33` | domino signals spec | Medium prompt |
| `0.34` | internal state spec | Medium prompt |
| `0.35` | provisional flag spec | Medium prompt |
| `0.36` | interacts_with spec | Medium prompt |
| `0.4` | Trigger modes — how the medium is invoked | Kernel + medium prompt |
| `0.41` | commit mode instructions | Medium prompt (on commit) |
| `0.42` | domino mode instructions | Medium prompt (on domino) |
| `0.43` | convergence mode instructions | Medium prompt (on B-loop) |
| `0.5` | Domino behaviour modes | Kernel only (not sent to medium) |
| `0.51` | auto — full autonomy | Kernel reads to decide whether to fire |
| `0.52` | informed — perceive only | Kernel reads to decide |
| `0.53` | silent — accumulate only | Kernel reads to decide |
| `0.6` | Coordination principles | Designer documentation / optional system prompt |
| `0.7` | Response format — exact JSON shapes | Medium prompt |

### Key distinction: sections 1-4 and 7 are sent to the medium-LLM. Section 5 is read by the kernel. Section 6 is documentation.

---

## soft-agent.json — Address Map

| Address | What's there | Used by |
|---------|-------------|---------|
| `0._` | Block identity — inner voice | System prompt |
| `0.1` | Role — thinking companion | System prompt |
| `0.2` | Knowledge gating rules | System prompt |
| `0.3` | Response style | System prompt |
| `0.4` | What context it receives | Kernel (composition guide) |
| `0.5` | Response format (plain text) | System prompt |

The soft-LLM gets: `bsp(softAgent, 0.1, 'dir')` + `bsp(softAgent, 0.2, 'dir')` + `bsp(softAgent, 0.3, 'dir')` as system prompt. Plus the character state, scene frame, and solid history as context.

---

## hard-agent.json — Address Map

| Address | What's there | Used by |
|---------|-------------|---------|
| `0._` | Block identity — world reader | System prompt |
| `0.1` | Role — frame builder | System prompt |
| `0.2` | What it reads (spatial, events, characters, rules) | System prompt + kernel |
| `0.3` | What it produces (frame schema) | System prompt |
| `0.4` | When it runs (triggers) | Kernel |
| `0.5` | Response format | System prompt |

The hard-LLM is the link between world blocks and the other two agents. Its frame output replaces the static scene string.

---

## spatial-thornkeep.json — How BSP Walks Produce Scene Context

This block uses floor 3 addressing (accumulation): `111` = room, `110` = building, `100` = village.

### Walking to the main room of the Salted Dog:

```typescript
bsp(spatial, 111, 'spindle')
// Returns chain:
//   0._ = "The Broken Coast — rocky shoreline..."
//   1._ = "Thornkeep — a village of two hundred..."  
//   1.1._ = "The Salted Dog — Thornkeep's only tavern..."
//   1.1.1._ = "Main room — low ceiling, stone hearth..."
```

Three levels of context narrowing to the specific room. The hard-LLM receives this spindle and extracts the scene description.

### Getting room details (hearth, bar, tables):

```typescript
bsp(spatial, 111, 'dir')
// Returns the main room node plus all its children:
//   1.1.1.1 = The hearth
//   1.1.1.2 = The bar
//   1.1.1.3 = The corner table
//   1.1.1.4 = The front door
//   1.1.1.5 = The common floor
```

### Getting nearby locations (siblings):

```typescript
bsp(spatial, 111, 'ring')
// Returns siblings of main room within the Salted Dog:
//   1.1.2 = Back room
//   1.1.3 = Stairs up
```

The hard-LLM uses these to determine what sounds or effects carry from adjacent spaces.

---

## rules-thornkeep.json — How Rules Enter the Medium's Context

The hard-LLM walks the rules block at the current location and includes applicable rules in the frame. The medium-LLM then sees these as constraints:

```typescript
// Hard-LLM building frame for a character in the Salted Dog:
const tavernRules = bsp(rules, 0.11, 'dir');
// Returns: weapon norms, stranger protocol, back room etiquette

const conflictRules = bsp(rules, 0.2, 'dir');
// Returns: narrative resolution, optional dice, domino physics

const perceptionRules = bsp(rules, 0.3, 'dir');
// Returns: vision lines, sound propagation, smell/temperature
```

These go into the frame's `applicable_rules` field. The medium-LLM reads them as part of its context and respects them when producing narrative.

---

## Implementation Order

1. **Import `bsp.js`** into the xstream-play project. It's a single function.

2. **Load the blocks** — `medium-agent.json` and `soft-agent.json` as static imports or fetched at startup.

3. **Refactor `prompt.ts`** — replace direct field access with BSP walks of the medium-agent block. The address map above tells you exactly which walk produces which section of the prompt.

4. **Refactor the soft-LLM prompt** in App.tsx — replace the inline string with BSP walks of the soft-agent block.

5. **Load `spatial-thornkeep.json`** as the world block. Replace the static scene string with a BSP walk at the character's location.

6. **Build the hard-LLM** using `hard-agent.json` as its identity block. It reads spatial + rules blocks via BSP and produces a frame.

7. **Load `rules-thornkeep.json`** and have the hard-LLM include applicable rules in the frame.

Steps 1-4 are the critical path — they convert the existing working system from hardcoded to BSP-native without changing functionality. Steps 5-7 add new capability.

---

## The Test

After step 4, the game should behave identically to before — same prompts, same outputs, same coordination. The only difference is where the prompt text comes from (BSP walks of blocks vs hardcoded strings). If anything changes in behaviour, the BSP walks are composing differently than the original strings. Compare the assembled prompts side by side to find the discrepancy.

After step 7, the scene descriptions should be richer and position-aware — the hard-LLM produces a perception frame tailored to each character's location, rather than everyone seeing the same static text.

---

## The Principle

**If you are writing prompt text in TypeScript, you are doing it wrong.**

Every behavioural change should be a block edit, not a code change. The kernel walks blocks. The blocks contain all intelligence. The designer face (eventually) edits blocks through the UI. The kernel never changes.
