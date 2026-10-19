import { describe, expect, it } from 'vitest';
import {
  checkEndpoint, isDeniedEndpoint, isPrivateHost, isPrivateIpv4, isPrivateIpv6,
  VENDOR_ENDPOINT_MESSAGE, PRIVATE_ENDPOINT_MESSAGE,
} from '../../supabase/functions/_shared/aiSsrf';

const DENY = ['api.openai.com', '.openai.azure.com', 'bedrock-runtime.', 'api.anthropic.com'];

describe('isPrivateIpv4', () => {
  it.each(['127.0.0.1', '10.0.0.5', '172.16.0.1', '172.31.255.255', '192.168.1.1',
    '169.254.169.254', '0.0.0.0', '100.64.0.1'])('flags %s as private', (ip) => {
    expect(isPrivateIpv4(ip)).toBe(true);
  });
  it.each(['8.8.8.8', '172.32.0.1', '172.15.0.1', '11.0.0.1', '1.1.1.1', '100.128.0.1'])(
    'allows %s', (ip) => { expect(isPrivateIpv4(ip)).toBe(false); });
});

describe('isPrivateIpv6', () => {
  it.each(['::1', '::', 'fe80::1', 'fc00::1', 'fd12::1', '::ffff:127.0.0.1'])('flags %s', (ip) => {
    expect(isPrivateIpv6(ip)).toBe(true);
  });
  it('allows a public IPv6', () => { expect(isPrivateIpv6('2606:4700::1111')).toBe(false); });
});

describe('isPrivateHost', () => {
  it('flags localhost and metadata names', () => {
    expect(isPrivateHost('localhost')).toBe(true);
    expect(isPrivateHost('app.localhost')).toBe(true);
    expect(isPrivateHost('metadata.google.internal')).toBe(true);
  });
  it('allows a public name and IP', () => {
    expect(isPrivateHost('ollama.example.com')).toBe(false);
    expect(isPrivateHost('8.8.8.8')).toBe(false);
  });
});

describe('isDeniedEndpoint', () => {
  it('matches a vendor host by substring', () => {
    expect(isDeniedEndpoint('https://api.openai.com/v1', DENY)).toBe(true);
    expect(isDeniedEndpoint('https://foo.openai.azure.com/x', DENY)).toBe(true);
    expect(isDeniedEndpoint('https://bedrock-runtime.us-east-1.amazonaws.com', DENY)).toBe(true);
  });
  it('allows a private Ollama host', () => {
    expect(isDeniedEndpoint('http://10.0.0.5:11434', DENY)).toBe(false);
  });
});

describe('checkEndpoint', () => {
  it('refuses a vendor host with the fixed message', () => {
    const r = checkEndpoint('https://api.openai.com/v1', 'server', DENY);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe(VENDOR_ENDPOINT_MESSAGE);
  });
  it('refuses localhost and RFC1918 in server mode', () => {
    expect(checkEndpoint('http://localhost:11434', 'server', DENY).ok).toBe(false);
    expect(checkEndpoint('http://10.0.0.5:11434', 'server', DENY).reason).toBe(PRIVATE_ENDPOINT_MESSAGE);
    expect(checkEndpoint('http://192.168.0.1:11434', 'server', DENY).ok).toBe(false);
    expect(checkEndpoint('http://169.254.169.254/latest', 'server', DENY).ok).toBe(false);
  });
  it('refuses plain http in server mode even for a public host', () => {
    expect(checkEndpoint('http://ollama.example.com', 'server', DENY).ok).toBe(false);
  });
  it('refuses a name that resolves to a private address', () => {
    expect(checkEndpoint('https://ollama.example.com', 'server', DENY, '10.0.0.9').ok).toBe(false);
  });
  it('allows a public https host in server mode', () => {
    expect(checkEndpoint('https://ollama.example.com', 'server', DENY).ok).toBe(true);
  });
  it('allows localhost in browser mode', () => {
    expect(checkEndpoint('http://localhost:11434', 'browser', DENY).ok).toBe(true);
  });
  it('still refuses a vendor host in browser mode', () => {
    expect(checkEndpoint('https://api.openai.com/v1', 'browser', DENY).ok).toBe(false);
  });
  it('refuses an invalid URL', () => {
    expect(checkEndpoint('not a url', 'server', DENY).ok).toBe(false);
  });
});
