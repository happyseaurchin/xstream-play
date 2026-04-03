/**
 * xstream service worker — the kernel
 *
 * A thin shell that follows stars. Agent blocks define behaviour.
 * BSP walks compose prompts from blocks. The kernel just follows.
 *
 * RELAY KEYING: sha256(canonical_url) replaces game codes.
 * Every page is an implicit coordination space.
 */

import { bsp, collectUnderscore } from './bsp.js';
import { buildPageBlock, buildBeachBlock } from './blocks-dynamic.js';

// ============================================================
// CONFIG
// ============================================================

const RELAY_BASE = 'https://play.onen.ai/api/relay';
const BEACH_BASE = 'https://play.onen.ai/api/beach';

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
const MEDIUM_MODEL = 'claude-sonnet-4-20250514';

// chrome.alarms minimum is 1 minute — fine for peer discovery
const POLL_ALARM_NAME_PREFIX = 'xstream-poll-';
const POLL_PERIOD_MINUTES = 1;

// ============================================================
// STATE — per-tab kernel instances
// ============================================================

const kernels = new Map(); // tabId -> KernelState

// ============================================================
// CRYPTO — URL to relay key
// ============================================================

async function urlToHash(url) {
  try {
    const u = new URL(url);
    const canonical = `${u.protocol}//${u.host.toLowerCase()}${u.pathname.replace(/\/$/, '')}${u.search}`;
    const data = new TextEncoder().encode(canonical);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
  } catch {
    return null;
  }
}

function generateAnonId() {
  return 'x-' + crypto.randomUUID().slice(0, 8);
}

// ============================================================
// LLM — direct Anthropic API call
// Extracted from xstream-play/src/kernel/claude-direct.ts
// No 'anthropic-dangerous-direct-browser-access' needed from service worker
// ============================================================

async function callClaude(apiKey, model, prompt, maxTokens = 1024) {
  const res = await fetch(ANTHROPIC_API, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude API ${res.status}: ${err.slice(0, 200)}`);
  }

  const data = await res.json();
  return {
    text: data.content?.[0]?.text ?? '',
    usage: data.usage ?? {},
  };
}

function cleanJson(text) {
  return text.trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
}

// ============================================================
// RELAY — read/write peer blocks
// ============================================================

async function writeBlock(urlHash, anonId, block) {
  try {
    const res = await fetch(`${RELAY_BASE}/${urlHash}/${anonId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(block),
    });
    if (!res.ok) {
      console.warn(`[relay PUT] ${res.status}`);
    }
  } catch (e) {
    console.warn('[relay PUT]', e.message);
  }
}

