/**
 * C2.6: doc-extract handler. Proves the entry-point rules (caller verified first, no service-role
 * client until the right is re-checked, no secret or bytes in a response), the format classification
 * and the deterministic extraction outcomes.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  classify,
  createDocExtractHandler,
  extractDocument,
  type CallerClientLike,
  type DocExtractDeps,
  type ServiceClientLike,
} from '../../supabase/functions/_shared/docExtractHandler';

interface Calls { rpc: [string, Record<string, unknown>?][]; downloads: string[]; writes: [string, Record<string, unknown>][]; }

function makeDeps(overrides: Partial<DocExtractDeps> = {}): {
  deps: DocExtractDeps; calls: Calls; getUser: ReturnType<typeof vi.fn>;
} {
  const calls: Calls = { rpc: [], downloads: [], writes: [] };
  const getUser = vi.fn(async () => ({ data: { user: { id: 'u1' } }, error: null }));
  const deps: DocExtractDeps = {
    callerClient: (authHeader: string): CallerClientLike => {
      expect(authHeader).toContain('Bearer ');
      return {
        auth: {
          getUser: getUser as unknown as CallerClientLike['auth']['getUser'],
        },
        rpc: async (fn, args) => {
          calls.rpc.push([fn, args]);
          if (fn === 'can_extract_document') return { data: true, error: null };
          return { data: null, error: null };
        },
      };
    },
    serviceClient: (): ServiceClientLike => ({
      rpc: async (fn, args) => {
        calls.writes.push([fn, args ?? {}]);
        if (fn === 'document_extraction_context') {
          return {
            data: [{ file_id: 'f1', org_id: 'o1', engagement_id: 'e1', filename: 'policy.docx', content_sha256: 'h' }],
            error: null,
          };
        }
        if (fn === 'document_extraction_complete') return { data: 'x1', error: null };
        return { data: null, error: null };
      },
      storage: {
        from: () => ({
          download: async (path: string) => {
            calls.downloads.push(path);
            return { data: new TextEncoder().encode('bytes'), error: null };
          },
        }),
      },
    }),
    bucket: 'evidence',
    parseDocx: async () => 'the document text',
    parseSheet: () => 'col\n1',
    pdfText: async () => ({ text: 'pdf words', pageCount: 2 }),
    ...overrides,
  };
  return { deps, calls, getUser };
}

function req(body: unknown, authHeader = 'Bearer token'): Request {
  return new Request('http://x/doc-extract', {
    method: 'POST',
    headers: { Authorization: authHeader },
    body: JSON.stringify(body),
  });
}

describe('C2.6 doc-extract: format classification', () => {
  it('classifies each supported format and the legacy/unknown cases', () => {
    expect(classify('a.DOCX')).toBe('docx');
    expect(classify('a.xlsx')).toBe('xlsx');
    expect(classify('a.csv')).toBe('csv');
    expect(classify('a.pdf')).toBe('pdf');
    expect(classify('a.doc')).toBe('legacy');
    expect(classify('a.ppt')).toBe('legacy');
    expect(classify('a.xls')).toBe('legacy');
    expect(classify('a.png')).toBe('unknown');
  });
});

describe('C2.6 doc-extract: pure extraction outcomes', () => {
  const deps = {
    parseDocx: async () => 'docx body',
    parseSheet: () => 'sheet body',
    pdfText: async () => ({ text: 'pdf body', pageCount: 3 }),
  };

  it('extracts DOCX, XLSX, CSV and a text PDF', async () => {
    expect((await extractDocument('docx', new Uint8Array(), deps)).status).toBe('done');
    expect((await extractDocument('xlsx', new Uint8Array(), deps)).status).toBe('done');
    expect((await extractDocument('csv', new Uint8Array(), deps)).status).toBe('done');
    const pdf = await extractDocument('pdf', new Uint8Array(), deps);
    expect(pdf.status).toBe('done');
    expect(pdf.pageCount).toBe(3);
  });

  it('records a scan with no text layer as unsupported, not failed', async () => {
    const r = await extractDocument('pdf', new Uint8Array(), { ...deps, pdfText: async () => ({ text: '', pageCount: 1 }) });
    expect(r.status).toBe('unsupported');
    expect(r.text).toBeNull();
  });

  it('stores a legacy binary format without extracting it (§20)', async () => {
    const r = await extractDocument('legacy', new Uint8Array(), deps);
    expect(r.status).toBe('legacy_not_extracted');
    expect(r.extractor).toBeNull();
  });

  it('records a parser throw as failed and invents no text', async () => {
    const r = await extractDocument('docx', new Uint8Array(), {
      ...deps, parseDocx: async () => { throw new Error('corrupt zip'); },
    });
    expect(r.status).toBe('failed');
    expect(r.text).toBeNull();
    expect(r.error).toContain('corrupt zip');
  });

  it('is deterministic: the same bytes and kind always give the same outcome', async () => {
    const a = await extractDocument('docx', new Uint8Array([1, 2]), deps);
    const b = await extractDocument('docx', new Uint8Array([1, 2]), deps);
    expect(a).toEqual(b);
  });
});

describe('C2.6 doc-extract: the request handler', () => {
  it('rejects a request with no session before anything else', async () => {
    const { deps, calls, getUser } = makeDeps();
    const res = await createDocExtractHandler(deps)(req({ fileId: 'f1' }, ''));
    expect(res.status).toBe(401);
    expect(getUser).not.toHaveBeenCalled();
    expect(calls.writes).toHaveLength(0);
  });

  it('verifies the caller before creating any service-role client', async () => {
    const order: string[] = [];
    const { deps } = makeDeps({
      callerClient: () => ({
        auth: { getUser: (async () => { order.push('getUser'); return { data: { user: { id: 'u1' } }, error: null }; }) as never },
        rpc: async () => ({ data: true, error: null }),
      }),
      serviceClient: () => {
        order.push('serviceClient');
        return { rpc: async () => ({ data: null, error: null }), storage: { from: () => ({ download: async () => ({ data: null, error: null }) }) } };
      },
    });
    await createDocExtractHandler(deps)(req({ fileId: 'f1' }));
    expect(order[0]).toBe('getUser');
    expect(order.indexOf('serviceClient')).toBeGreaterThan(0);
  });

  it('refuses a caller the database does not permit, without touching the service role', async () => {
    const { deps, calls } = makeDeps({
      callerClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: 'u1' } }, error: null }) }, rpc: async () => ({ data: false, error: null }) }),
    });
    const res = await createDocExtractHandler(deps)(req({ fileId: 'f1' }));
    expect(res.status).toBe(403);
    expect(calls.writes).toHaveLength(0);
  });

  it('extracts a permitted file and writes the outcome through the service-only RPC', async () => {
    const { deps, calls } = makeDeps();
    const res = await createDocExtractHandler(deps)(req({ fileId: 'f1' }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe('done');
    expect(calls.downloads[0]).toBe('o1/e1/policy.docx');
    const write = calls.writes.find(([fn]) => fn === 'document_extraction_complete');
    expect(write).toBeTruthy();
    expect(write![1].p_status).toBe('done');
  });

  it('the response body carries no secret, ciphertext or file bytes', async () => {
    const { deps } = makeDeps();
    const res = await createDocExtractHandler(deps)(req({ fileId: 'f1' }));
    const text = await res.text();
    expect(text).not.toMatch(/access_token|refresh_token|service_role|ciphertext|password/);
    expect(text).not.toContain('the document text');
  });

  it('rejects a non-POST request and a missing file id', async () => {
    const { deps } = makeDeps();
    const get = new Request('http://x/doc-extract', { method: 'GET', headers: { Authorization: 'Bearer t' } });
    expect((await createDocExtractHandler(deps)(get)).status).toBe(405);
    expect((await createDocExtractHandler(deps)(req({}))).status).toBe(400);
  });
});
