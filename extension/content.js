/**
 * xstream content script — the widget
 *
 * Injected into every page. Renders the compass-quadrant button
 * inside a shadow DOM (CSS-isolated from host site).
 * Extracts page snapshot for LLM context.
 * Executes DOM actions from medium-LLM with confirmation.
 *
 * Adapted from xstream-play/src/components/xstream/ConstructionButton.tsx
 * and zone components (VapourZone, LiquidZone, SolidZone).
 */

// ============================================================
// PAGE SNAPSHOT — what the LLM "sees"
// ============================================================

function extractPageSnapshot() {
  const title = document.title || '';
  const meta = document.querySelector('meta[name="description"]')?.content || '';
  const h1s = Array.from(document.querySelectorAll('h1')).map(el => el.textContent?.trim()).filter(Boolean).slice(0, 3);
  const h2s = Array.from(document.querySelectorAll('h2')).map(el => el.textContent?.trim()).filter(Boolean).slice(0, 5);

  const forms = Array.from(document.querySelectorAll('form')).map(f => {
    const inputs = Array.from(f.querySelectorAll('input, select, textarea')).map(i => ({
      type: i.type || i.tagName.toLowerCase(),
      name: i.name || i.id || i.placeholder || '',
      selector: cssSelector(i),
    }));
    return { action: f.action, inputs };
  }).slice(0, 3);

  const buttons = Array.from(document.querySelectorAll('button, [role="button"], input[type="submit"]'))
    .map(b => ({
      text: b.textContent?.trim().slice(0, 40) || b.value || '',
      selector: cssSelector(b),
    }))
    .filter(b => b.text)
    .slice(0, 10);

  const links = Array.from(document.querySelectorAll('a[href]'))
    .map(a => ({ text: a.textContent?.trim().slice(0, 40), href: a.href }))
    .filter(a => a.text && a.href)
    .slice(0, 10);

  const main = document.querySelector('main, article, [role="main"]') || document.body;
  const textContent = main.textContent?.replace(/\s+/g, ' ').trim().slice(0, 500) || '';

  return JSON.stringify({
    url: location.href,
    title,
    meta,
    headings: { h1: h1s, h2: h2s },
    forms,
    buttons,
    links,
    textSummary: textContent,
  }, null, 2);
}

function cssSelector(el) {
  if (el.id) return `#${el.id}`;
  if (el.name) return `[name="${el.name}"]`;
  const classes = Array.from(el.classList).slice(0, 2).join('.');
  if (classes) return `${el.tagName.toLowerCase()}.${classes}`;
  return el.tagName.toLowerCase();
}

// ============================================================
// DOM ACTION EXECUTOR — with confirmation
// ============================================================

let pendingActions = [];
let confirmCallback = null;

function describeAction(action) {
  switch (action.type) {
    case 'click': return `Click: ${action.description || action.selector}`;
    case 'fill': return `Fill "${action.value}" into ${action.description || action.selector}`;
    case 'extract': return `Extract text from ${action.description || action.selector}`;
    case 'navigate': return `Navigate to ${action.description || action.selector}`;
    default: return `${action.type}: ${action.selector}`;
  }
}

function isDestructive(action) {
  if (action.type === 'navigate') return true;
  if (action.type === 'click') {
    const el = document.querySelector(action.selector);
    if (!el) return true; // can't verify — be cautious
    const text = (el.textContent || el.value || '').toLowerCase();
    const tag = el.tagName.toLowerCase();
    // Submit buttons, purchase, delete, etc.
    if (tag === 'input' && el.type === 'submit') return true;
    if (el.closest('form')) return true;
    if (/submit|purchase|buy|delete|remove|confirm|send|post|publish/i.test(text)) return true;
  }
  if (action.type === 'fill') return true; // always confirm fills
  return false;
}

