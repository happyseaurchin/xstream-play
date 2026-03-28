#!/usr/bin/env node
/**
 * Harness Control Test — automated constraint enforcement testing.
 *
 * Tests 9 methods × 5 Pscale levels × N repetitions.
 * Scores each result for constraint adherence automatically.
 * Produces JSON + CSV + console summary.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... node test-harness.mjs
 *
 * Flags:
 *   --pscale=-3        Test only one Pscale level
 *   --method=4         Test only one method (1-9)
 *   --reps=5           Repetitions per combination (default: 3)
 *   --model=claude-... Override model (default: claude-sonnet-4-6-20250514)
 *   --concurrency=3    Parallel methods per Pscale (default: 1, sequential)
 *   --skip-p0          Skip P0 (chapter) tests to save time/cost
 */

import { writeFileSync } from 'fs';

// ── CLI args ──

const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => {
      const [k, v] = a.slice(2).split('=');
      return [k, v ?? 'true'];
    })
);

const API_KEY = process.env.ANTHROPIC_API_KEY;
if (!API_KEY) {
  console.error('Usage: ANTHROPIC_API_KEY=sk-ant-... node test-harness.mjs');
  process.exit(1);
}

const MODEL = args.model || 'claude-sonnet-4-6-20250514';
const REPS = parseInt(args.reps || '3', 10);
const CONCURRENCY = parseInt(args.concurrency || '1', 10);
const ONLY_PSCALE = args.pscale || null;
const ONLY_METHOD = args.method ? parseInt(args.method, 10) : null;
const SKIP_P0 = args['skip-p0'] === 'true';

// ── Pscale definitions ──

const PSCALES = {
  '-4': { name: 'Word',      target: '1 word',              maxTokens: 10,    scoreFn: scoreWord },
  '-3': { name: 'Sentence',  target: '1 sentence',          maxTokens: 60,    scoreFn: scoreSentence },
  '-2': { name: 'Paragraph', target: '1 paragraph',         maxTokens: 300,   scoreFn: scoreParagraph },
  '-1': { name: 'Section',   target: 'section (1000-3000)', maxTokens: 4000,  scoreFn: scoreSection },
  '0':  { name: 'Chapter',   target: 'chapter (10000+)',    maxTokens: 16000, scoreFn: scoreChapter },
};

// ── Test content (xstream-play narrative context) ──

const SYSTEM_PROMPT = 'You are a narrator for an interactive fiction game set in a medieval fantasy world. You produce narrative text in response to player actions.';

const SCENE = 'The Broken Drum tavern. Evening. Fire burning low in a stone hearth. Rain outside. Woodsmoke and ale. A few quiet background patrons. A stranger in a dark cloak entered recently and stands near the hearth, hood up, dripping rainwater. Kael, a town guard, sits at a table near the door, hand resting near sword belt.';

const TASKS = {
  '-4': 'What single word best describes what Kael feels right now?',
  '-3': 'In one sentence, what does Kael do next?',
  '-2': 'In one paragraph, describe what happens when Kael approaches the stranger.',
  '-1': 'Write a section (multiple paragraphs) describing the confrontation between Kael and the stranger, from Kael standing up to the stranger revealing their identity.',
  '0':  'Write a full chapter describing the evening at the Broken Drum tavern, from Kael\'s arrival through the stranger\'s appearance, the confrontation, and its aftermath.',
};

// ── Scoring functions ──

function countWords(text) {
  return text.trim().split(/\s+/).filter(w => w.length > 0).length;
}

function countSentences(text) {
  // Split on sentence-ending punctuation followed by space or end
  const sentences = text.trim().split(/[.!?]+(?:\s|$)/).filter(s => s.trim().length > 0);
  return sentences.length;
}

function countParagraphs(text) {
  return text.trim().split(/\n\s*\n/).filter(p => p.trim().length > 0).length;
}

function scoreWord(output, tokens) {
  const words = countWords(output);
  return {
    word_count: words,
    constraint_pass: words >= 1 && words <= 3,
    detail: `${words} word(s)`,
  };
}