async function readPeerBlocks(urlHash, myId) {
  try {
    const res = await fetch(`${RELAY_BASE}/${urlHash}?exclude=${myId}`);
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

// ============================================================
// BLOCK LOADING — agent blocks define behaviour
// ============================================================

const blockCache = new Map(); // name → { block, fetchedAt }
const BLOCK_TTL = 5 * 60 * 1000; // 5 minutes

// Agent blocks bundled with extension (loaded via fetch from extension URL)
const BUNDLED_BLOCKS = {
  'visitor-soft-agent': 'blocks/visitor-soft-agent.json',
  'visitor-medium-agent': 'blocks/visitor-medium-agent.json',
};

// Dynamic blocks built at runtime (not fetched)
const DYNAMIC_RESOLVERS = {
  'page-context': (kernel) => buildPageBlock(kernel.pageSnapshot),
  'beach-context': (kernel) => buildBeachBlock(kernel.beachMarks || []),
};

async function loadBlock(name, kernel) {
  // Dynamic blocks — built from runtime state
  if (DYNAMIC_RESOLVERS[name]) {
    return DYNAMIC_RESOLVERS[name](kernel);
  }

  // Check cache
  const cached = blockCache.get(name);
  if (cached && Date.now() - cached.fetchedAt < BLOCK_TTL) {
    return cached.block;
  }

  // Bundled blocks — fetch from extension directory
  if (BUNDLED_BLOCKS[name]) {
    try {
      const url = chrome.runtime.getURL(BUNDLED_BLOCKS[name]);
      const res = await fetch(url);
      if (res.ok) {
        const block = await res.json();
        blockCache.set(name, { block, fetchedAt: Date.now() });
        return block;
      }
    } catch (e) {
      console.warn('[blocks] failed to load', name, e.message);
    }
  }

  return null;
}

// ============================================================
// PROMPT COMPOSITION — BSP walks of agent blocks
// The agent block says what it needs. The kernel follows stars.
// ============================================================

async function buildPromptFromBlock(agentBlockName, kernel, userMessage) {
  const agentBlock = await loadBlock(agentBlockName, kernel);
  if (!agentBlock) return userMessage; // fallback: raw message

  const sections = [];

  // 1. Agent block's semantic text (role description)
  const star = bsp(agentBlock, 0, '*');
  if (star.semantic) sections.push(star.semantic);

  // 2. Follow star references — load and walk each referenced block
  if (star.hidden) {
    for (const [key, name] of Object.entries(star.hidden).sort()) {
      const refBlock = await loadBlock(name, kernel);
      if (!refBlock) continue;

      // Collect all text from the referenced block (depth-first)
      const refTexts = [];
      function collectAll(node) {
        if (typeof node === 'string') { refTexts.push(node); return; }
        if (typeof node !== 'object' || node === null) return;
        const us = collectUnderscore(node);
        if (us) refTexts.push(us);
        for (const k of '123456789') {
          if (k in node) collectAll(node[k]);
        }
      }
      collectAll(refBlock);
      if (refTexts.length > 0) sections.push(refTexts.join('\n'));
    }
  }

  // 3. Walk agent block branches (rules, style, format) — dir at each
  for (const d of '123456789') {
    if (!(d in agentBlock)) continue;
    const branch = agentBlock[d];
    const texts = [];
    function collectTexts(node) {
      if (typeof node === 'string') { texts.push(node); return; }
      if (typeof node !== 'object' || node === null) return;
      const us = collectUnderscore(node);
      if (us) texts.push(us);
      for (const k of '123456789') {
        if (k in node) collectTexts(node[k]);
      }
    }
    collectTexts(branch);
    if (texts.length > 0) sections.push(texts.join(' '));
  }

  // 4. User message
  sections.push(`\nUSER: ${userMessage}`);

  return sections.join('\n\n');
}

// ============================================================
// SOFT-LLM — user's private advisor (block-driven)
// ============================================================

async function querySoft(tabId, query) {
  const kernel = kernels.get(tabId);
  if (!kernel) return { error: 'No kernel for this tab' };

  const apiKey = await getApiKey();
  if (!apiKey) return { error: 'No API key configured' };

  const prompt = await buildPromptFromBlock('visitor-soft-agent', kernel, query);

  try {
    const { text } = await callClaude(apiKey, DEFAULT_MODEL, prompt, 512);
    // Soft agent returns plain text (per block: no JSON, no schema)
    return { text: text.trim(), softType: 'info', tools: [] };
  } catch (e) {
    return { text: `Error: ${e.message}`, softType: 'info', tools: [] };
  }
}

// ============================================================
// MEDIUM-LLM — commit resolution (block-driven)
// ============================================================

async function commitMedium(tabId, liquid) {
  const kernel = kernels.get(tabId);
  if (!kernel) return { error: 'No kernel for this tab' };

  const apiKey = await getApiKey();
  if (!apiKey) return { error: 'No API key configured' };

  const prompt = await buildPromptFromBlock('visitor-medium-agent', kernel, liquid);

  try {
    const { text } = await callClaude(apiKey, MEDIUM_MODEL, prompt, 1024);
    const result = JSON.parse(cleanJson(text));

    // Update block with events
    if (result.events?.length > 0) {
      kernel.block.outbox = kernel.block.outbox || { sequence: 0, events: [], domino: [] };
      kernel.block.outbox.events = result.events;
      kernel.block.outbox.domino = result.domino || [];
      kernel.block.outbox.sequence = (kernel.block.outbox.sequence || 0) + 1;
    }

    // Write to relay
    kernel.block.pending_liquid = null;
    kernel.block.status = 'idle';
    await writeBlock(kernel.urlHash, kernel.anonId, kernel.block);

    return result;
  } catch (e) {
    return { solid: `Error: ${e.message}`, actions: [], events: [] };
  }
}

// ============================================================
// POLL LOOP — peer discovery via chrome.alarms
// ============================================================

async function pollAllKernels() {
  for (const [tabId, kernel] of kernels.entries()) {
    // Check if tab still exists
    try {
      await chrome.tabs.get(tabId);
    } catch {
      kernels.delete(tabId);
      continue;
    }
    await pollCycle(tabId);
  }

  // If no kernels left, stop the alarm
  if (kernels.size === 0) {
    chrome.alarms.clear('xstream-poll');
  }
}

async function pollCycle(tabId) {
  const kernel = kernels.get(tabId);
  if (!kernel) return;

  try {
    const peerBlocks = await readPeerBlocks(kernel.urlHash, kernel.anonId);

    // Extract peer liquids for display
    const peerLiquids = peerBlocks
      .filter(p => p.pending_liquid)
      .map(p => ({
        id: p.character?.id || 'unknown',
        name: p.character?.name || 'stranger',
        liquid: p.pending_liquid,
      }));
    kernel.peerLiquids = peerLiquids;

    // Check for new events (domino candidates)
    const newEvents = [];
    for (const peer of peerBlocks) {
      const peerId = peer.character?.id;
      if (!peerId) continue;
      const peerSeq = peer.outbox?.sequence ?? 0;
      const lastSeen = kernel.lastSeen[peerId] ?? 0;
      if (peerSeq > lastSeen) {
        newEvents.push({
          source: peerId,
          events: peer.outbox?.events ?? [],
          sequence: peerSeq,
        });
        kernel.lastSeen[peerId] = peerSeq;
      }
    }

    // Notify content script of peer state
    try {
      await chrome.tabs.sendMessage(tabId, {
        type: 'PEER_UPDATE',
        peers: peerLiquids,
        newEvents: newEvents,
        peerCount: peerBlocks.length,
      });
    } catch {
      // Tab might be closed or navigated
    }
  } catch (e) {
    console.warn('[poll]', e.message);
  }
}

// Alarm listener — replaces setInterval
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'xstream-poll') {
    pollAllKernels();
  }
});

