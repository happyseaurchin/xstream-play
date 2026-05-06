# HANDOVER — Soft-LLM response streaming (deferred)

**Status**: deferred 2026-05-02 — focus on V/L/S pipeline behavior first.
**Architecture verdict**: streaming does NOT interfere with pscale. Vapour is out-of-band by protocol (`docs/protocol-xstream-frame.md` §3.1, §7.3). The substrate writes (liquid + solid) happen at commit, unchanged. Streaming is a render-cadence change, not an architecture change. Can be added at any time without breaking anything.

## What it adds

Soft-LLM ⌘↵ response appears character-by-character in the soft-response card instead of arriving all-at-once after Claude finishes generating. Optional further: broadcast deltas to the same Supabase realtime channel as keystroke vapour so co-present peers watch the soft-LLM compose its reply (the "weft is in the vapour with us" affordance).

## Files / shape of the change

All optional — every existing caller works unchanged when `onTextDelta` is omitted.

1. **`src/kernel/claude-direct.ts`** — add `messagesApiStream(apiKey, body, onTextDelta?, extraHeaders?)`. Posts with `stream: true`, parses Anthropic's SSE stream, accumulates `text` and `tool_use` content blocks, fires `onTextDelta(delta)` per `text_delta` event. Returns the same `MessagesResponse` shape as the non-streaming variant. ~80 lines. SSE event types handled: `message_start`, `content_block_start`, `content_block_delta` (`text_delta` + `input_json_delta`), `content_block_stop`, `message_delta` (stop_reason, usage), `message_stop`.

2. **`src/kernel/run-bundle.ts`** — add `onTextDelta?: (delta: string) => void` to `BundleSpec`. Inside the turn loop, dispatch to `messagesApiStream` when `spec.onTextDelta` is provided, otherwise to `messagesApi` (current path). Pass-through. ~6 lines.

3. **`src/kernel/claude-tools.ts`** — add `onTextDelta` to `SoftLLMOptions` and `ConnectorOptions`. Pass through to `runBundle` (in-client loop) and to `messagesApiStream` (connector path — same Anthropic endpoint, same SSE shape; pass `extraHeaders: { 'anthropic-beta': 'mcp-client-2025-04-04' }` and `mcp_servers` in the body). ~6 lines.

4. **`src/components/Column.tsx`** — in `handleQuery`, add an `onTextDelta` callback that incrementally appends to `softResponse.text`:
   ```ts
   onTextDelta: (delta) => setSoftResponse(prev =>
     prev ? { ...prev, text: prev.text + delta } : {
       id: Date.now().toString(), originalInput: text,
       text: delta, softType: 'refine', face, frameId: null,
     }
   )
   ```
   Setting `setSoftResponse(null)` before the call still applies; the first delta creates the card. ~5 lines.

## Optional further (Option B — peer broadcast)

In the same `onTextDelta` callback, also push the running text through `vapourChannelRef.current?.broadcast(currentText)` so co-present peers see the soft-LLM compose live. ~5 lines extra. Probably wants a per-face toggle in shell:1.\<digit\>.9 metadata (e.g. `broadcast_soft: true|false`) — Designer face wants false (config noise), Character face wants true (social affordance).

## What was reverted

The first attempt added all of the above plus the SSE parser; reverted at user direction so we focus on V/L/S behavior testing first. Build was clean, paths were typed, but no point shipping the polish before the substrate behavior is verified.

## When to come back

After the V/L/S pipelines are confirmed working across the four faces (character / author / designer / observer × beach / in-frame). Streaming is the right next polish move at that point — it makes the soft-LLM feel present, which matters once weft is a genuine beach citizen.
