/**
 * Aperture control — BSP-addressable output constraints.
 *
 * Walks aperture.json at the target pscale level to extract:
 * - API parameters (max_tokens, temperature)
 * - Constraint instruction (appended to user prompt)
 * - Few-shot examples (appended to system prompt)
 *
 * To change output length: change the pscale number. The block carries all semantics.
 */

import { bsp } from './bsp';
import type { DirResult } from './bsp';
import apertureBlock from '../../blocks/xstream/aperture.json';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PscaleNode = string | { [key: string]: any };

export interface ApertureConfig {
  max_tokens: number;
  temperature: number;
  constraint: string;
  few_shot: string[];
}

// Digit key for each pscale level
const PSCALE_TO_KEY: Record<number, number> = {
  [-4]: 1,
  [-3]: 2,
  [-2]: 3,
  [-1]: 4,
  [0]:  5,
};

const DEFAULT_APERTURE: ApertureConfig = {
  max_tokens: 1024,
  temperature: 0.7,
  constraint: '',
  few_shot: [],
};

/**
 * Collect string values at digit keys 1-9 from a node.
 */
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
 * Parse "key: value" pairs from a node's digit children.
 */
function parseApiParams(node: unknown): { max_tokens: number; temperature: number } {
  const result = { max_tokens: 1024, temperature: 0.7 };
  if (!node || typeof node !== 'object') return result;
  const obj = node as Record<string, unknown>;

  for (let d = 1; d <= 9; d++) {
    const val = obj[String(d)];
    if (typeof val !== 'string') continue;
    const [key, num] = val.split(':').map(s => s.trim());
    if (key === 'max_tokens') result.max_tokens = parseInt(num) || 1024;
    if (key === 'temperature') result.temperature = parseFloat(num) || 0.7;
  }
  return result;
}

/**
 * Resolve aperture configuration from BSP walk of aperture.json.
 *
 * Usage:
 *   const config = resolveAperture(-2);  // paragraph-level
 *   await callClaude(key, model, system, prompt, config);
 */
export function resolveAperture(pscale: number): ApertureConfig {
  const key = PSCALE_TO_KEY[pscale];
  if (key == null) return DEFAULT_APERTURE;

  // Walk to the pscale node — dir gives us the full subtree
  const address = `0.${key}`;
  const dirResult = bsp(apertureBlock as PscaleNode, address, 'dir') as DirResult;
  const node = dirResult.subtree;
  if (!node || typeof node !== 'object') return DEFAULT_APERTURE;

  const obj = node as Record<string, unknown>;

  // Sub-key 1 = API params, 2 = constraint, 3 = few-shot
  const api = parseApiParams(obj['1']);
  const constraints = collectTexts(obj['2']);
  const fewShots = collectTexts(obj['3']);

  return {
    max_tokens: api.max_tokens,
    temperature: api.temperature,
    constraint: constraints.join(' '),
    few_shot: fewShots,
  };
}
