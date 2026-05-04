# LLM-agnostic xstream — spec

**Status**: deferred design. Captures the work to make xstream-play talk to non-Anthropic LLM APIs (OpenAI, Google, ollama-served local models, anything OpenAI-compatible). Not on the active phased plan; pulled in once Phase E/G land or when local-LLM testing becomes pressing.

**Why now**: David flagged that xstream's "any LLM" promise (per `AboutPage.tsx`) is currently aspirational — Anthropic is the only wired provider. Capturing the work as a spec now means the next time it surfaces, it's executable.

---

## 1. Current Anthropic-specific surface

Audit of `src/` for Anthropic dependencies (after Phase D):

| File | What's Anthropic-specific |
|---|---|
| `src/kernel/claude-direct.ts` | `messagesApi(apiKey, body)` posts to `https://api.anthropic.com/v1/messages` with `x-api-key`, `anthropic-version: 2023-06-01`, `anthropic-dangerous-direct-browser-access: true`. ~80 lines. THE transport. |
| `src/kernel/claude-tools.ts` | `callClaudeViaMcpConnector()` posts to the same endpoint with the `mcp-client-2025-04-04` beta header. Anthropic-only feature. ~50 lines. |
| `src/kernel/beach-session.ts` | Default `medium_model` and `soft_model` are `claude-sonnet-4-6` literals. |
| `src/kernel/claude-tools.ts` | `interface AnthropicTool` — schema name. Body is identical to OpenAI function-calling and ollama tool-calling. Cosmetic. |
| `src/kernel/run-bundle.ts` | Imports `messagesApi`. The loop body itself is generic — assumes a request/response shape, dispatches tools, handles `stop_reason`, `tool_use` content blocks. |
| `src/kernel/recipe-runner.ts` | Provider-agnostic. Doesn't know about Anthropic at all. |

**Conclusion**: the Anthropic dependency is a thin slab at the bottom of the stack — `claude-direct.ts` plus a handful of references from `run-bundle.ts` and `claude-tools.ts`. Above the transport line, everything is provider-agnostic.

---

## 2. Target abstraction

A `Provider` interface mapping the canonical request/response shape to/from each provider's native HTTP. One module per provider.

```ts
// src/kernel/providers/types.ts
export interface CanonicalRequest {
  model: string;
  systemPrompt: string;
  messages: Array<{ role: 'user' | 'assistant'; content: unknown }>;
  tools?: ToolDef[];
  maxTokens: number;
  thinkingBudget?: number;   // not all providers support
}

export interface CanonicalResponse {
  content: Array<TextBlock | ToolUseBlock>;  // unified shape
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' | string;
  usage: { inputTokens?: number; outputTokens?: number };
}

export interface Provider {
  name: 'anthropic' | 'openai' | 'ollama' | 'google' | string;
  invoke(apiKey: string, req: CanonicalRequest): Promise<CanonicalResponse>;
  // Capabilities — runRecipe consults these before passing optional fields.
  supportsTools: boolean;
  supportsThinking: boolean;
  supportsPromptCaching: boolean;
}
```

`run-bundle.ts` becomes:

```ts
import { dispatch } from './providers';

const data = await dispatch(provider, apiKey, canonicalReq);
// instead of: const data = await messagesApi(apiKey, body);
```

`dispatch` looks up the provider by name and invokes its `invoke()`.

Per-provider modules:

- `src/kernel/providers/anthropic.ts` — current `claude-direct.ts` rewritten to consume `CanonicalRequest`. Keeps the beta-header MCP-connector path as an extra method.
- `src/kernel/providers/openai.ts` — POST to `https://api.openai.com/v1/chat/completions`, map `system` to `messages[0]`, map `tools` to `functions`, map response `tool_calls` to canonical `tool_use` blocks. ~80 lines.
- `src/kernel/providers/ollama.ts` — same shape as OpenAI; endpoint defaults to `http://localhost:11434/v1/chat/completions` (configurable via setting). Tool support varies by model — `llama3.1+` and `mistral` have native tool calling; others fall back to text-mode. ~60 lines.
- `src/kernel/providers/google.ts` — POST to Generative Language API `v1beta/models/<model>:generateContent`. Map system into `systemInstruction`, map tools into `function_declarations`. ~80 lines. (Optional second-cut.)

---

## 3. Provider selection — by recipe and by setting

Two layers, same precedence chain as everything else:

**Recipe-level (per-call override).** Recipe digit `3: model` already names the model. Extend the parser to recognise a provider prefix:

| Model string | Provider | Native model name |
|---|---|---|
| `claude-…` | `anthropic` | as-is |
| `gpt-…` | `openai` | as-is |
| `gemini-…` | `google` | as-is |
| `ollama:llama3.1`, `ollama:mistral` | `ollama` | suffix after `ollama:` |
| `<provider>:<model>` (explicit) | `<provider>` | suffix |

No new recipe field needed; the model field is rich enough.

**User-level (default + endpoint override).** Settings reader resolves:

- `provider.default: "anthropic" | "openai" | "ollama" | …` — used when a recipe specifies a model without a provider hint.
- `provider.<name>.endpoint: "http://localhost:11434/v1"` — overrides the default endpoint per provider. Local LM users set ollama's endpoint here.
- `provider.<name>.api_key_setting: "session"` — where to source the API key from. Ollama needs none; the value `"session"` means "use the API key currently in the floating button's identity panel".

