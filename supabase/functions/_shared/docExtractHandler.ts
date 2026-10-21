/**
 * doc-extract (C2.6): real text extraction for evidence files (spec §13.1, §20).
 *
 * The 0035 `request_extraction` was a stub: it wrote a 'pending' row and nothing ever filled it. A
 * browser cannot extract text safely (no reliable DOCX/XLSX/PDF parsing, and vendor-hosted services
 * are excluded by L2), so extraction happens here, subject to the same rules as every other Edge
 * Function: the caller is verified first, the caller's own right is re-checked by the database, and
 * the text is written through a service-role-only RPC so no client can write extracted text directly.
 *
 * Format handling (§20):
 *   - DOCX  -> mammoth (text; the same library the import paths use).
 *   - XLSX/CSV -> the vendored SheetJS parser (already a dependency).
 *   - PDF   -> a text layer is taken by a permissive Deno-compatible parser injected as `pdfText`;
 *             a PDF with no text layer is 'unsupported', not an error (§20 permits this).
 *   - .doc/.ppt/.xls -> stored as evidence and NOT extracted: 'legacy_not_extracted'.
 *   - Everything else -> stored, not extracted: 'legacy_not_extracted'.
 *
 * Determinism (L1): extraction is a pure function of the file bytes. There is no randomness and no
 * model. A failure never invents text; it records the reason.
 */

export interface Row { [key: string]: unknown; }
export interface RpcError { message: string }
export interface RpcResult { data: unknown; error: RpcError | null; }
export interface StorageDownloadResult { data: unknown; error: RpcError | null; }

export interface CallerClientLike {
  auth: { getUser(): Promise<{ data: { user: { id: string } | null } | null; error: unknown }> };
  rpc(fn: string, args?: Record<string, unknown>): Promise<RpcResult>;
}

export interface ServiceClientLike {
  rpc(fn: string, args?: Record<string, unknown>): Promise<RpcResult>;
  storage: {
    from(bucket: string): {
      download(path: string): Promise<StorageDownloadResult>;
    };
  };
}

/** A parseable format, or the explicit "do not extract" outcome. */
export type DocKind = 'docx' | 'xlsx' | 'csv' | 'pdf' | 'legacy' | 'unknown';

/** The extraction statuses the database accepts (mirrors 0078's check constraint). */
export type ExtractionStatus = 'done' | 'failed' | 'unsupported' | 'legacy_not_extracted';

export interface ExtractedDoc {
  status: ExtractionStatus;
  text: string | null;
  pageCount: number | null;
  extractor: string | null;
  error: string | null;
}

/** The pieces of a PDF parse this module needs; the real parser is injected and never invented. */
export interface PdfTextResult {
  text: string;
  pageCount: number;
}

export interface DocExtractDeps {
  callerClient(authHeader: string): CallerClientLike;
  serviceClient(): ServiceClientLike;
  bucket: string;
  /** Parse a DOCX's raw bytes into plain text (or throw/text) — mammoth in production. */
  parseDocx(bytes: Uint8Array): Promise<string>;
  /** Parse XLSX/CSV bytes into a text representation — the vendored SheetJS parser in production. */
  parseSheet(bytes: Uint8Array, kind: 'xlsx' | 'csv'): string | Promise<string>;
  /** Parse a PDF's text layer; returns empty text when there is none. */
  pdfText(bytes: Uint8Array): Promise<PdfTextResult>;
}

export interface DocExtractBody {
  fileId?: string | null;
}

const LEGACY_EXTENSIONS = ['.doc', '.ppt', '.xls'];

/** Decide the handling from the file's own name. Extension only, as §20 describes the format list. */
export function classify(filename: string): DocKind {
  const lower = (filename ?? '').toLowerCase();
  if (lower.endsWith('.docx')) return 'docx';
  if (lower.endsWith('.xlsx')) return 'xlsx';
  if (lower.endsWith('.csv')) return 'csv';
  if (lower.endsWith('.pdf')) return 'pdf';
  if (LEGACY_EXTENSIONS.some((e) => lower.endsWith(e))) return 'legacy';
  return 'unknown';
}

/**
 * The pure extraction: given the bytes and the file's kind, produce the outcome. Kept separate from
 * the request handling so it can be exercised with fixtures and is obviously deterministic.
 */
