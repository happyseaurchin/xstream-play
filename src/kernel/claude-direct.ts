/**
 * claude-direct.ts — direct browser-to-Anthropic transport.
 *
 * The API key never leaves the browser. Every call is logged to /api/filmstrip
 * (fire-and-forget). Used by both the legacy plain-text path and the magic-move
 * tool-use loop in claude-tools.ts.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

export interface MessagesRequest {
  model: string;
  max_tokens: number;
  system?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tools?: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  messages: Array<{ role: 'user' | 'assistant'; content: any }>;
}

export interface MessagesResponse {
  id: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  content: Array<{ type: string; [k: string]: any }>;
  stop_reason: string | null;
  usage?: { input_tokens?: number; output_tokens?: number };
}

/** Low-level Messages API call. Returns the parsed response or throws. */
export async function messagesApi(apiKey: string, body: MessagesRequest): Promise<MessagesResponse> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude API ${res.status}: ${err}`);
  }
  return await res.json() as MessagesResponse;
}

/** Fire-and-forget filmstrip log. Never throws. */
export function logFilmstrip(entry: {
  model: string;
  system_prompt: string;
  user_prompt: string;
  response: string;
  max_tokens: number;
  input_tokens: number | null;
  output_tokens: number | null;
  stop_reason: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  extras?: Json;
}): void {
  fetch('/api/filmstrip', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(entry),
  }).catch(() => {});
}

/**
 * Plain single-shot text call — used when no tool-use is needed (e.g. the
 * fallback path when no shell / no apiKey). Kept for backward compatibility
 * with anything that still calls callClaude directly.
 */
export async function callClaude(
  apiKey: string,
  model: string,
  prompt: string,
  maxTokens: number
): Promise<string> {
  const data = await messagesApi(apiKey, {
    model,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
  });
  const responseText = data.content?.[0]?.text ?? '';
  logFilmstrip({
    model,
    system_prompt: '',
    user_prompt: prompt,
    response: responseText,
    max_tokens: maxTokens,
    input_tokens: data.usage?.input_tokens ?? null,
    output_tokens: data.usage?.output_tokens ?? null,
    stop_reason: data.stop_reason ?? null,
  });
  return responseText;
}
