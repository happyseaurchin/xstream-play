/**
 * blocks-dynamic.js — build pscale blocks from runtime data
 *
 * These functions convert page snapshots and beach marks into
 * walkable pscale blocks. The agent block stars to "page-context"
 * and "beach-context" — these functions produce what those names resolve to.
 */

/**
 * Convert a page snapshot (JSON string from content.js) into a pscale block.
 *
 * Structure:
 *   _: page title + URL
 *   1: { _: "Content", 1: headings, 2: text summary }
 *   2: { _: "Interactive", 1: buttons, 2: forms, 3: links }
 *   3: meta description
 */
function buildPageBlock(snapshotJson) {
  let snap;
  try {
    snap = typeof snapshotJson === 'string' ? JSON.parse(snapshotJson) : snapshotJson;
  } catch { return { _: 'Page context unavailable.' }; }

  const headings = [
    ...(snap.headings?.h1 || []),
    ...(snap.headings?.h2 || []),
  ].filter(Boolean);

  const buttons = (snap.buttons || [])
    .map(b => b.text).filter(Boolean).slice(0, 8);

  const forms = (snap.forms || [])
    .map(f => f.inputs?.map(i => i.name || i.type).join(', '))
    .filter(Boolean);

  const links = (snap.links || [])
    .map(l => l.text).filter(Boolean).slice(0, 8);

  const block = {
    _: `${snap.title || 'Untitled'} — ${snap.url || ''}`,
  };

  // Branch 1: Content
  const content = { _: 'Content:' };
  if (headings.length > 0) content['1'] = headings.join('. ');
  if (snap.textSummary) content['2'] = snap.textSummary;
  block['1'] = content;

  // Branch 2: Interactive elements
  const interactive = { _: 'Interactive elements:' };
  if (buttons.length > 0) interactive['1'] = 'Buttons: ' + buttons.join(', ');
  if (forms.length > 0) interactive['2'] = 'Forms: ' + forms.join('; ');
  if (links.length > 0) interactive['3'] = 'Links: ' + links.join(', ');
  if (Object.keys(interactive).length > 1) block['2'] = interactive;

  // Branch 3: Meta
  if (snap.meta) block['3'] = snap.meta;

  return block;
}

/**
 * Convert beach marks into a pscale block.
 *
 * Structure:
 *   _: "N visitors have been here."
 *   1..9: individual marks, newest first
 *     each: "purpose (time ago)"
 */
function buildBeachBlock(marks) {
  if (!marks || marks.length === 0) {
    return { _: 'No other visitors have been here.' };
  }

  const block = {
    _: `${marks.length} visitor${marks.length > 1 ? 's have' : ' has'} been here.`,
  };

  // Up to 9 marks (pscale has digits 1-9)
  marks.slice(0, 9).forEach((m, i) => {
    const age = timeAgoShort(m.t);
    const purpose = m.s || 'present';
    block[String(i + 1)] = `${purpose} (${age})`;
  });

  return block;
}

export { buildPageBlock, buildBeachBlock };

function timeAgoShort(isoDate) {
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return mins + 'm ago';
  const hours = Math.floor(mins / 60);
  if (hours < 24) return hours + 'h ago';
  return Math.floor(hours / 24) + 'd ago';
}