function ensurePollAlarm() {
  chrome.alarms.get('xstream-poll', (existing) => {
    if (!existing) {
      chrome.alarms.create('xstream-poll', { periodInMinutes: POLL_PERIOD_MINUTES });
    }
  });
}

// ============================================================
// BEACH — passive stigmergy across time
// Relay = who is here now. Beach = who was here, with what purpose.
// ============================================================

async function leaveMark(urlHash, agentId, purpose) {
  try {
    const res = await fetch(`${BEACH_BASE}/${urlHash}/mark`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent_id: agentId,
        purpose: purpose || 'present',
      }),
    });
    if (res.status === 429) return { ok: true, rateLimited: true };
    if (!res.ok) {
      console.warn('[beach] mark failed:', res.status);
      return { ok: false };
    }
    return { ok: true };
  } catch (e) {
    console.warn('[beach] mark error:', e.message);
    return { ok: false };
  }
}

async function readMarks(urlHash) {
  try {
    const res = await fetch(`${BEACH_BASE}/${urlHash}`);
    if (!res.ok) return { marks: [], peer_count: 0 };
    return await res.json();
  } catch (e) {
    console.warn('[beach] read error:', e.message);
    return { marks: [], peer_count: 0 };
  }
}

async function beachReadOnly(tabId, url, urlHash, agentId) {
  // Read marks — no mark is left. Marks happen on intentional action only.
  const { marks, peer_count } = await readMarks(urlHash);

  const otherMarks = marks.filter(m => m.agent !== agentId);
  const meaningfulMarks = otherMarks.filter(m =>
    m.s && m.s !== 'present' && m.s.length > 3
  );

  // Store on kernel for dynamic block resolver
  const kernel = kernels.get(tabId);
  if (kernel) kernel.beachMarks = otherMarks;

  // Notify content script
  try {
    await chrome.tabs.sendMessage(tabId, {
      type: 'BEACH_UPDATE',
      peerCount: peer_count,
      density: otherMarks.length,
      meaningfulMarks,
      totalMarks: marks.length,
    });
  } catch { /* tab might be closed */ }

  // If meaningful marks found, fire LLM proximity check
  if (meaningfulMarks.length > 0) {
    const apiKey = await getApiKey();
    if (apiKey) {
      const result = await llmProximityCheck(apiKey, url, 'present', meaningfulMarks);
      if (result?.should_notify) {
        try {
          await chrome.tabs.sendMessage(tabId, {
            type: 'PROXIMITY_MATCH',
            reason: result.reason,
            agents: result.compatible_agents || [],
            marks: meaningfulMarks,
          });
        } catch { /* tab might be closed */ }
      }
    }
  }
}

async function llmProximityCheck(apiKey, pageUrl, myPurpose, peerMarks) {
  const prompt = `You are a coordination detector. Multiple agents/users have visited the same web page. Based on their stated purposes, assess whether they might benefit from knowing about each other.

PAGE: ${pageUrl}

MY PURPOSE: ${myPurpose}

OTHER VISITORS:
${peerMarks.map(m => `- Agent ${m.agent}: purpose="${m.s}" (visited ${m.t})`).join('\n')}

Respond with JSON only:
{
  "should_notify": true/false,
  "reason": "one sentence explaining why or why not",
  "compatible_agents": ["agent_id", ...]
}

Rules:
- should_notify = true ONLY if purposes suggest genuine coordination value
- Two people just "browsing" is not coordination value
- Two people researching the same topic IS coordination value
- One person offering what another is seeking IS coordination value
- Be conservative. False positives erode trust.`;

  try {
    const { text } = await callClaude(apiKey, DEFAULT_MODEL, prompt, 256);
    return JSON.parse(cleanJson(text));
  } catch (e) {
    console.warn('[beach] proximity check failed:', e.message);
    return null;
  }
}

