/**
 * C2.5: the archive-upload Edge Function verifies the caller before any service-role client exists,
 * uploads the exact canonical bytes, and lets the database decide whether the archive is done.
 *
 * The handler takes its dependencies injected, so each case drives the real handler with plain
 * objects. The two rules that matter most: a refusal must happen before serviceClient() is called,
 * and the hash sent for verification must be the hash of the bytes that were actually stored.
 */
import { describe, expect, it } from 'vitest';
import {
  createArchiveUploadHandler,
  sha256Hex,
  type ArchiveUploadDeps,
  type CallerClientLike,
  type DigestLike,
  type RpcResult,
  type Row,
  type ServiceClientLike,
  type StorageResult,
} from '../../supabase/functions/_shared/archiveUploadHandler';

const ORG_A = 'a0000000-0000-0000-0000-000000000001';
const JOB_A = 'a7000000-0000-4000-8000-000000000001';
const CANONICAL = '{"rows":[{"id":"1"}]}';

/** A digest that is a real SHA-256 of the bytes, so "the hash of what was stored" is meaningful. */
function nodeDigest(): DigestLike {
  return {
    subtle: {
      digestSync: (_algorithm: string, data: Uint8Array): Uint8Array => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { createHash } = require('node:crypto') as typeof import('node:crypto');
        return new Uint8Array(createHash('sha256').update(Buffer.from(data)).digest());
      },
    },
  };
}

interface Harness {
  deps: ArchiveUploadDeps;
  calls: string[];
  uploaded: { bucket: string; path: string; body: unknown }[];
  markArgs: Record<string, unknown> | null;
  setUser(user: { id: string } | null): void;
  setRpc(name: string, result: RpcResult): void;
  setUploadError(error: { message: string } | null): void;
  job: Row | null;
  canonical: string | null;
}

function harness(): Harness {
  let user: { id: string } | null = { id: '10000000-0000-0000-0000-0000000000a1' };
  const calls: string[] = [];
  const rpcs: Record<string, RpcResult> = {};
  const uploaded: { bucket: string; path: string; body: unknown }[] = [];
  let uploadError: { message: string } | null = null;
  const state: Harness = {
    deps: null as unknown as ArchiveUploadDeps,
    calls,
    uploaded,
    markArgs: null,
    job: { id: JOB_A, org_id: ORG_A, storage_path: `${ORG_A}/activity/2026.json`, content_hash: 'x', status: 'pending' },
    canonical: CANONICAL,
    setUser: (u) => { user = u; },
    setRpc: (name, result) => { rpcs[name] = result; },
    setUploadError: (e) => { uploadError = e; },
  };

  const caller: CallerClientLike = {
    auth: {
      getUser: async () => { calls.push('getUser'); return { data: { user }, error: null }; },
    },
    rpc: async (fn) => {
      calls.push(`caller.rpc:${fn}`);
      if (fn === 'can_upload_archive') return rpcs[fn] ?? { data: true, error: null };
      return rpcs[fn] ?? { data: null, error: null };
    },
  };

  const service: ServiceClientLike = {
    rpc: async (fn, args) => {
      calls.push(`service.rpc:${fn}`);
      if (fn === 'archive_job_mark_uploaded') state.markArgs = args ?? null;
      if (fn === 'archive_job_for_upload') return rpcs[fn] ?? { data: state.job, error: null };
      if (fn === 'archive_job_canonical') return rpcs[fn] ?? { data: state.canonical, error: null };
      return rpcs[fn] ?? { data: 'done', error: null };
    },
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string, body: unknown): Promise<StorageResult> => {
          calls.push('storage.upload');
          uploaded.push({ bucket, path, body });
          return { data: { path }, error: uploadError };
        },
      }),
    },
  };

  state.deps = {
    callerClient: () => { calls.push('callerClient'); return caller; },
    serviceClient: () => { calls.push('serviceClient'); return service; },
    crypto: nodeDigest(),
    encoder: new TextEncoder(),
    bucket: 'archives',
  };
  return state;
}

function post(body: unknown, auth = 'Bearer token'): Request {
  return new Request('https://example.test/archive-upload', {
    method: 'POST',
    headers: auth ? { Authorization: auth, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('archive-upload handler', () => {
  it('refuses an unauthenticated caller before any service-role client exists', async () => {
    const h = harness();
    const res = await createArchiveUploadHandler(h.deps)(post({ archiveId: JOB_A }, ''));
    expect(res.status).toBe(401);
    expect(h.calls).not.toContain('serviceClient');
    expect(h.calls).not.toContain('storage.upload');
  });

  it('refuses a caller the database says may not upload this archive, before serviceClient', async () => {
    const h = harness();
    h.setRpc('can_upload_archive', { data: false, error: null });
    const res = await createArchiveUploadHandler(h.deps)(post({ archiveId: JOB_A }));
    expect(res.status).toBe(403);
    expect(h.calls).not.toContain('serviceClient');
    expect(h.calls).not.toContain('storage.upload');
  });

  it('verifies the caller before the authority check', async () => {
    const h = harness();
    await createArchiveUploadHandler(h.deps)(post({ archiveId: JOB_A }));
    expect(h.calls.indexOf('getUser')).toBeLessThan(h.calls.indexOf('caller.rpc:can_upload_archive'));
  });

  it('uploads the canonical bytes and sends the hash of exactly those bytes', async () => {
    const h = harness();
    const res = await createArchiveUploadHandler(h.deps)(post({ archiveId: JOB_A }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.status).toBe('done');

    expect(h.uploaded).toHaveLength(1);
    const stored = h.uploaded[0].body as Uint8Array;
    expect(new TextDecoder().decode(stored)).toBe(CANONICAL);

    const expected = sha256Hex(new TextEncoder().encode(CANONICAL), nodeDigest());
    expect(h.markArgs?.p_sha256).toBe(expected);
    expect(h.markArgs?.p_bytes).toBe(stored.length);
  });

  it('does not mark the job done when the database refuses the hash', async () => {
    const h = harness();
    h.setRpc('archive_job_mark_uploaded', { data: 'failed', error: null });
    const res = await createArchiveUploadHandler(h.deps)(post({ archiveId: JOB_A }));
    expect(res.status).toBe(409);
    expect(((await res.json()) as Record<string, unknown>).ok).toBe(false);
  });

  it('reports a storage failure and never marks the job done', async () => {
    const h = harness();
    h.setUploadError({ message: 'bucket unavailable' });
    const res = await createArchiveUploadHandler(h.deps)(post({ archiveId: JOB_A }));
    expect(res.status).toBe(500);
    expect(h.calls).not.toContain('service.rpc:archive_job_mark_uploaded');
  });

  it('returns no token, ciphertext or secret in any response body', async () => {
    const h = harness();
    const ok = await createArchiveUploadHandler(h.deps)(post({ archiveId: JOB_A }));
    const text = await ok.text();
    for (const banned of ['token', 'secret', 'ciphertext', 'access_token', 'refresh_token']) {
      expect(text.toLowerCase()).not.toContain(banned);
    }
  });

  it('rejects a non-POST method', async () => {
    const h = harness();
    const req = new Request('https://example.test/archive-upload', { method: 'GET' });
    const res = await createArchiveUploadHandler(h.deps)(req);
    expect(res.status).toBe(405);
  });

  it('requires an archive id', async () => {
    const h = harness();
    const res = await createArchiveUploadHandler(h.deps)(post({}));
    expect(res.status).toBe(400);
    expect(h.calls).not.toContain('serviceClient');
  });
});