The button's identity panel grows a provider dropdown next to the API key field. Anonymous browse stays anonymous; authenticated users pick a provider and supply the matching key.

---

## 4. Tool-use shape across providers

The unified `tool_use` content block is what `run-bundle.ts` already expects. Per-provider mapping:

**Anthropic** (current): `{type: "tool_use", id, name, input}` and `{type: "tool_result", tool_use_id, content}`. Pass-through.

**OpenAI**: `{role: "assistant", tool_calls: [{id, type: "function", function: {name, arguments}}]}` and `{role: "tool", tool_call_id, content}`. Map both directions.

**Ollama** (model-dependent): `llama3.1+` and `mistral` use OpenAI-shape `tool_calls`. Others may emit JSON in text — fall back to a "no tool support" mode where the recipe runner detects this and degrades to single-shot. The `Provider.supportsTools` flag tells `runRecipe` what to do.

**Google**: `functionCall` and `functionResponse` content parts. Map both directions.

The mapping is mechanical per-provider — ~30 lines each.

---

## 5. Capabilities the recipe runner consults

Before assembling the canonical request, `runRecipe` reads `Provider.supports*` and skips fields the provider doesn't support:

- `thinkingBudget` → only Anthropic today. Other providers receive a request without `thinking`.
- `tools` → falls back to single-shot text mode if `!supportsTools` and the recipe expected tool use. Logged so the user knows their recipe is degraded.
- Prompt caching → Anthropic-only beta; the canonical request gains a `cacheBreakpoint?` field that's a no-op on other providers.

This is the spirit of the recipe runner — request what you want, the provider provides what it can, fall through gracefully.

---

## 6. Migration steps

Mechanical, ~half a day:

1. Create `src/kernel/providers/types.ts` with `CanonicalRequest`, `CanonicalResponse`, `Provider`.
2. Move `claude-direct.ts` body into `providers/anthropic.ts` consuming/producing canonical shapes. `claude-direct.ts` becomes a re-export shim or is deleted.
3. Add `dispatch(provider, apiKey, req)` in `providers/index.ts` — looks up by name.
4. `run-bundle.ts` and `claude-tools.ts` (the connector path) call `dispatch` instead of `messagesApi`.
5. Add `providers/openai.ts` and `providers/ollama.ts` (same shape; ~80 + ~60 lines).
6. Recipe runner: extend model-string parsing to extract `provider:model`. Default provider from settings.
7. Identity panel: add provider dropdown.
8. Settings reader: document `provider.default`, `provider.<name>.endpoint`.
9. Update `blocks/conventions.json` to document the provider settings convention.

Test plan: solo Anthropic call (parity with current); solo OpenAI call (gpt-4o); solo ollama call against `localhost:11434` with `llama3.1`. Tool-use loop on each provider with bsp-mcp tools. Local-LLM tool calls reach the bsp-mcp server (validates "local LM operates on the beach").

---

## 7. Open questions

- **Streaming.** `HANDOVER-streaming.md` deferred this for Anthropic. Each provider has its own SSE shape (Anthropic's `content_block_delta`, OpenAI's `delta.content`, ollama's plain JSONL). Solving once at the canonical-response layer means each provider's streaming maps to a unified `onTextDelta` callback. ~+30 lines per provider.
- **Identity propagation.** Today the user types their API key into the button. For ollama (no key) this is a confusing UX. Either dropdown-driven ("ollama → no key needed") or treat empty-key + ollama-provider as valid.
- **Cost telemetry.** The `logFilmstrip` call records token usage. Each provider reports usage differently (Anthropic in `usage`, OpenAI in `usage.prompt_tokens` / `completion_tokens`, ollama in `eval_count` / `prompt_eval_count`). Map to canonical `{inputTokens, outputTokens}`.
- **CORS.** `anthropic-dangerous-direct-browser-access` is Anthropic's "yes I know this exposes my key, do it anyway" flag. OpenAI requires a CORS-friendly path (their API does CORS by default; relays don't). Ollama on localhost is fine. Hosted ollama may need a relay.
- **MCP connector.** Anthropic's beta `mcp_servers` param is provider-specific. Other providers don't have an equivalent — tool use happens client-side in the runner regardless. The connector path stays Anthropic-only; that's fine, it was an optional optimisation.

---

## 8. What this doesn't change

- bsp-mcp substrate — provider-agnostic by design (any LLM with an MCP client can already speak to it).
- Federated beach contract — provider-agnostic.
- Recipe runner — already provider-agnostic above the transport.
- Conventions, settings, V/L/S surface — none of it cares about the LLM.

The whole stack is provider-ready EXCEPT the bottom transport slab. This spec turns that slab from a brick into a tile.

---

## 9. Why this is genuinely small

xstream's value is the substrate + the surface. The LLM is a participant, not a master. Switching LLMs is a transport-layer move that doesn't touch governance, faces, recipes, gathers, or the V/L/S loop. The spec above looks long because it enumerates every provider; the actual diff is `~400 lines added across 4-5 new files, ~30 lines changed in run-bundle.ts and claude-tools.ts`.

Once it ships, "use a local LM on the beach" is: install ollama, run `ollama pull llama3.1`, set `provider.default: ollama` in your shell:5, set the endpoint in your shell:5, refresh — same xstream, same recipes, same conventions, different model under the hood.