function scoreSentence(output, tokens) {
  const sentences = countSentences(output);
  const words = countWords(output);
  return {
    sentence_count: sentences,
    word_count: words,
    constraint_pass: sentences === 1 && words >= 3 && words <= 40,
    detail: `${sentences} sentence(s), ${words} words`,
  };
}

function scoreParagraph(output, tokens) {
  const paragraphs = countParagraphs(output);
  const words = countWords(output);
  return {
    paragraph_count: paragraphs,
    word_count: words,
    constraint_pass: paragraphs === 1 && tokens >= 30 && tokens <= 400,
    detail: `${paragraphs} para(s), ${words} words, ${tokens} tokens`,
  };
}

function scoreSection(output, tokens) {
  const paragraphs = countParagraphs(output);
  const words = countWords(output);
  return {
    paragraph_count: paragraphs,
    word_count: words,
    constraint_pass: tokens >= 500 && tokens <= 4000 && paragraphs >= 2,
    detail: `${paragraphs} para(s), ${words} words, ${tokens} tokens`,
  };
}

function scoreChapter(output, tokens) {
  const paragraphs = countParagraphs(output);
  const words = countWords(output);
  return {
    paragraph_count: paragraphs,
    word_count: words,
    constraint_pass: tokens >= 3000 && paragraphs >= 5,
    detail: `${paragraphs} para(s), ${words} words, ${tokens} tokens`,
  };
}

// ── API call helper ──

async function callClaude({ system, messages, maxTokens, stopSequences, temperature, thinking }) {
  const body = {
    model: MODEL,
    max_tokens: maxTokens,
    messages,
  };
  if (system) body.system = system;
  if (stopSequences) body.stop_sequences = stopSequences;
  if (temperature !== undefined) body.temperature = temperature;
  if (thinking) {
    body.thinking = thinking;
    // Extended thinking requires max_tokens to accommodate both thinking + output
    body.max_tokens = Math.max(maxTokens, thinking.budget_tokens + maxTokens);
  }

  const start = Date.now();
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const data = await resp.json();
  const elapsed = Date.now() - start;

  if (data.error) {
    throw new Error(`API error: ${data.error.message}`);
  }

  // Extract text from content blocks (skip thinking blocks)
  const textBlocks = (data.content || []).filter(b => b.type === 'text');
  const output = textBlocks.map(b => b.text).join('').trim();
  const tokens = data.usage?.output_tokens || 0;

  return { output, tokens, time_ms: elapsed, stop_reason: data.stop_reason };
}

// ── Utility ──

function pscaleUnit(ps) {
  return { '0': 'chapter', '-1': 'section', '-2': 'paragraph', '-3': 'sentence', '-4': 'word' }[ps];
}

function constraintInstruction(ps) {
  const unit = pscaleUnit(ps);
  return `Respond with exactly one ${unit}. No preamble, no explanation, no extra text — just the ${unit} itself.`;
}

// ── The 9 Methods ──

async function method1_sequential(content, task, ps) {
  const unit = pscaleUnit(ps);
  // Call 1: list 10 options
  const listResult = await callClaude({
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `Given this scene:\n${content}\n\nTask: ${task}\n\nList exactly 10 possible single-${unit} responses, ranked from most to least probable.\n\nFormat:\n1. [${unit}]\n2. [${unit}]\n...\n10. [${unit}]`
    }],
    maxTokens: ps === '0' ? 16000 : ps === '-1' ? 4000 : 500,
  });

  // Call 2: select rank 7
  const selectResult = await callClaude({
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `From this list:\n${listResult.output}\n\nSelect item #7 and respond with ONLY that ${unit}. Nothing else.`
    }],
    maxTokens: PSCALES[ps].maxTokens,
  });

  return {
    output: selectResult.output,
    tokens: selectResult.tokens,
    time_ms: listResult.time_ms + selectResult.time_ms,
    stop_reason: selectResult.stop_reason,
  };
}

