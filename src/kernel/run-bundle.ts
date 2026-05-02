/**
 * run-bundle.ts — the unified LLM-instance primitive.
 *
 * Per the orientation: soft / medium / hard are not three LLM types, they
 * are three bundle types. A bundle is (addresses, identity, framing, tools,
 * output). The same LLM wakes up in any of them.
 *
 * This module is the runner. It takes a fully-composed BundleSpec — system
 * prompt already assembled from the bundle's scoop — and runs the LLM
 * instance: single-shot when no tools are provided, multi-turn tool-use
 * loop when tools are. Both soft (multi-turn, bsp-mcp) and medium
 * (single-shot, plain text out) flow through here.
 *
 * The address-scoop step (resolving the bundle's address list to a system
 * prompt) lives in the call sites for now — claude-tools.ts composes the
 * soft prompt; medium-llm.ts composes the medium prompt. Future move: the
 * BundleSpec also names a scoop list; runBundle reads the bundle definition
 * from blocks (or shell:bundle:* per user) and resolves the scoop itself.
 * That is when bundles become truly reflexive — editable in flow.
 */

import { messagesApi, logFilmstrip, type MessagesResponse } from './claude-direct';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTool = any;

export interface BundleTelemetry {
  tier: 'soft' | 'medium' | 'hard';
  face?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  extras?: Record<string, any>;
}

export interface BundleSpec {
  // identity
  apiKey: string;
  model: string;
  // operational frame — pre-composed system prompt (bundle scoop already
  // resolved). When the scoop step moves into this module, this field will
  // be derived from spec.scoop instead.
  systemPrompt: string;
  // tools (empty / undefined for single-shot like medium)
  tools?: AnyTool[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  toolExecutor?: (name: string, input: Record<string, any>) => Promise<string>;
  // limits
  maxTurns?: number;
  maxTokens?: number;
  // telemetry
  telemetry?: BundleTelemetry;
  // hooks
  onToolCall?: (name: string, input: unknown) => void;
}

export interface BundleResult {
  text: string;
  toolCalls: Array<{ name: string; input: unknown }>;
  turns: number;
  bundleStop: string | null;
}

/**
 * Run an LLM instance inside a bundle. Single-shot when spec.tools is
 * absent or maxTurns=1; tool-use loop otherwise.
 */
export async function runBundle(spec: BundleSpec, userMessage: string): Promise<BundleResult> {
  const maxTurns = spec.maxTurns ?? (spec.tools ? 8 : 1);
  const maxTokens = spec.maxTokens ?? 1024;
  const useTools = !!spec.tools && spec.tools.length > 0 && !!spec.toolExecutor;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const messages: Array<{ role: 'user' | 'assistant'; content: any }> = [
    { role: 'user', content: userMessage },
  ];
  const toolCalls: Array<{ name: string; input: unknown }> = [];
  let lastUsage: { input_tokens?: number; output_tokens?: number } | undefined;
  let lastStop: string | null = null;
  let lastResp: MessagesResponse | null = null;

  for (let turn = 0; turn < maxTurns; turn++) {
    const data = await messagesApi(spec.apiKey, {
      model: spec.model,
      max_tokens: maxTokens,
      system: spec.systemPrompt,
      ...(useTools ? { tools: spec.tools } : {}),
      messages,
    });
    lastResp = data;
    lastUsage = data.usage;
    lastStop = data.stop_reason;

    const content = data.content || [];
    messages.push({ role: 'assistant', content });

    if (useTools && data.stop_reason === 'tool_use') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const toolUses = content.filter((c: any) => c.type === 'tool_use');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const toolResults: any[] = [];
      for (const tu of toolUses) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const t = tu as unknown as { id: string; name: string; input: any };
        toolCalls.push({ name: t.name, input: t.input });
        spec.onToolCall?.(t.name, t.input);
        const result = await spec.toolExecutor!(t.name, t.input);
        toolResults.push({ type: 'tool_result', tool_use_id: t.id, content: result });
      }
      messages.push({ role: 'user', content: toolResults });
      continue;
    }

    // terminal — extract text and return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const text = content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n').trim();
    logFilmstrip({
      model: spec.model,
      system_prompt: spec.systemPrompt,
      user_prompt: userMessage,
      response: text,
      max_tokens: maxTokens,
      input_tokens: lastUsage?.input_tokens ?? null,
      output_tokens: lastUsage?.output_tokens ?? null,
      stop_reason: lastStop,
      extras: { ...(spec.telemetry ?? {}), tool_calls: toolCalls.length, turns: turn + 1 },
    });
    return { text: text || '(no response)', toolCalls, turns: turn + 1, bundleStop: lastStop };
  }

  // exhausted
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant') as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const text = lastAssistant?.content?.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n').trim() || '';
  logFilmstrip({
    model: spec.model,
    system_prompt: spec.systemPrompt,
    user_prompt: userMessage,
    response: text || '(max turns)',
    max_tokens: maxTokens,
    input_tokens: lastUsage?.input_tokens ?? null,
    output_tokens: lastUsage?.output_tokens ?? null,
    stop_reason: lastStop,
    extras: { ...(spec.telemetry ?? {}), tool_calls: toolCalls.length, turns: maxTurns, exhausted: true },
  });
  void lastResp;
  return { text: text || '(bundle exhausted tool-use turns)', toolCalls, turns: maxTurns, bundleStop: lastStop };
}
