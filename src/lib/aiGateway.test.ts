import { describe, expect, it } from 'vitest';
import {
  buildChatRequest, buildTagsRequest, parseChatText, parseTagsModels, runGatewayCall, sha256Hex,
  testEndpoint, type HashCrypto, type GatewayInput,
} from '../../supabase/functions/_shared/aiGateway';
import { type FetchLike } from '../../supabase/functions/_shared/emailAdapters';

const cryptoImpl = crypto as unknown as HashCrypto;

function fakeFetch(status: number, body = '{}') {
  const calls: { url: string; init?: { headers?: Record<string, string>; body?: string } }[] = [];
  const fn: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return { status, text: async () => body };
  };
  return { fn, calls };
}

const baseInput: GatewayInput = {
  baseUrl: 'https://ollama.internal.example', model: 'llama3.1:8b', prompt: 'Draft an observation.',
  params: { temperature: 0.2, topP: 0.9, maxTokens: 600 }, allowedNumbers: ['42'],
};

const chatBody = JSON.stringify({ message: { content: 'There were 42 findings and 7 exceptions.' } });

describe('ai gateway (M-4a, F8)', () => {
  it('hashes a prompt deterministically as hex sha-256', async () => {
    const a = await sha256Hex('hello', cryptoImpl);
    const b = await sha256Hex('hello', cryptoImpl);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(await sha256Hex('hello!', cryptoImpl));
  });

  it('builds a non-streaming chat request with the parameters and the token header', () => {
    const { url, init } = buildChatRequest({ ...baseInput, token: 'tok-1' });
    expect(url).toBe('https://ollama.internal.example/api/chat');
    expect(init.headers.Authorization).toBe('Bearer tok-1');
    const body = JSON.parse(init.body);
    expect(body.stream).toBe(false);
    expect(body.model).toBe('llama3.1:8b');
    expect(body.options).toEqual({ temperature: 0.2, top_p: 0.9, num_predict: 600 });
  });

  it('omits the token header when none is set', () => {
    const { init } = buildChatRequest(baseInput);
    expect(init.headers.Authorization).toBeUndefined();
  });

  it('strips a trailing slash from the base URL', () => {
    expect(buildChatRequest({ ...baseInput, baseUrl: 'https://x.example/' }).url)
      .toBe('https://x.example/api/chat');
    expect(buildTagsRequest('https://x.example/').url).toBe('https://x.example/api/tags');
  });

  it('parses the installed models from an /api/tags body', () => {
    expect(parseTagsModels(JSON.stringify({ models: [{ name: 'a' }, { name: 'b:latest' }] })))
      .toEqual(['a', 'b:latest']);
    expect(parseTagsModels('not json')).toEqual([]);
  });

  it('parses the assistant text from a chat body, preferring message.content', () => {
    expect(parseChatText(chatBody)).toBe('There were 42 findings and 7 exceptions.');
    expect(parseChatText(JSON.stringify({ response: 'legacy' }))).toBe('legacy');
    expect(parseChatText('nope')).toBeNull();
  });

  it('returns the text, both hashes and the unverified figures', async () => {
    const { fn } = fakeFetch(200, chatBody);
    const out = await runGatewayCall(baseInput, fn, cryptoImpl);
    expect(out.ok).toBe(true);
    expect(out.text).toBe('There were 42 findings and 7 exceptions.');
    expect(out.promptHash).toMatch(/^[0-9a-f]{64}$/);
    expect(out.responseHash).toMatch(/^[0-9a-f]{64}$/);
    // 42 is allowed; 7 is not, so it is flagged.
    expect((out.flags ?? []).map((f) => f.token)).toEqual(['7']);
  });

  it('flags nothing when every figure is in the allow-list', async () => {
    const { fn } = fakeFetch(200, JSON.stringify({ message: { content: 'Only 42 and 7.' } }));
    const out = await runGatewayCall({ ...baseInput, allowedNumbers: ['42', '7'] }, fn, cryptoImpl);
    expect(out.flags).toEqual([]);
  });

  it('reports a non-2xx endpoint answer as an error, redacted', async () => {
    const { fn } = fakeFetch(500, 'token=supersecretvalue blew up');
    const out = await runGatewayCall(baseInput, fn, cryptoImpl);
    expect(out.ok).toBe(false);
    expect(out.error).toContain('500');
    expect(out.error).not.toContain('supersecretvalue');
  });

  it('reports an unreachable endpoint as an error', async () => {
    const fn: FetchLike = async () => { throw new Error('network down'); };
    const out = await runGatewayCall(baseInput, fn, cryptoImpl);
    expect(out.ok).toBe(false);
    expect(out.error).toContain('could not be reached');
  });

  it('reports an unreadable body as an error', async () => {
    const { fn } = fakeFetch(200, 'not json');
    const out = await runGatewayCall(baseInput, fn, cryptoImpl);
    expect(out.ok).toBe(false);
    expect(out.error).toContain('could not be read');
  });

  it('the probe reports whether the assigned model is installed and the round-trip time', async () => {
    const { fn, calls } = fakeFetch(200, JSON.stringify({ models: [{ name: 'llama3.1:8b' }, { name: 'qwen2:7b' }] }));
    const out = await testEndpoint('https://ollama.internal.example', 'llama3.1:8b', fn);
    expect(out.ok).toBe(true);
    expect(out.modelInstalled).toBe(true);
    expect(typeof out.roundTripMs).toBe('number');
    expect(calls[0].url).toBe('https://ollama.internal.example/api/tags');
  });

  it('the probe matches a model with a tag suffix and warns when it is absent', async () => {
    const { fn } = fakeFetch(200, JSON.stringify({ models: [{ name: 'llama3.1:8b' }] }));
    expect((await testEndpoint('https://x.example', 'llama3.1', fn)).modelInstalled).toBe(true);
    const { fn: fn2 } = fakeFetch(200, JSON.stringify({ models: [{ name: 'other' }] }));
    expect((await testEndpoint('https://x.example', 'llama3.1', fn2)).modelInstalled).toBe(false);
  });

  it('the probe passes the token header when one is set', async () => {
    const { fn, calls } = fakeFetch(200, '{}');
    await testEndpoint('https://x.example', 'm', fn, 'tok-9');
    expect(calls[0].init?.headers?.Authorization).toBe('Bearer tok-9');
  });
});