async function method2_thinking(content, task, ps) {
  // Extended thinking requires Sonnet 3.5+ — if using Haiku, fall back to
  // a chain-of-thought prompt instead (same intent, different mechanism)
  const isHaiku = MODEL.includes('haiku');

  if (isHaiku) {
    // Simulate chain-of-thought: ask model to think step by step internally
    return callClaude({
      system: SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: `${content}\n\n${task}\n\nThink carefully step by step about the best response, then provide ONLY the final answer.\n\n${constraintInstruction(ps)}`
      }],
      maxTokens: PSCALES[ps].maxTokens,
    });
  }

  return callClaude({
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `${content}\n\n${task}\n\n${constraintInstruction(ps)}`
    }],
    maxTokens: PSCALES[ps].maxTokens,
    thinking: { type: 'enabled', budget_tokens: 2000 },
  });
}

async function method3_raw(content, task, ps) {
  return callClaude({
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `${content}\n\n${task}\n\n${constraintInstruction(ps)}`
    }],
    maxTokens: PSCALES[ps].maxTokens,
  });
}

async function method4_json(content, task, ps) {
  const result = await callClaude({
    system: 'You respond ONLY with valid JSON in this exact format: {"response": "your answer here"}. No preamble, no markdown, just JSON.',
    messages: [{
      role: 'user',
      content: `${content}\n\n${task}\n\nRespond with one ${pscaleUnit(ps)} inside the JSON structure.`
    }],
    maxTokens: PSCALES[ps].maxTokens + 20,
  });

  // Try to extract from JSON wrapper
  try {
    const cleaned = result.output.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim();
    const parsed = JSON.parse(cleaned);
    result.output = parsed.response || result.output;
  } catch {
    // Keep raw output if JSON parsing fails — that's a data point too
  }

  return result;
}

async function method5_stop(content, task, ps) {
  const stopMap = {
    '-4': [' ', '\n', '.', ',', '!', '?'],
    '-3': ['\n', '.\n', '. ', '! ', '? '],
    '-2': ['\n\n'],
  };

  // Stop sequences don't scale well beyond paragraph
  if (!stopMap[ps]) {
    return callClaude({
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `${content}\n\n${task}` }],
      maxTokens: PSCALES[ps].maxTokens,
      stopSequences: ['\n\n\n'], // weak fallback for longer content
    });
  }

  return callClaude({
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: `${content}\n\n${task}` }],
    maxTokens: 200,
    stopSequences: stopMap[ps],
  });
}

async function method6_maxtokens(content, task, ps) {
  // Pure max_tokens constraint — no prompt instruction about length
  const hardLimits = { '-4': 3, '-3': 20, '-2': 200, '-1': 3000, '0': 12000 };

  return callClaude({
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: `${content}\n\n${task}` }],
    maxTokens: hardLimits[ps],
  });
}

async function method7_fewshot(content, task, ps) {
  const examples = {
    '-4': `Example conversations:
User: What does the knight feel?
Assistant: Dread.

User: How does the wizard respond?
Assistant: Nods.`,

    '-3': `Example conversations:
User: What does the knight say?
Assistant: "I ride into darkness."

User: How does the wizard react?
Assistant: She raises her staff silently, eyes on the door.`,

    '-2': `Example conversations:
User: Describe the scene.
Assistant: The battlefield stretches before them, smoke rising from a dozen fires. Steel and ash litter the trampled earth where two armies clashed at dawn. Now silence holds the field, broken only by the distant call of crows circling overhead, drawn by the scent of what lies below.`,

    '-1': `You produce multi-paragraph sections when asked. Each section has 3-6 paragraphs with clear narrative progression.`,

    '0': `You produce full chapters when asked. Each chapter has 10+ paragraphs with a complete narrative arc: setup, rising action, climax, resolution.`,
  };

  return callClaude({
    system: `${SYSTEM_PROMPT}\n\nYou are ultra-concise. ${examples[ps]}\n\nNow respond in the same style.`,
    messages: [{
      role: 'user',
      content: `${content}\n\n${task}`
    }],
    maxTokens: PSCALES[ps].maxTokens,
  });
}

