/**
 * GET /api/beach/[urlHash] — read marks at a URL coordinate
 *
 * Returns all marks since the most recent fold mark (or all if no fold).
 * Query params:
 *   ?limit=50      — max marks to return (default 50)
 *   ?since=ISO8601 — only marks after this timestamp
 *   ?full=true     — include fold chain (all marks, ignore fold boundary)
 *
 * Response: { marks: [...], peer_count: N, fold_url: string|null }
 *
 * This is SAND implemented as a relay.
 * The URL hash replaces the site's /visitors.json endpoint.
 * Sites don't need to cooperate. The beach is external.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY!;

function supaFetch(path: string, init?: RequestInit) {
  return fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'GET') return res.status(405).json({ error: 'method not allowed' });

  const urlHash = req.query.urlHash as string;
  if (!urlHash || urlHash.length < 8) {
    return res.status(400).json({ error: 'invalid url_hash' });
  }

  const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
  const since = req.query.since as string;
  const full = req.query.full === 'true';

  try {
    let path = `/beach_marks?url_hash=eq.${urlHash}&order=created_at.desc&limit=${limit}`;
    if (since) {
      path += `&created_at=gt.${since}`;
    }
    path += '&select=agent_id,passport_url,purpose,created_at';

    const resp = await supaFetch(path);
    if (!resp.ok) {
      const err = await resp.text();
      return res.status(500).json({ error: err });
    }

    const rows = await resp.json() as Array<{
      agent_id: string;
      passport_url: string | null;
      purpose: string;
      created_at: string;
    }>;

    // Apply fold boundary unless full=true
    let marks = rows;
    let foldUrl: string | null = null;

    if (!full) {
      const foldIdx = rows.findIndex(r => r.purpose.startsWith('fold:'));
      if (foldIdx >= 0) {
        foldUrl = rows[foldIdx].purpose.slice(5);
        marks = rows.slice(0, foldIdx);
      }
    }

    // Map to SAND mark format
    const sandMarks = marks.map(r => ({
      t: r.created_at,
      p: r.passport_url || null,
      s: r.purpose,
      agent: r.agent_id,
    }));

    const uniqueAgents = new Set(marks.map(r => r.agent_id));

    return res.status(200).json({
      marks: sandMarks,
      peer_count: uniqueAgents.size,
      fold_url: foldUrl,
      url_hash: urlHash,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return res.status(500).json({ error: msg });
  }
}
