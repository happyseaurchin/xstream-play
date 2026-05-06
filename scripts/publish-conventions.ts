/**
 * publish-conventions.ts — author the conventions block at
 * https://happyseaurchin.com:beach:8 from the local vendored copy
 * (blocks/conventions.json).
 *
 * The federated beach handler at happyseaurchin.com supports point writes
 * inside the beach block at any digit position. Position 8 is reserved/free
 * per protocol-pscale-beach-v2.md §5; we use it for site-local conventions.
 *
 * Reads vendored content + the site owner's passphrase and POSTs directly
 * to /.well-known/pscale-beach. No browser. No Vite. No DB. Just a federated
 * write.
 *
 * Usage:
 *   HAPPYSEAURCHIN_SECRET=<your-passphrase> \
 *     node --import tsx ./scripts/publish-conventions.ts
 *
 * After this lands, agents reading the federated beach can walk
 *   bsp(agent_id="https://happyseaurchin.com", block="beach", spindle="8")
 * to get the conventions block. xstream's soft-LLM picks them up
 * automatically when composing context.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONVENTIONS_PATH = resolve(__dirname, '../blocks/conventions.json');
const BEACH_ORIGIN = 'https://happyseaurchin.com';
const BEACH_ENDPOINT = `${BEACH_ORIGIN}/.well-known/pscale-beach`;
const BEACH_BLOCK = 'beach';
const POSITION = '8';

async function main() {
  const secret = process.env.HAPPYSEAURCHIN_SECRET;
  if (!secret) {
    console.error('Set HAPPYSEAURCHIN_SECRET=<your-passphrase> in env.');
    process.exit(1);
  }

  const raw = readFileSync(CONVENTIONS_PATH, 'utf8');
  const content = JSON.parse(raw);
  console.log(`Loaded conventions block (${raw.length} bytes from blocks/conventions.json).`);

  // Federated POST to /.well-known/pscale-beach — body shape mirrors bsp()
  // params: { spindle, content, secret }. The handler at happyseaurchin.com
  // applies the bsp write semantics including lock checks.
  const body = {
    spindle: POSITION,
    content,
    secret,
  };

  console.log(`POSTing to ${BEACH_ENDPOINT}?block=${BEACH_BLOCK} at spindle=${POSITION}…`);
  const res = await fetch(`${BEACH_ENDPOINT}?block=${BEACH_BLOCK}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  if (!res.ok) {
    console.error(`Write failed: HTTP ${res.status}`);
    console.error(text);
    process.exit(1);
  }
  console.log(`OK ${res.status}`);
  console.log(text);

  // Verify by reading back.
  console.log('\nReading back…');
  const verify = await fetch(`${BEACH_ENDPOINT}?spindle=${POSITION}`, {
    cache: 'no-store',
  });
  const verifyText = await verify.text();
  if (!verify.ok) {
    console.error(`Read-back failed: HTTP ${verify.status}`);
    console.error(verifyText);
    process.exit(1);
  }
  console.log(`Read-back OK ${verify.status} (${verifyText.length} bytes)`);
  console.log('First 200 chars:', verifyText.slice(0, 200));
}

main().catch(e => {
  console.error('Fatal:', e instanceof Error ? e.message : e);
  process.exit(1);
});