async function method8_prefill(content, task, ps) {
  if (ps === '-4' || ps === '-3') {
    // Prefill works best for short outputs
    const result = await callClaude({
      system: SYSTEM_PROMPT,
      messages: [
        { role: 'user', content: `${content}\n\n${task}` },
        { role: 'assistant', content: ps === '-4' ? 'The word is: "' : 'Here is the single sentence: "' },
      ],
      maxTokens: ps === '-4' ? 10 : 60,
      stopSequences: ['"', '\n'],
    });
    // Clean up any trailing quote
    result.output = result.output.replace(/["']$/, '').trim();
    return result;
  }

  // For longer content, prefill is less effective — use a structural start
  const prefills = {
    '-2': 'Here is the paragraph:\n\n',
    '-1': 'Here is the section:\n\n',
    '0': 'Here is the chapter:\n\n# ',
  };

  return callClaude({
    system: SYSTEM_PROMPT,
    messages: [
      { role: 'user', content: `${content}\n\n${task}\n\n${constraintInstruction(ps)}` },
      { role: 'assistant', content: prefills[ps] },
    ],
    maxTokens: PSCALES[ps].maxTokens,
  });
}

async function method9_temperature(content, task, ps) {
  const tempMap = { '-4': 0.1, '-3': 0.3, '-2': 0.5, '-1': 0.7, '0': 0.9 };

  return callClaude({
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `${content}\n\n${task}\n\n${constraintInstruction(ps)}`
    }],
    maxTokens: PSCALES[ps].maxTokens,
    temperature: tempMap[ps],
  });
}

// ── Method registry ──

const METHODS = [
  { id: 1, name: 'Sequential Probability', fn: method1_sequential },
  { id: 2, name: 'Extended Thinking',      fn: method2_thinking },
  { id: 3, name: 'Raw Immediate',          fn: method3_raw },
  { id: 4, name: 'Structured JSON',        fn: method4_json },
  { id: 5, name: 'Stop Sequences',         fn: method5_stop },
  { id: 6, name: 'Max Tokens',             fn: method6_maxtokens },
  { id: 7, name: 'Few-Shot Examples',      fn: method7_fewshot },
  { id: 8, name: 'Prefill Response',       fn: method8_prefill },
  { id: 9, name: 'Temperature Variation',  fn: method9_temperature },
];

// ── Runner ──

async function runTest(method, pscale, rep) {
  const task = TASKS[pscale];
  try {
    const result = await method.fn(SCENE, task, pscale);
    const score = PSCALES[pscale].scoreFn(result.output, result.tokens);
    return {
      method_id: method.id,
      method_name: method.name,
      pscale,
      pscale_name: PSCALES[pscale].name,
      rep,
      output: result.output,
      tokens: result.tokens,
      time_ms: result.time_ms,
      stop_reason: result.stop_reason,
      word_count: countWords(result.output),
      sentence_count: countSentences(result.output),
      paragraph_count: countParagraphs(result.output),
      ...score,
      error: null,
    };
  } catch (err) {
    return {
      method_id: method.id,
      method_name: method.name,
      pscale,
      pscale_name: PSCALES[pscale].name,
      rep,
      output: '',
      tokens: 0,
      time_ms: 0,
      stop_reason: 'error',
      word_count: 0,
      sentence_count: 0,
      paragraph_count: 0,
      constraint_pass: false,
      detail: '',
      error: err.message,
    };
  }
}

// ── Batch runner with concurrency control ──

async function runBatch(tasks, concurrency) {
  const results = [];
  for (let i = 0; i < tasks.length; i += concurrency) {
    const batch = tasks.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(t => t()));
    results.push(...batchResults);
  }
  return results;
}

// ── Reporting ──

