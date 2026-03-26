/**
 * GET /api/relay/[gameId]?exclude=charId — list all blocks for a game
 *
 * Returns an array of character blocks, excluding the requester's own.
 * This is what the kernel polls to discover peer events and dominos.
 *
 * Relay storage: Supabase relay_blocks table
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

  const { gameId, exclude } = req.query as { gameId: string; exclude?: string };

  try {
    let path = `/relay_blocks?game_id=eq.${gameId}&select=block`;
    if (exclude) {
      path += `&char_id=neq.${exclude}`;
    }

    const resp = await supaFetch(path);
    if (!resp.ok) {
      const err = await resp.text();
      return res.status(500).json({ error: err });
    }

    const rows = await resp.json();
    return res.status(200).json(rows.map((r: { block: unknown }) => r.block));
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return res.status(500).json({ error: msg });
  }
}
