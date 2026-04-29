/**
 * Mutable in-memory block store.
 *
 * Beach mode: only the three shared agent blocks (medium / soft / hard) seed
 * here. Substrate-fetched blocks (resolved via star refs from the agent
 * blocks' hidden directories) are injected at runtime via injectBlock().
 *
 * No fantasy seeds. The substrate provides the world.
 */

import mediumAgent from '../../blocks/xstream/medium-agent.json';
import softAgent from '../../blocks/xstream/soft-agent.json';
import hardAgent from '../../blocks/xstream/hard-agent.json';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PscaleNode = string | { [key: string]: any };

const store = new Map<string, PscaleNode>();

const seeds: Record<string, PscaleNode> = {
  'medium-agent': mediumAgent,
  'soft-agent': softAgent,
  'hard-agent': hardAgent,
};

for (const [name, block] of Object.entries(seeds)) {
  store.set(name, structuredClone(block));
}

export function getBlock(name: string): PscaleNode | null {
  return store.get(name) ?? null;
}

/**
 * Inject a block in-memory only. Used for substrate-fetched blocks resolved
 * from star refs. Does NOT persist to localStorage.
 */
export function injectBlock(name: string, block: PscaleNode): void {
  store.set(name, block);
}

export function listBlocks(): string[] {
  return [...store.keys()];
}