function printSummaryTable(results) {
  const pscales = [...new Set(results.map(r => r.pscale))].sort((a, b) => parseInt(a) - parseInt(b));
  const methods = [...new Set(results.map(r => r.method_id))].sort((a, b) => a - b);

  // Header
  const pHeaders = pscales.map(ps => `P${ps}(${PSCALES[ps].name.slice(0, 4)})`);
  const colWidth = 12;
  console.log('\n' + '═'.repeat(22 + pHeaders.length * colWidth));
  console.log('  APERTURE CONTROL RESULTS');
  console.log('═'.repeat(22 + pHeaders.length * colWidth));
  console.log(`  Model: ${MODEL}  |  Reps: ${REPS}`);
  console.log('─'.repeat(22 + pHeaders.length * colWidth));

  const header = 'Method'.padEnd(22) + pHeaders.map(h => h.padStart(colWidth)).join('');
  console.log(header);
  console.log('─'.repeat(22 + pHeaders.length * colWidth));

  for (const mid of methods) {
    const methodResults = results.filter(r => r.method_id === mid);
    const name = methodResults[0]?.method_name || `Method ${mid}`;
    let row = name.slice(0, 21).padEnd(22);

    for (const ps of pscales) {
      const psResults = methodResults.filter(r => r.pscale === ps);
      if (psResults.length === 0) {
        row += 'N/A'.padStart(colWidth);
        continue;
      }
      const passes = psResults.filter(r => r.constraint_pass).length;
      const total = psResults.length;
      const errors = psResults.filter(r => r.error).length;
      let cell;
      if (errors === total) {
        cell = 'ERR';
      } else {
        cell = `${passes}/${total}`;
        if (passes === total) cell = `✓ ${cell}`;
        else if (passes === 0) cell = `✗ ${cell}`;
      }
      row += cell.padStart(colWidth);
    }
    console.log(row);
  }

  console.log('─'.repeat(22 + pHeaders.length * colWidth));

  // Timing summary
  console.log('\n  Average generation time (ms):');
  console.log('─'.repeat(22 + pHeaders.length * colWidth));
  const timingHeader = 'Method'.padEnd(22) + pHeaders.map(h => h.padStart(colWidth)).join('');
  console.log(timingHeader);
  console.log('─'.repeat(22 + pHeaders.length * colWidth));

  for (const mid of methods) {
    const methodResults = results.filter(r => r.method_id === mid);
    const name = methodResults[0]?.method_name || `Method ${mid}`;
    let row = name.slice(0, 21).padEnd(22);

    for (const ps of pscales) {
      const psResults = methodResults.filter(r => r.pscale === ps && !r.error);
      if (psResults.length === 0) {
        row += '-'.padStart(colWidth);
        continue;
      }
      const avgTime = Math.round(psResults.reduce((s, r) => s + r.time_ms, 0) / psResults.length);
      row += `${avgTime}`.padStart(colWidth);
    }
    console.log(row);
  }

  console.log('═'.repeat(22 + pHeaders.length * colWidth));
}

function writeCSV(results) {
  const pscales = [...new Set(results.map(r => r.pscale))].sort((a, b) => parseInt(a) - parseInt(b));
  const methods = [...new Set(results.map(r => r.method_id))].sort((a, b) => a - b);

  // Pass rate matrix
  let csv = 'Method,' + pscales.map(ps => `P${ps}`).join(',') + '\n';
  for (const mid of methods) {
    const methodResults = results.filter(r => r.method_id === mid);
    const name = methodResults[0]?.method_name || `Method ${mid}`;
    const cells = pscales.map(ps => {
      const psResults = methodResults.filter(r => r.pscale === ps);
      if (psResults.length === 0) return '';
      const passes = psResults.filter(r => r.constraint_pass).length;
      return `${passes}/${psResults.length}`;
    });
    csv += `"${name}",${cells.join(',')}\n`;
  }

  csv += '\nTiming (avg ms)\n';
  csv += 'Method,' + pscales.map(ps => `P${ps}`).join(',') + '\n';
  for (const mid of methods) {
    const methodResults = results.filter(r => r.method_id === mid);
    const name = methodResults[0]?.method_name || `Method ${mid}`;
    const cells = pscales.map(ps => {
      const psResults = methodResults.filter(r => r.pscale === ps && !r.error);
      if (psResults.length === 0) return '';
      return Math.round(psResults.reduce((s, r) => s + r.time_ms, 0) / psResults.length);
    });
    csv += `"${name}",${cells.join(',')}\n`;
  }

  // Raw data
  csv += '\nRaw Results\n';
  csv += 'method_id,method_name,pscale,rep,constraint_pass,tokens,word_count,sentence_count,paragraph_count,time_ms,detail,error\n';
  for (const r of results) {
    csv += `${r.method_id},"${r.method_name}",P${r.pscale},${r.rep},${r.constraint_pass},${r.tokens},${r.word_count},${r.sentence_count},${r.paragraph_count},${r.time_ms},"${r.detail || ''}","${r.error || ''}"\n`;
  }

  return csv;
}

