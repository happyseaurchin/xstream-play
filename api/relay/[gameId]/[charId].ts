/**
 * PUT /api/relay/[gameId]/[charId] — store a character's block
 * GET /api/relay/[gameId]/[charId] — get a specific character's block
 *
 * Relay storage: Supabase relay_blocks table (upsert by game_id + char_id)
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
      Prefer: 'return=minimal',
      ...init?.headers,
    },
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { gameId, charId } = req.query as { gameId: string; charId: string };

  if (req.method === 'PUT') {
    try {
      let block = req.body;
      if (typeof block === 'string') block = JSON.parse(block);
      if (!block || typeof block !== 'object') {
        return res.status(400).json({ error: 'Invalid JSON body' });
      }

      // Strip API key before storing — never relay secrets
      const safe = JSON.parse(JSON.stringify(block));
      if (safe.medium) safe.medium.api_key = '[REDACTED]';

      const resp = await supaFetch(
        '/relay_blocks?on_conflict=game_id,char_id',
        {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify({
            game_id: gameId,
            char_id: charId,
            block: safe,
            updated_at: new Date().toISOString(),
          }),
        }
      );

      if (!resp.ok) {
        const err = await resp.text();
        console.error('[relay PUT]', resp.status, err);
        return res.status(500).json({ error: err });
      }

      return res.status(200).json({ ok: true });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      console.error('[relay PUT]', msg);
      return res.status(500).json({ error: msg });
    }
  }

  if (req.method === 'GET') {
    try {
      const resp = await supaFetch(
        `/relay_blocks?game_id=eq.${gameId}&char_id=eq.${charId}&select=block`,
        { method: 'GET', headers: { Prefer: 'return=representation' } }
      );
      if (!resp.ok) return res.status(404).json({ error: 'not found' });
      const rows = await resp.json();
      if (!rows.length) return res.status(404).json({ error: 'not found' });
      return res.status(200).json(rows[0].block);
    } catch {
      return res.status(404).json({ error: 'not found' });
    }
  }

  return res.status(405).json({ error: 'method not allowed' });
}
