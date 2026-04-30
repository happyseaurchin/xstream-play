/**
 * Cascade test — simulates three characters interacting via medium-LLM.
 *
 * Usage: ANTHROPIC_API_KEY=sk-ant-... node test-cascade.mjs
 *
 * Simulates:
 *   1. Kael commits "I draw my sword and step toward the stranger"
 *   2. If Kael's output has dominos → fire Essa's medium (domino-triggered)
 *   3. If Essa's output has dominos → fire Maren's medium (domino-triggered)
 *   4. Show the full cascade
 */

import { readFileSync } from 'fs';

const API_KEY = process.env.ANTHROPIC_API_KEY;
if (!API_KEY) {
  console.error('Set ANTHROPIC_API_KEY=sk-ant-... before running');
  process.exit(1);
}

// Load the medium-agent block and build prompt the same way prompt.ts does
const mediumAgent = JSON.parse(readFileSync('./blocks/xstream/medium-agent.json', 'utf8'));

function flattenNode(node) {
  if (typeof node === 'string') return [node];
  if (!node || typeof node !== 'object') return [];
  const lines = [];
  if ('_' in node && typeof node._ === 'string') lines.push(node._);
  for (let d = 1; d <= 9; d++) {
    const k = String(d);
    if (k in node) lines.push(...flattenNode(node[k]));
  }
  return lines;
}

function buildPrompt(name, state, scene, solidHistory, accumulated, triggerType, liquid, dominoContext) {
  // Role: root _
  const role = mediumAgent._.replace(/{name}/g, name);

  // Scene
  const sceneSection = `SCENE:\n${scene}`;

  // Character
  const charSection = `CHARACTER — ${name}:\n${state}`;

  // History
  const history = solidHistory.slice(-3);
  const historySection = history.length > 0
    ? `PREVIOUS NARRATIVE (canon for ${name}):\n${history.map(s => `• ${s}`).join('\n')}`
    : '';

  // Accumulated
  const accSection = accumulated.length > 0
    ? `ACCUMULATED CONTEXT (CANON — already happened):\n${accumulated.map(a =>
        `[Established by ${a.source}'s resolution]\n${a.events.map(e => `• ${e}`).join('\n')}`
      ).join('\n\n')}`
    : 'ACCUMULATED CONTEXT: Nothing accumulated from other characters.';

  // Intention
  let intentSection;
  if (triggerType === 'commit') {
    intentSection = `${name}'S COMMITTED INTENTION (liquid):\n${liquid}`;
  } else {
    intentSection = `DOMINO TRIGGER (what just happened to ${name}):\n${dominoContext}`;
    if (liquid) {
      intentSection += `\n\n${name}'S PENDING LIQUID (submitted before domino — may be used or overridden by events):\n${liquid}`;
    }
  }

  // Rules: dir of section 1
  const rulesLines = flattenNode(mediumAgent['1']);
  const rules = rulesLines[0] + '\n' + rulesLines.slice(1).map(l => `- ${l}`).join('\n');

  // Produce: dir of section 2
  const produce = flattenNode(mediumAgent['2']).join('\n');

  // Format: section 3
  const format = mediumAgent['3'];

  const prompt = `${role}

${sceneSection}

${charSection}

${historySection}

${accSection}

${intentSection}

${rules}

${produce}

${format}`;

  return prompt.replace(/{name}/g, name);
}

async function callMedium(prompt) {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 800,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const data = await resp.json();
  const text = data.content?.[0]?.text ?? '';
  const cleaned = text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '').trim();
  return JSON.parse(cleaned);
}

// ── Scene and characters ──
const scene = 'The Broken Drum tavern. Evening. Fire burning low in a stone hearth. Rain outside. Woodsmoke and ale. A few quiet background patrons. A stranger in a dark cloak entered recently and stands near the hearth, hood up, dripping rainwater.';

const characters = {
  kael: { name: 'Kael', state: 'Town guard. Sitting at a table near the door, hand resting near sword belt. Watchful. Suspicious of the cloaked stranger.' },
  essa: { name: 'Essa', state: 'Barkeeper. Behind the bar, wiping a tankard. Knows everyone in Thornkeep. Protective of her tavern and its peace.' },
  maren: { name: 'Maren', state: 'Travelling merchant. Sitting at a corner table with maps spread out. Curious about the stranger — noticed guild marks on their clasp.' },
};

const solidHistory = { kael: [], essa: [], maren: [] };
const accumulated = { kael: [], essa: [], maren: [] };

// ── Step 1: Kael commits ──
console.log('═══════════════════════════════════════════');
console.log('STEP 1: Kael commits — "I draw my sword and step toward the stranger"');
console.log('═══════════════════════════════════════════\n');

const kaelPrompt = buildPrompt(
  'Kael', characters.kael.state, scene, solidHistory.kael, accumulated.kael,
  'commit', 'I draw my sword and step toward the stranger.'
);

console.log('--- PROMPT (first 200 chars) ---');
console.log(kaelPrompt.slice(0, 200) + '...\n');

const kaelResult = await callMedium(kaelPrompt);
console.log('--- KAEL\'S OUTPUT ---');
console.log('Solid:', kaelResult.solid);
console.log('Events:', kaelResult.events);
console.log('Domino:', JSON.stringify(kaelResult.domino, null, 2));
console.log('Internal:', kaelResult.internal);
console.log();

// Update state
solidHistory.kael.push(kaelResult.solid);
const kaelEvents = { source: 'kael', events: kaelResult.events || [] };

// ── Step 2: Process dominos from Kael ──
const dominos = kaelResult.domino || [];
if (dominos.length === 0) {
  console.log('⚠️  NO DOMINOS PRODUCED — cascade stops here.');
  console.log('This means the prompt is not encouraging domino production.');
  process.exit(0);
}

for (const domino of dominos) {
  const targetId = domino.target?.toLowerCase();
  const targetChar = characters[targetId];
  if (!targetChar) {
    console.log(`⚠️  Domino targets "${domino.target}" — not a known character, skipping.`);
    continue;
  }

  // Accumulate Kael's events for the target
  accumulated[targetId].push(kaelEvents);

  console.log('═══════════════════════════════════════════');
  console.log(`STEP 2: ${targetChar.name} — DOMINO from Kael: "${domino.context}"`);
  console.log('═══════════════════════════════════════════\n');

  const targetPrompt = buildPrompt(
    targetChar.name, targetChar.state, scene, solidHistory[targetId], accumulated[targetId],
    'domino', null, domino.context
  );

  const targetResult = await callMedium(targetPrompt);
  console.log(`--- ${targetChar.name.toUpperCase()}'S OUTPUT ---`);
  console.log('Solid:', targetResult.solid);
  console.log('Events:', targetResult.events);
  console.log('Domino:', JSON.stringify(targetResult.domino, null, 2));
  console.log('Internal:', targetResult.internal);
  console.log();

  solidHistory[targetId].push(targetResult.solid);

  // Check for cascade dominos
  const cascadeDominos = targetResult.domino || [];
  if (cascadeDominos.length > 0) {
    console.log(`🔥 CASCADE: ${targetChar.name} produced ${cascadeDominos.length} domino(s)!`);
    for (const cd of cascadeDominos) {
      console.log(`   → ${cd.target}: ${cd.context}`);
    }
    console.log();
  }
}

console.log('═══════════════════════════════════════════');
console.log('CASCADE COMPLETE');
console.log('═══════════════════════════════════════════');