function executeAction(action) {
  try {
    const el = document.querySelector(action.selector);
    if (!el) return { ok: false, error: `Element not found: ${action.selector}` };

    switch (action.type) {
      case 'click':
        el.click();
        return { ok: true };
      case 'fill':
        el.value = action.value || '';
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return { ok: true };
      case 'extract':
        return { ok: true, data: el.textContent?.trim() };
      case 'navigate':
        if (el.href) window.location.href = el.href;
        return { ok: true };
      default:
        return { ok: false, error: `Unknown action type: ${action.type}` };
    }
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ============================================================
// WIDGET — shadow DOM injection
// ============================================================

function createWidget() {
  const host = document.createElement('div');
  host.id = 'xstream-host';
  host.style.cssText = 'position: fixed; z-index: 2147483647; pointer-events: none;' +
    'top: 0; left: 0; width: 100%; height: 100%;';
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: 'closed' });

  shadow.innerHTML = `
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }

  :host { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }

  .widget-root {
    position: fixed;
    pointer-events: auto;
  }

  .compass {
    position: relative;
    width: 48px;
    height: 48px;
    cursor: grab;
  }
  .compass.dragging { cursor: grabbing; }

  /* THE BUTTON */
  .main-btn {
    width: 48px; height: 48px;
    border-radius: 50%;
    border: 1px solid rgba(128,128,128,0.3);
    background: rgba(255,255,255,0.95);
    color: #333;
    font-size: 18px; font-weight: 600;
    cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    transition: all 0.2s;
    box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    position: relative;
    z-index: 10;
  }
  .main-btn:hover { border-color: rgba(128,128,128,0.5); }

  @media (prefers-color-scheme: dark) {
    .main-btn {
      background: rgba(40,40,40,0.95);
      color: #ddd;
      border-color: rgba(128,128,128,0.4);
    }
  }

  /* ACTION BUTTONS */
  .action-btn {
    width: 32px; height: 32px;
    border-radius: 50%;
    border: none;
    cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    position: absolute;
    top: 50%; transform: translateY(-50%);
    transition: opacity 0.2s, transform 0.2s;
    opacity: 0; pointer-events: none;
  }
  .action-btn.visible { opacity: 1; pointer-events: auto; }
  .action-btn:hover { filter: brightness(0.85); }

  .query-btn {
    right: calc(100% + 6px);
    background: #e6f1fb; color: #185fa5;
  }
  .submit-btn {
    left: calc(100% + 6px);
    background: #eaf3de; color: #3b6d11;
  }

  @media (prefers-color-scheme: dark) {
    .query-btn { background: #0c447c; color: #b5d4f4; }
    .submit-btn { background: #27500a; color: #c0dd97; }
  }

  /* ZONES — compass quadrants */
  .zone {
    position: absolute;
    width: 260px;
    max-height: 180px;
    border-radius: 10px;
    padding: 8px 10px;
    font-size: 13px;
    overflow-y: auto;
    transition: opacity 0.25s, transform 0.25s;
    opacity: 0; pointer-events: none;
    transform: scale(0.95);
    background: rgba(255,255,255,0.96);
    border: 1px solid rgba(128,128,128,0.15);
    box-shadow: 0 2px 12px rgba(0,0,0,0.08);
  }
  .zone.visible {
    opacity: 1; pointer-events: auto; transform: scale(1);
  }

  @media (prefers-color-scheme: dark) {
    .zone {
      background: rgba(30,30,30,0.96);
      border-color: rgba(128,128,128,0.25);
      color: #ddd;
    }
  }

  /* Upper-left: vapor input */
  .vapor-input { right: calc(100% + 8px); bottom: calc(100% + 8px); }
  /* Lower-left: vapor reply */
  .vapor-reply { right: calc(100% + 8px); top: calc(100% + 8px); }
  /* Lower-right: liquid */
  .liquid-zone { left: calc(100% + 8px); top: calc(100% + 8px); }
  /* Upper-right: solid */
  .solid-zone  { left: calc(100% + 8px); bottom: calc(100% + 8px); }

  .zone-label {
    font-size: 10px; font-weight: 600;
    text-transform: lowercase;
    color: rgba(128,128,128,0.7);
    margin-bottom: 4px;
  }

  textarea.vapor-textarea {
    width: 100%; height: 80px;
    border: none; background: transparent;
    font-size: 13px; color: inherit;
    resize: none; outline: none;
    font-family: inherit;
  }
  textarea.vapor-textarea::placeholder { color: rgba(128,128,128,0.5); }

  .card {
    background: rgba(128,128,128,0.06);
    border: 1px solid rgba(128,128,128,0.1);
    border-radius: 6px;
    padding: 5px 7px;
    margin-bottom: 4px;
    font-size: 12px;
  }
  .card-peer { border-left: 2px solid #185fa5; }

  .commit-btn {
    font-size: 10px;
    padding: 2px 8px;
    border-radius: 4px;
    background: rgba(128,128,128,0.1);
    border: 1px solid rgba(128,128,128,0.2);
    color: inherit;
    cursor: pointer;
  }
  .commit-btn:hover { background: rgba(128,128,128,0.2); }

  .peer-badge {
    font-size: 10px;
    background: #e6f1fb; color: #185fa5;
    padding: 1px 6px; border-radius: 8px;
    display: inline-block;
  }
  @media (prefers-color-scheme: dark) {
    .peer-badge { background: #0c447c; color: #b5d4f4; }
  }

  .typing-dots span {
    display: inline-block; width: 4px; height: 4px;
    background: rgba(128,128,128,0.5); border-radius: 50%;
    margin: 0 1px; animation: blink 1.2s infinite;
  }
  .typing-dots span:nth-child(2) { animation-delay: 0.2s; }
  .typing-dots span:nth-child(3) { animation-delay: 0.4s; }
  @keyframes blink { 0%, 80%, 100% { opacity: 0.3; } 40% { opacity: 1; } }

  .kb-hint {
    font-size: 9px; color: rgba(128,128,128,0.5);
    margin-top: 4px; text-align: right;
  }

  /* BEACH INDICATOR — marks count on button */
  .beach-dot {
    position: absolute;
    top: -2px; right: -2px;
    width: 14px; height: 14px;
    border-radius: 50%;
    background: #d97706;
    color: white;
    font-size: 8px; font-weight: 700;
    display: flex; align-items: center; justify-content: center;
    z-index: 11;
    pointer-events: none;
  }

  .proximity-toast {
    position: absolute;
    bottom: calc(100% + 12px);
    left: 50%;
    transform: translateX(-50%);
    background: rgba(217,119,6,0.95);
    color: white;
    padding: 6px 12px;
    border-radius: 8px;
    font-size: 11px;
    white-space: nowrap;
    max-width: 300px;
    overflow: hidden;
    text-overflow: ellipsis;
    animation: toast-in 0.3s ease;
    pointer-events: auto;
    cursor: pointer;
  }
  @keyframes toast-in {
    from { opacity: 0; transform: translateX(-50%) translateY(4px); }
    to { opacity: 1; transform: translateX(-50%) translateY(0); }
  }
  .proximity-toast:hover { filter: brightness(1.1); }
  @media (prefers-color-scheme: dark) {
    .proximity-toast { background: rgba(180,90,0,0.95); }
  }

  /* CONFIRMATION UI */
  .confirm-card {
    background: rgba(255,243,224,0.95);
    border: 1px solid rgba(200,150,50,0.3);
    border-radius: 6px;
    padding: 6px 8px;
    margin-bottom: 4px;
    font-size: 12px;
  }
  @media (prefers-color-scheme: dark) {
    .confirm-card {
      background: rgba(60,40,10,0.95);
      border-color: rgba(200,150,50,0.4);
    }
  }
  .confirm-actions {
    display: flex; gap: 6px; margin-top: 4px;
  }
  .confirm-yes, .confirm-no {
    font-size: 10px;
    padding: 2px 10px;
    border-radius: 4px;
    border: 1px solid rgba(128,128,128,0.2);
    cursor: pointer;
    background: transparent;
    color: inherit;
  }
  .confirm-yes { background: #eaf3de; color: #3b6d11; }
  .confirm-no { background: #fde8e8; color: #b91c1c; }
  @media (prefers-color-scheme: dark) {
    .confirm-yes { background: #27500a; color: #c0dd97; }
    .confirm-no { background: #5c1010; color: #f5a5a5; }
  }
</style>

<div class="widget-root" id="widget">
  <div class="compass" id="compass">
    <!-- Zones -->
    <div class="zone vapor-input" id="zone-vapor-input">
      <div class="zone-label">vapor</div>
      <textarea class="vapor-textarea" id="input" placeholder="What do you want to do on this page?"></textarea>
      <div class="kb-hint">&#8984;&#8629; query &middot; &#8679;&#8629; submit</div>
    </div>

    <div class="zone vapor-reply" id="zone-vapor-reply">
      <div class="zone-label">reply</div>
      <div id="reply-content"></div>
    </div>

    <div class="zone liquid-zone" id="zone-liquid">
      <div style="display:flex;align-items:center;gap:4px;margin-bottom:4px;">
        <div class="zone-label" style="margin:0;">liquid</div>
        <span class="peer-badge" id="peer-badge" style="display:none;"></span>
        <span style="flex:1;"></span>
        <button class="commit-btn" id="commit-btn" style="display:none;">commit</button>
      </div>
      <div id="liquid-content"></div>
    </div>

    <div class="zone solid-zone" id="zone-solid">
      <div class="zone-label">solid</div>
      <div id="solid-content"></div>
    </div>

    <!-- Action buttons -->
    <button class="action-btn query-btn" id="query-btn" title="Query (&#8984;&#8629;)">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
    </button>
    <button class="action-btn submit-btn" id="submit-btn" title="Submit (&#8679;&#8629;)">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
    </button>

    <!-- Main button -->
    <button class="main-btn" id="main-btn">#</button>
    <div class="beach-dot" id="beach-dot" style="display:none;"></div>
  </div>
</div>
`;

  // ============================================================
  // WIDGET STATE & INTERACTION
  // ============================================================

  const $ = (sel) => shadow.querySelector(sel);
  const mainBtn = $('#main-btn');
  const queryBtn = $('#query-btn');
  const submitBtn = $('#submit-btn');
  const commitBtn = $('#commit-btn');
  const input = $('#input');
  const peerBadge = $('#peer-badge');
  const compass = $('#compass');
  const widgetRoot = $('#widget');

  let isOpen = false;
  let liquidItems = [];
  let solidItems = [];
  let beachMarks = [];

  const zones = ['#zone-vapor-input', '#zone-vapor-reply', '#zone-liquid', '#zone-solid'];

  function timeAgo(isoDate) {
    const diff = Date.now() - new Date(isoDate).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return mins + 'm ago';
    const hours = Math.floor(mins / 60);
    if (hours < 24) return hours + 'h ago';
    const days = Math.floor(hours / 24);
    return days + 'd ago';
  }

  function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function renderBeachMarks() {
    const solidEl = $('#solid-content');
    if (beachMarks.length === 0 && solidItems.length === 0) {
      solidEl.innerHTML =
        '<div style="font-size:11px;color:rgba(128,128,128,0.5);text-align:center;padding:12px 0;">No activity at this page yet</div>';
      return;
    }
    let html = '';
    if (beachMarks.length > 0) {
      html += '<div style="font-size:10px;font-weight:600;color:rgba(128,128,128,0.6);margin-bottom:4px;">Others looked for:</div>';
      beachMarks.forEach(m => {
        html += '<div class="card card-peer">' +
          '<span style="font-size:10px;opacity:0.5;">' + timeAgo(m.t) + '</span> ' +
          escapeHtml(m.s) +
          '</div>';
      });
    }
    solidItems.forEach(s => {
      html += '<div class="card">' + escapeHtml(s) + '</div>';
    });
    solidEl.innerHTML = html;
  }

  // ============================================================
  // DRAG LOGIC — ported from ConstructionButton.tsx lines 83-108
  // ============================================================

  const POS_KEY = 'xstream_widget_pos';
  let isDragging = false;
  let dragStart = { x: 0, y: 0 };
  let position = {
    x: Math.max(20, (window.innerWidth - 56) / 2),
    y: window.innerHeight - 120,
  };

  function applyPosition() {
    widgetRoot.style.left = position.x + 'px';
    widgetRoot.style.top = position.y + 'px';
    widgetRoot.style.bottom = 'auto';
    widgetRoot.style.transform = 'none';
  }

  // Load saved position
  try {
    chrome.storage.local.get(POS_KEY, (result) => {
      if (chrome.runtime.lastError) { applyPosition(); return; }
      if (result[POS_KEY]) {
        try {
          const saved = JSON.parse(result[POS_KEY]);
          position.x = Math.max(0, Math.min(window.innerWidth - 56, saved.x));
          position.y = Math.max(0, Math.min(window.innerHeight - 56, saved.y));
        } catch { /* use default */ }
      }
      applyPosition();
    });
  } catch { applyPosition(); }

  function savePosition() {
    try { chrome.storage.local.set({ [POS_KEY]: JSON.stringify(position) }); }
    catch { /* extension context may be invalidated */ }
  }

  compass.addEventListener('mousedown', (e) => {
    // Don't drag if clicking buttons or textareas
    if (e.target.closest('button') || e.target.closest('textarea')) return;
    e.preventDefault();
    isDragging = true;
    compass.classList.add('dragging');
    dragStart = { x: e.clientX - position.x, y: e.clientY - position.y };

    function onMove(e) {
      position.x = Math.max(0, Math.min(window.innerWidth - 56, e.clientX - dragStart.x));
      position.y = Math.max(0, Math.min(window.innerHeight - 56, e.clientY - dragStart.y));
      applyPosition();
    }

    function onUp() {
      isDragging = false;
      compass.classList.remove('dragging');
      savePosition();
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });

  // ============================================================
  // OPEN / CLOSE
  // ============================================================

  function toggleOpen() {
    isOpen = !isOpen;
    mainBtn.textContent = isOpen ? '+' : '#';
    zones.forEach(sel => $(sel).classList.toggle('visible', isOpen));
    queryBtn.classList.toggle('visible', isOpen);
    submitBtn.classList.toggle('visible', isOpen);
    if (isOpen) {
      setTimeout(() => input.focus(), 100);
      renderBeachMarks();
      // Button press = intentional presence mark
      chrome.runtime.sendMessage({ type: 'WIDGET_OPENED' });
    }
  }

  mainBtn.addEventListener('click', () => {
    if (!isDragging) toggleOpen();
  });

  // Query soft-LLM (left button)
  queryBtn.addEventListener('click', () => {
    const text = input.value.trim();
    if (!text) return;
    $('#reply-content').innerHTML = '<div class="typing-dots"><span></span><span></span><span></span></div>';
    chrome.runtime.sendMessage({ type: 'QUERY_SOFT', query: text });
  });

  // Submit to liquid (right button)
  submitBtn.addEventListener('click', () => {
    const text = input.value.trim();
    if (!text) return;
    liquidItems.push({ text, self: true });
    input.value = '';
    renderLiquid();
    commitBtn.style.display = 'inline-block';
    chrome.runtime.sendMessage({ type: 'SUBMIT_LIQUID', text });
  });

  // Commit (liquid -> solid)
  commitBtn.addEventListener('click', () => {
    const selfItems = liquidItems.filter(i => i.self);
    if (selfItems.length === 0) return;
    const combined = selfItems.map(i => i.text).join('; ');
    $('#solid-content').innerHTML = '<div class="typing-dots"><span></span><span></span><span></span></div>';
    chrome.runtime.sendMessage({ type: 'COMMIT', liquid: combined });
    liquidItems = liquidItems.filter(i => !i.self);
    renderLiquid();
    commitBtn.style.display = 'none';
  });

  // Keyboard shortcuts
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      queryBtn.click();
    } else if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      submitBtn.click();
    } else if (e.key === 'Escape') {
      toggleOpen();
    }
  });

  function renderLiquid() {
    const el = $('#liquid-content');
    el.innerHTML = liquidItems.map(item =>
      `<div class="card${item.self ? '' : ' card-peer'}">${
        item.self ? '' : `<span style="font-size:10px;opacity:0.7;">${item.name}:</span> `
      }${item.text}</div>`
    ).join('');
  }

  // ============================================================
  // ACTION CONFIRMATION — destructive ops need user approval
  // ============================================================

  function requestConfirmation(actions, onConfirm, onReject) {
    const solidEl = $('#solid-content');
    const safeActions = actions.filter(a => !isDestructive(a));
    const dangerousActions = actions.filter(a => isDestructive(a));

    // Execute safe actions immediately
    safeActions.forEach(a => executeAction(a));

    if (dangerousActions.length === 0) {
      onConfirm();
      return;
    }

    // Show confirmation for dangerous actions
    const descriptions = dangerousActions.map(describeAction).join('<br>');
    const confirmHtml = `
      <div class="confirm-card">
        <div style="font-size:10px;font-weight:600;margin-bottom:3px;">Confirm actions:</div>
        <div>${descriptions}</div>
        <div class="confirm-actions">
          <button class="confirm-yes" id="confirm-yes">execute</button>
          <button class="confirm-no" id="confirm-no">skip</button>
        </div>
      </div>
    `;
    solidEl.innerHTML = confirmHtml;

    shadow.querySelector('#confirm-yes').addEventListener('click', () => {
      dangerousActions.forEach(a => executeAction(a));
      onConfirm();
    });

    shadow.querySelector('#confirm-no').addEventListener('click', () => {
      onReject();
    });
  }

  // ============================================================
  // MESSAGE HANDLER — service worker -> content script
  // ============================================================

  chrome.runtime.onMessage.addListener((msg) => {
    switch (msg.type) {
      case 'SOFT_RESPONSE': {
        const r = msg.result;
        $('#reply-content').textContent = r?.text || 'No response.';
        break;
      }
      case 'SOLID_RESULT': {
        const r = msg.result;
        const actions = r?.actions || [];

        if (actions.length > 0) {
          requestConfirmation(
            actions,
            () => {
              // After confirmation/execution, show solid result
              solidItems.push(r?.solid || 'Done.');
              renderBeachMarks();
            },
            () => {
              // User skipped — show what was skipped
              solidItems.push((r?.solid || 'Done.') + ' (actions skipped)');
              renderBeachMarks();
            },
          );
        } else {
          solidItems.push(r?.solid || 'Done.');
          renderBeachMarks();
        }
        break;
      }
      case 'BEACH_UPDATE': {
        const dot = shadow.querySelector('#beach-dot');
        if (msg.density > 0) {
          dot.textContent = msg.density > 9 ? '9+' : String(msg.density);
          dot.style.display = 'flex';
        } else {
          dot.style.display = 'none';
        }
        beachMarks = msg.meaningfulMarks || [];
        if (isOpen) renderBeachMarks();
        break;
      }
      case 'PROXIMITY_MATCH': {
        // Show a toast above the button — someone with a resonant purpose was here
        const existing = shadow.querySelector('.proximity-toast');
        if (existing) existing.remove();
        const toast = document.createElement('div');
        toast.className = 'proximity-toast';
        toast.textContent = msg.reason || 'Someone with a similar purpose was here';
        compass.appendChild(toast);
        toast.addEventListener('click', () => {
          // Open the widget and show the match in solid zone
          if (!isOpen) toggleOpen();
          const matchInfo = (msg.marks || [])
            .map(m => `${m.agent}: "${m.s}" (${new Date(m.t).toLocaleDateString()})`)
            .join('<br>');
          $('#solid-content').innerHTML =
            `<div class="card"><div style="font-size:10px;font-weight:600;margin-bottom:2px;">Nearby purposes:</div>${matchInfo}</div>`;
          toast.remove();
        });
        // Auto-dismiss after 8 seconds
        setTimeout(() => toast.remove(), 8000);
        break;
      }
      case 'PEER_UPDATE': {
        const peers = msg.peers || [];
        liquidItems = liquidItems.filter(i => i.self);
        peers.forEach(p => {
          liquidItems.push({ text: p.liquid, self: false, name: p.name });
        });
        renderLiquid();
        if (msg.peerCount > 0) {
          peerBadge.textContent = `${msg.peerCount} peer${msg.peerCount > 1 ? 's' : ''}`;
          peerBadge.style.display = 'inline-block';
        } else {
          peerBadge.style.display = 'none';
        }
        break;
      }
    }
  });

  return { shadow, host };
}

// ============================================================
// INIT — inject widget and report page to kernel
// ============================================================

(function init() {
  if (location.protocol === 'chrome:' || location.protocol === 'chrome-extension:') return;

  chrome.runtime.sendMessage({ type: 'CHECK_API_KEY' }, (response) => {
    if (!response?.hasKey) return;

    createWidget();

    const snapshot = extractPageSnapshot();
    chrome.runtime.sendMessage({
      type: 'PAGE_LOADED',
      url: location.href,
      snapshot,
    });
  });
})();