export async function extractDocument(
  kind: DocKind, bytes: Uint8Array, deps: Pick<DocExtractDeps, 'parseDocx' | 'parseSheet' | 'pdfText'>,
): Promise<ExtractedDoc> {
  try {
    if (kind === 'docx') {
      const text = await deps.parseDocx(bytes);
      return { status: 'done', text, pageCount: null, extractor: 'mammoth', error: null };
    }
    if (kind === 'xlsx' || kind === 'csv') {
      const text = await deps.parseSheet(bytes, kind);
      return { status: 'done', text, pageCount: null, extractor: 'sheetjs', error: null };
    }
    if (kind === 'pdf') {
      const parsed = await deps.pdfText(bytes);
      if (!parsed.text || parsed.text.trim().length === 0) {
        // §20: a scanned PDF is stored as evidence; there is nothing to extract. Not an error.
        return {
          status: 'unsupported', text: null, pageCount: parsed.pageCount || null,
          extractor: 'pdf', error: 'no text layer; the file is a scan',
        };
      }
      return {
        status: 'done', text: parsed.text, pageCount: parsed.pageCount || null,
        extractor: 'pdf', error: null,
      };
    }
    if (kind === 'legacy') {
      return {
        status: 'legacy_not_extracted', text: null, pageCount: null, extractor: null,
        error: 'legacy binary format: stored as evidence, not extracted (§20)',
      };
    }
    return {
      status: 'legacy_not_extracted', text: null, pageCount: null, extractor: null,
      error: 'format not extracted: stored as evidence',
    };
  } catch (e) {
    return {
      status: 'failed', text: null, pageCount: null, extractor: null,
      error: e instanceof Error ? e.message : 'extraction failed',
    };
  }
}

export function createDocExtractHandler(deps: DocExtractDeps) {
  return async function handle(req: Request): Promise<Response> {
    if (req.method !== 'POST') {
      return Response.json({ ok: false, reason: 'method not allowed' }, { status: 405 });
    }
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader.startsWith('Bearer ')) {
      return Response.json({ ok: false, reason: 'a signed-in session is required' }, { status: 401 });
    }

    let body: DocExtractBody;
    try {
      body = await req.json();
    } catch {
      return Response.json({ ok: false, reason: 'a JSON body is required' }, { status: 400 });
    }
    const fileId = (body.fileId ?? '').trim();
    if (!fileId) {
      return Response.json({ ok: false, reason: 'a file id is required' }, { status: 400 });
    }

    // 1. Verify the caller BEFORE any service-role client exists (C1.2 entry-point rule).
    const caller = deps.callerClient(authHeader);
    const { data: authUser, error: authErr } = await caller.auth.getUser();
    if (authErr || !authUser?.user) {
      return Response.json({ ok: false, reason: 'a signed-in session is required' }, { status: 401 });
    }

    // 2. The caller's own authority, re-checked by the database (own org + perform_work).
    const { data: permitted, error: permErr } = await caller.rpc('can_extract_document', { p_file_id: fileId });
    if (permErr) {
      return Response.json({ ok: false, reason: permErr.message }, { status: 403 });
    }
    if (permitted !== true) {
      return Response.json({ ok: false, reason: 'not allowed: the caller cannot extract this file' }, { status: 403 });
    }

    // 3. Only now is the service-role client created.
    const service = deps.serviceClient();

    const { data: ctx, error: ctxErr } = await service.rpc('document_extraction_context', { p_file_id: fileId });
    if (ctxErr) {
      return Response.json({ ok: false, reason: ctxErr.message }, { status: 500 });
    }
    const row = (Array.isArray(ctx) ? ctx[0] : ctx) as Row | null;
    if (!row) {
      return Response.json({ ok: false, reason: 'no such file' }, { status: 404 });
    }

    const filename = String(row.filename ?? '');
    const kind = classify(filename);

    // 4. Read the file's own bytes from the private bucket. The path convention matches the rest of
    //    the evidence pipeline: <org>/<engagement>/<filename>.
    let bytes: Uint8Array;
    try {
      const path = `${row.org_id}/${row.engagement_id}/${filename}`;
      const { data: blob, error: dlErr } = await service.storage.from(deps.bucket).download(path);
      if (dlErr || blob == null) {
        return Response.json({ ok: false, reason: 'the file could not be read' }, { status: 500 });
      }
      // Storage returns a Blob in production; a test may hand back a byte array from another realm.
      // Duck-type on the method rather than `instanceof`, which fails across realms (jsdom vs Node).
      const anyBlob = blob as { arrayBuffer?: () => Promise<ArrayBuffer>; length?: number };
      bytes = typeof anyBlob.arrayBuffer === 'function'
        ? new Uint8Array(await anyBlob.arrayBuffer())
        : Uint8Array.from(blob as ArrayLike<number>);
    } catch {
      return Response.json({ ok: false, reason: 'the file could not be read' }, { status: 500 });
    }

    // 5. Extract (pure, deterministic), then record the outcome through the service-only RPC.
    const outcome = await extractDocument(kind, bytes, deps);
    const { data: id, error: writeErr } = await service.rpc('document_extraction_complete', {
      p_file_id: fileId,
      p_status: outcome.status,
      p_text: outcome.text,
      p_page_count: outcome.pageCount,
      p_extractor: outcome.extractor,
      p_error: outcome.error,
    });
    if (writeErr) {
      return Response.json({ ok: false, reason: writeErr.message }, { status: 500 });
    }

    // The response carries the outcome, never the file bytes and never a secret.
    return Response.json({
      ok: outcome.status === 'done',
      extractionId: id,
      status: outcome.status,
      extractor: outcome.extractor,
      pageCount: outcome.pageCount,
      characters: outcome.text ? outcome.text.length : 0,
      reason: outcome.error,
    }, { status: 200 });
  };
}