// ============================================================
// KERNEL LIFECYCLE
// ============================================================

async function startKernel(tabId, url, pageSnapshot) {
  stopKernel(tabId);

  const urlHash = await urlToHash(url);
  if (!urlHash) return;

  const anonId = generateAnonId();

  const block = {
    character: { id: anonId, name: 'anon' },
    status: 'idle',
    pending_liquid: null,
    outbox: { sequence: 0, events: [], domino: [] },
  };

  const kernel = {
    urlHash,
    anonId,
    url,
    block,
    lastSeen: {},
    pageSnapshot: pageSnapshot || '',
    peerLiquids: [],
    tools: [],
  };

  kernels.set(tabId, kernel);

  // Write initial block to relay
  await writeBlock(urlHash, anonId, block);

  // Ensure poll alarm is running
  ensurePollAlarm();

  // Do an immediate poll
  pollCycle(tabId);

  // Beach: read past visitors (no mark left — marks only on intentional action)
  beachReadOnly(tabId, url, urlHash, anonId).catch(e => {
    console.warn('[beach] read error:', e.message);
  });
}

function stopKernel(tabId) {
  kernels.delete(tabId);
}

// ============================================================
// STORAGE — API key
// ============================================================

async function getApiKey() {
  const result = await chrome.storage.local.get('xstream_api_key');
  return result.xstream_api_key || null;
}

// ============================================================
// MESSAGE HANDLER — content script <-> service worker
// ============================================================

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tabId = sender.tab?.id;

  switch (msg.type) {
    case 'PAGE_LOADED': {
      if (tabId && msg.url && msg.snapshot) {
        console.log('[xstream] kernel starting for', msg.url.slice(0, 60));
        startKernel(tabId, msg.url, msg.snapshot).catch(e => {
          console.error('[xstream] kernel start error:', e);
        });
      }
      sendResponse({ ok: true });
      return true; // async startKernel
    }

    case 'WIDGET_OPENED': {
      // Button press = lightest intentional gesture. Mark "present".
      if (tabId) {
        const kernel = kernels.get(tabId);
        if (kernel) {
          leaveMark(kernel.urlHash, kernel.anonId, 'present');
        }
      }
      sendResponse({ ok: true });
      break;
    }

    case 'QUERY_SOFT': {
      if (tabId) {
        // Vapor is private — no beach mark for soft-LLM queries
        querySoft(tabId, msg.query).then(result => {
          console.log('[xstream] soft response:', result?.text?.slice(0, 80));
          chrome.tabs.sendMessage(tabId, { type: 'SOFT_RESPONSE', result });
        }).catch(e => {
          console.error('[xstream] soft error:', e);
          chrome.tabs.sendMessage(tabId, {
            type: 'SOFT_RESPONSE',
            result: { text: `Error: ${e.message}`, softType: 'info', tools: [] },
          });
        });
      }
      sendResponse({ ok: true });
      return true; // keep channel open for async work
    }

    case 'SUBMIT_LIQUID': {
      if (tabId) {
        const kernel = kernels.get(tabId);
        if (kernel) {
          kernel.block.pending_liquid = msg.text;
          writeBlock(kernel.urlHash, kernel.anonId, kernel.block);
          // Beach: intentional mark with committed text
          leaveMark(kernel.urlHash, kernel.anonId, msg.text.slice(0, 200));
        }
      }
      sendResponse({ ok: true });
      break;
    }

    case 'COMMIT': {
      if (tabId) {
        commitMedium(tabId, msg.liquid).then(result => {
          console.log('[xstream] medium result:', result?.solid?.slice(0, 80));
          chrome.tabs.sendMessage(tabId, { type: 'SOLID_RESULT', result });
        }).catch(e => {
          console.error('[xstream] medium error:', e);
          chrome.tabs.sendMessage(tabId, {
            type: 'SOLID_RESULT',
            result: { solid: `Error: ${e.message}`, actions: [], events: [] },
          });
        });
      }
      sendResponse({ ok: true });
      return true; // keep channel open for async work
    }

    case 'CHECK_API_KEY': {
      getApiKey().then(key => {
        sendResponse({ hasKey: !!key });
      });
      return true; // async response
    }
  }

  return false;
});

// Clean up kernels when tabs close
chrome.tabs.onRemoved.addListener((tabId) => {
  stopKernel(tabId);
});

// Clean up kernels when tabs navigate
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    stopKernel(tabId);
  }
});
