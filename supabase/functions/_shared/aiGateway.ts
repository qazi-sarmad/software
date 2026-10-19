/**
 * The AI gateway call loop (F8, L1, L2). The one place a prompt is sent to a self-hosted
 * Ollama-compatible endpoint and a response comes back.
 *
 * Pure and injectable: the fetch and the crypto are passed in, so the whole loop (prompt, call,
 * hashes, number guard, flags) is unit-tested without a network and without a Deno runtime. No
 * randomness and no AI touch a test result, a score or a gate (L1); this module only drafts text a
 * user may accept, and it records the call for the ledger.
 *
 * Laws that shape this file:
 *   - L2: only a tenant-controlled, self-hosted endpoint is ever called. The caller checks the URL
 *     with checkEndpoint before reaching here; a vendor host is refused.
 *   - F8: every call yields a prompt hash, a response hash and the flagged unverified figures; the
 *     ledger keeps the hashes forever, the text only for the retention window.
 */

import { type FetchLike, redact } from './emailAdapters.ts';
import { findUnverifiedFigures, type FlaggedFigure } from './aiNumberGuard.ts';

/** Minimal WebCrypto surface the hashing needs, injected so the module runs under Node too. */
export interface HashCrypto {
  subtle: {
    digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer>;
  };
}

export interface OllamaParams {
  temperature: number;
  topP: number;
  maxTokens?: number | null;
}

export interface GatewayInput {
  baseUrl: string;
  model: string;
  prompt: string;
  params: OllamaParams;
  allowedNumbers: string[];
  /** A bearer token, when the tenant set one and the admin allowed it for this access mode. */
  token?: string | null;
}

export interface GatewayOutcome {
  ok: boolean;
  text?: string;
  promptHash?: string;
  responseHash?: string;
  flags?: FlaggedFigure[];
  error?: string;
}

/** Hex SHA-256 of a UTF-8 string, using the injected crypto. */
export async function sha256Hex(text: string, crypto: HashCrypto): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The Ollama chat request: POST {base}/api/chat, non-streaming, so it finishes inside the limit. */
export function buildChatRequest(input: GatewayInput): { url: string; init: { headers: Record<string, string>; body: string } } {
  const base = input.baseUrl.replace(/\/+$/, '');
  const options: Record<string, unknown> = {
    temperature: input.params.temperature, top_p: input.params.topP,
  };
  if (input.params.maxTokens) options.num_predict = input.params.maxTokens;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (input.token) headers.Authorization = `Bearer ${input.token}`;
  return {
    url: `${base}/api/chat`,
    init: {
      headers,
      body: JSON.stringify({ model: input.model, stream: false, options, messages: [{ role: 'user', content: input.prompt }] }),
    },
  };
}

/** The Test-button request: GET {base}/api/tags, which lists the installed models (F8). */
export function buildTagsRequest(baseUrl: string, token?: string | null): { url: string; init: { headers: Record<string, string> } } {
  const base = baseUrl.replace(/\/+$/, '');
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  return { url: `${base}/api/tags`, init: { headers } };
}

/** The installed model names in an /api/tags body, or an empty list when it cannot be read. */
export function parseTagsModels(body: string): string[] {
  try {
    const parsed = JSON.parse(body) as { models?: { name?: string }[] };
    return (parsed.models ?? []).map((m) => String(m.name ?? '')).filter((n) => n.length > 0);
  } catch {
    return [];
  }
}

/** The assistant text in an Ollama /api/chat body, or null when it cannot be read. */
export function parseChatText(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { message?: { content?: string }; response?: string };
    const text = parsed.message?.content ?? parsed.response;
    return typeof text === 'string' ? text : null;
  } catch {
    return null;
  }
}

/**
 * Send one prompt and return the drafted text, the two hashes and the flagged figures. A no-AI and
 * no-network function except for the injected fetch. The caller has already checked the endpoint.
 */
export async function runGatewayCall(
  input: GatewayInput, fetchImpl: FetchLike, crypto: HashCrypto
): Promise<GatewayOutcome> {
  const promptHash = await sha256Hex(input.prompt, crypto);
  const req = buildChatRequest(input);
  let response: { status: number; text: () => Promise<string> };
  try {
    response = await fetchImpl(req.url, { headers: req.init.headers, body: req.init.body });
  } catch (e) {
    return { ok: false, error: `The model endpoint could not be reached: ${redact(e instanceof Error ? e.message : String(e))}` };
  }
  const body = await response.text();
  if (response.status < 200 || response.status >= 300) {
    return { ok: false, error: `The model endpoint answered ${response.status}: ${redact(body).slice(0, 200)}` };
  }
  const text = parseChatText(body);
  if (text === null) {
    return { ok: false, error: 'The model endpoint returned a response that could not be read.' };
  }
  const flags = findUnverifiedFigures(text, input.allowedNumbers);
  const responseHash = await sha256Hex(text, crypto);
  return { ok: true, text, promptHash, responseHash, flags };
}

/** Probe an endpoint's /api/tags and report whether the assigned model is installed (F8 Test button). */
export async function testEndpoint(
  baseUrl: string, model: string, fetchImpl: FetchLike, token?: string | null
): Promise<{ ok: boolean; models?: string[]; modelInstalled?: boolean; error?: string; roundTripMs?: number }> {
  const req = buildTagsRequest(baseUrl, token);
  const started = Date.now();
  let response: { status: number; text: () => Promise<string> };
  try {
    response = await fetchImpl(req.url, { headers: req.init.headers });
  } catch (e) {
    return { ok: false, error: `The endpoint could not be reached: ${redact(e instanceof Error ? e.message : String(e))}` };
  }
  const roundTripMs = Date.now() - started;
  const body = await response.text();
  if (response.status < 200 || response.status >= 300) {
    return { ok: false, error: `The endpoint answered ${response.status}: ${redact(body).slice(0, 200)}` };
  }
  const models = parseTagsModels(body);
  const modelInstalled = models.some((m) => m === model || m.startsWith(`${model}:`));
  return { ok: true, models, modelInstalled, roundTripMs };
}