// ── Main ──

async function main() {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║    APERTURE CONTROL TEST — xstream-play  ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log(`Model: ${MODEL}`);
  console.log(`Repetitions: ${REPS}`);
  console.log(`Concurrency: ${CONCURRENCY}`);

  // Build test plan
  let pscaleKeys = Object.keys(PSCALES);
  if (ONLY_PSCALE) pscaleKeys = [ONLY_PSCALE];
  if (SKIP_P0) pscaleKeys = pscaleKeys.filter(k => k !== '0');

  let methodList = METHODS;
  if (ONLY_METHOD) methodList = METHODS.filter(m => m.id === ONLY_METHOD);

  const totalCalls = pscaleKeys.length * methodList.length * REPS;
  // Method 1 does 2 API calls per test
  const apiCalls = totalCalls + (methodList.some(m => m.id === 1) ? pscaleKeys.length * REPS : 0);
  console.log(`\nTest matrix: ${pscaleKeys.length} Pscales × ${methodList.length} methods × ${REPS} reps = ${totalCalls} tests (~${apiCalls} API calls)`);
  console.log('Starting...\n');

  const allResults = [];
  let completed = 0;

  for (const ps of pscaleKeys) {
    console.log(`── Pscale P${ps} (${PSCALES[ps].name}: ${PSCALES[ps].target}) ──`);

    const tasks = [];
    for (const method of methodList) {
      for (let rep = 1; rep <= REPS; rep++) {
        tasks.push(async () => {
          const result = await runTest(method, ps, rep);
          completed++;
          const status = result.error ? '✗ ERR' : result.constraint_pass ? '✓ PASS' : '✗ FAIL';
          const pct = Math.round(completed / totalCalls * 100);
          console.log(`  [${pct}%] M${method.id} ${method.name.slice(0, 16).padEnd(16)} rep${rep} → ${status}  (${result.tokens}tok, ${result.time_ms}ms) ${result.detail || result.error || ''}`);
          return result;
        });
      }
    }

    const psResults = await runBatch(tasks, CONCURRENCY);
    allResults.push(...psResults);
    console.log();
  }

  // ── Output ──

  printSummaryTable(allResults);

  // Write full results JSON (with outputs truncated for readability)
  const jsonResults = allResults.map(r => ({
    ...r,
    output_preview: r.output.slice(0, 200) + (r.output.length > 200 ? '...' : ''),
    output_length: r.output.length,
  }));
  writeFileSync('harness-results.json', JSON.stringify(jsonResults, null, 2));
  console.log('\nFull results → harness-results.json');

  // Write full outputs separately (for qualitative review)
  const fullOutputs = allResults.map(r => ({
    method_id: r.method_id,
    method_name: r.method_name,
    pscale: r.pscale,
    rep: r.rep,
    constraint_pass: r.constraint_pass,
    output: r.output,
  }));
  writeFileSync('harness-outputs.json', JSON.stringify(fullOutputs, null, 2));
  console.log('Full outputs → harness-outputs.json');

  // Write CSV summary
  const csv = writeCSV(allResults);
  writeFileSync('harness-summary.csv', csv);
  console.log('CSV summary  → harness-summary.csv');

  // ── Final verdict ──
  console.log('\n── VERDICT ──');
  const methodScores = {};
  for (const m of methodList) {
    const mResults = allResults.filter(r => r.method_id === m.id && !r.error);
    const passes = mResults.filter(r => r.constraint_pass).length;
    const total = mResults.length;
    methodScores[m.id] = { name: m.name, passes, total, rate: total > 0 ? passes / total : 0 };
  }

  const ranked = Object.values(methodScores).sort((a, b) => b.rate - a.rate);
  for (const m of ranked) {
    const bar = '█'.repeat(Math.round(m.rate * 20)) + '░'.repeat(20 - Math.round(m.rate * 20));
    console.log(`  ${bar} ${Math.round(m.rate * 100)}% ${m.name} (${m.passes}/${m.total})`);
  }

  console.log('\nDone.');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
