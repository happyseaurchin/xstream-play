/**
 * Harness — resolve output constraints from BSP walk of harness.json.
 *
 * Returns constraint text and few-shot examples for injection into prompts.
 * Does NOT touch callClaude or API parameters — this shapes prompt text only.
 */

import { bsp } from './bsp';
import type { DirResult } from './bsp';
import { getBlock } from './block-store';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PscaleNode = string | { [key: string]: any };

export interface HarnessConfig {
  constraint: string;
  few_shot: string[];
}

const PSCALE_TO_KEY: Record<number, number> = {
  [-4]: 1,
  [-3]: 2,
  [-2]: 3,
  [-1]: 4,
  [0]:  5,
};

const DEFAULT: HarnessConfig = { constraint: '', few_shot: [] };

function collectTexts(node: unknown): string[] {
  if (!node || typeof node !== 'object') return [];
  const obj = node as Record<string, unknown>;
  const texts: string[] = [];
  for (let d = 1; d <= 9; d++) {
    const val = obj[String(d)];
    if (typeof val === 'string') texts.push(val);
  }
  return texts;
}

/**
 * Resolve harness for a pscale level.
 * Returns constraint text and few-shot examples — for prompt injection only.
 */
export function resolveHarness(pscale: number): HarnessConfig {
  const key = PSCALE_TO_KEY[pscale];
  if (key == null) return DEFAULT;

  const harnessBlock = getBlock('harness');
  if (!harnessBlock) return DEFAULT;
  const dirResult = bsp(harnessBlock as PscaleNode, `0.${key}`, 'dir') as DirResult;
  const node = dirResult.subtree;
  if (!node || typeof node !== 'object') return DEFAULT;

  const obj = node as Record<string, unknown>;

  return {
    constraint: collectTexts(obj['2']).join(' '),
    few_shot: collectTexts(obj['3']),
  };
}
