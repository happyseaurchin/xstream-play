/**
 * Direct browser-to-Anthropic API call.
 * The API key never leaves the browser. Our server never sees it.
 * Every call is logged to /api/filmstrip (fire-and-forget).
 */

export async function callClaude(
  apiKey: string,
  model: string,
  prompt: string,
  maxTokens: number
): Promise<string> {
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
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude API ${res.status}: ${err}`);
  }

  const data = await res.json();
  const responseText = data.content?.[0]?.text ?? '';

  // Filmstrip — fire and forget, never blocks gameplay
  fetch('/api/filmstrip', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      system_prompt: '',
      user_prompt: prompt,
      response: responseText,
      max_tokens: maxTokens,
      input_tokens: data.usage?.input_tokens ?? null,
      output_tokens: data.usage?.output_tokens ?? null,
      stop_reason: data.stop_reason ?? null,
    }),
  }).catch(() => {});

  return responseText;
}
