/**
 * POST /api/beach/[urlHash]/mark — leave a stigmergy mark
 *
 * Body: { agent_id, passport_url?, purpose }
 *
 * Validation:
 * - agent_id required, max 32 chars
 * - passport_url optional, must be valid URL if present
 * - purpose required, max 200 chars
 * - purpose starting with 'fold:' is a fold marker (followed by archive URL)
 * - Rate limit: 1 mark per agent per URL per 10 minutes
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY!;
const RATE_LIMIT_MINUTES = 10;

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

function isValidUrl(s: string): boolean {
  try {
    new URL(s);
    return true;
  } catch {
    return false;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });

  const urlHash = req.query.urlHash as string;
  if (!urlHash || urlHash.length < 8) {
    return res.status(400).json({ error: 'invalid url_hash' });
  }

  const body = req.body;
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ error: 'body required' });
  }

  const agentId = String(body.agent_id || '').trim();
  const passportUrl = body.passport_url ? String(body.passport_url).trim() : null;
  const purpose = String(body.purpose || '').trim();

  if (!agentId || agentId.length > 32) {
    return res.status(400).json({ error: 'agent_id required, max 32 chars' });
  }
  if (!purpose || purpose.length > 200) {
    return res.status(400).json({ error: 'purpose required, max 200 chars' });
  }
  if (passportUrl && !isValidUrl(passportUrl)) {
    return res.status(400).json({ error: 'invalid passport_url format' });
  }
  if (purpose.startsWith('fold:') && !isValidUrl(purpose.slice(5))) {
    return res.status(400).json({ error: 'fold URL must be valid' });
  }

  try {
    // Rate limit: 1 mark per agent per URL per N minutes
    const since = new Date(Date.now() - RATE_LIMIT_MINUTES * 60 * 1000).toISOString();
    const checkPath = `/beach_marks?url_hash=eq.${urlHash}&agent_id=eq.${agentId}&created_at=gt.${since}&select=id&limit=1`;
    const checkResp = await supaFetch(checkPath);

    if (checkResp.ok) {
      const existing = await checkResp.json();
      if (existing.length > 0) {
        return res.status(429).json({
          error: `rate limited: 1 mark per ${RATE_LIMIT_MINUTES} minutes per URL`,
        });
      }
    }

    // Insert mark
    const insertResp = await supaFetch('/beach_marks', {
      method: 'POST',
      body: JSON.stringify({
        url_hash: urlHash,
        agent_id: agentId,
        passport_url: passportUrl,
        purpose,
      }),
    });

    if (!insertResp.ok) {
      const err = await insertResp.text();
      return res.status(500).json({ error: err });
    }

    return res.status(201).json({ ok: true, url_hash: urlHash });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return res.status(500).json({ error: msg });
  }
}
