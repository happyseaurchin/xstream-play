/**
 * mcp-client.ts — minimal MCP-over-HTTP client for the bsp-mcp deployment.
 *
 * Speaks the streamable-HTTP transport. Handshake:
 *   1. POST initialize          → returns mcp-session-id in response header
 *   2. POST notifications/initialized (no response)
 *   3. POST tools/call          → invokes a primitive
 *
 * CORS: bsp.hermitcrab.me explicitly allows any origin and exposes
 * mcp-session-id via Access-Control-Expose-Headers, so the browser path
 * works directly.
 *
 * Used by bsp-client to invoke the five non-geometric primitives
 * (pscale_register, pscale_create_collective, pscale_grain_reach,
 * pscale_key_publish, pscale_verify_rider). bsp() reads/writes still
 * go via the federated / commons paths — those are working and faster.
 */

const MCP_URL = 'https://bsp.hermitcrab.me/mcp/v1';
const PROTOCOL_VERSION = '2024-11-05';

interface JsonRpcResponse<T = unknown> {
  jsonrpc: '2.0';
  id?: number | string | null;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
}

export interface McpToolContent {
  type: string;
  text?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [k: string]: any;
}

export interface McpToolResult {
  content?: McpToolContent[];
  isError?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  structuredContent?: any;
}

let sessionId: string | null = null;
let initPromise: Promise<void> | null = null;
let nextId = 1;

async function postRpc(body: object, includeSession: boolean): Promise<Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  };
  if (includeSession && sessionId) headers['mcp-session-id'] = sessionId;
  return fetch(MCP_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

async function readBody<T = unknown>(res: Response): Promise<JsonRpcResponse<T>> {
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('text/event-stream')) {
    const text = await res.text();
    // SSE frames separated by blank lines. Each frame may have multiple
    // "data:" lines that concatenate into a single JSON-RPC message.
    for (const frame of text.split(/\r?\n\r?\n/)) {
      const dataLines = frame
        .split(/\r?\n/)
        .filter(l => l.startsWith('data:'))
        .map(l => l.slice(5).trimStart());
      if (dataLines.length === 0) continue;
      try {
        return JSON.parse(dataLines.join('\n')) as JsonRpcResponse<T>;
      } catch {
        // skip malformed frame
      }
    }
    throw new Error(`MCP: no parseable JSON in SSE response`);
  }
  return await res.json() as JsonRpcResponse<T>;
}

async function ensureInitialized(): Promise<void> {
  if (sessionId) return;
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const res = await postRpc({
      jsonrpc: '2.0',
      id: nextId++,
      method: 'initialize',
      params: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'xstream-play', version: '0.2' },
      },
    }, false);
    if (!res.ok) throw new Error(`MCP initialize failed: HTTP ${res.status}`);
    sessionId = res.headers.get('mcp-session-id');
    await readBody(res); // consume body
    if (!sessionId) throw new Error('MCP server did not return mcp-session-id');
    // Per spec, send notifications/initialized after the initialize round-trip.
    // No response expected; just informs the server we're ready.
    await postRpc({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
      params: {},
    }, true).catch(() => { /* server may close the response; that's fine */ });
  })().catch(e => {
    initPromise = null;
    sessionId = null;
    throw e;
  });
  return initPromise;
}

export async function mcpCallTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
  await ensureInitialized();
  const res = await postRpc({
    jsonrpc: '2.0',
    id: nextId++,
    method: 'tools/call',
    params: { name, arguments: args },
  }, true);
  if (!res.ok) {
    // 404 with "Unknown session" → server rotated; reset and retry once.
    if (res.status === 404) {
      sessionId = null;
      initPromise = null;
      return mcpCallTool(name, args);
    }
    throw new Error(`MCP ${name}: HTTP ${res.status}`);
  }
  const json = await readBody<McpToolResult>(res);
  if (json.error) throw new Error(`MCP ${name}: ${json.error.message}`);
  if (json.result === undefined) throw new Error(`MCP ${name}: empty result`);
  return json.result;
}

/** Best-effort extraction of the human-readable text from a tool result. */
export function mcpExtractText(result: McpToolResult): string {
  if (!result.content) return '';
  return result.content
    .filter(c => c.type === 'text' && typeof c.text === 'string')
    .map(c => c.text as string)
    .join('\n');
}

/** Reset the cached session — forces re-handshake on next call. */
export function resetMcpSession(): void {
  sessionId = null;
  initPromise = null;
}
