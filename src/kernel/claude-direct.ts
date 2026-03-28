/**
 * Direct browser-to-Anthropic API call.
 * The API key never leaves the browser. Our server never sees it.
 *
 * Now with proper system/user message split and harness control.
 * Constraint instruction appended to user message.
 * Few-shot examples appended to system prompt.
 */

import type { HarnessConfig } from './harness';

export async function callClaude(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userPrompt: string,
  harness: HarnessConfig
): Promise<string> {
  // Build system with few-shot examples appended
  const system = harness.few_shot.length > 0
    ? `${systemPrompt}\n\n${harness.few_shot.join('\n\n')}`
    : systemPrompt;

  // Append constraint to user prompt
  const message = harness.constraint
    ? `${userPrompt}\n\n${harness.constraint}`
    : userPrompt;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model,
      max_tokens: harness.max_tokens,
      temperature: harness.temperature,
      system,
      messages: [{ role: 'user', content: message }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude API ${res.status}: ${err}`);
  }

  const data = await res.json();
  return data.content?.[0]?.text ?? '';
}
