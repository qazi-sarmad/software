/**
 * archive-upload (C2.5): the physical Storage upload for an activity archive, and the verification
 * that must succeed before anything is treated as archived (spec §25.4).
 *
 * 0043 built the JSON and recorded the content hash, but nothing uploaded it, so an archive could be
 * marked done with no file behind it. This function closes that: the caller is verified first, the
 * caller's own right is re-checked through the database, the exact canonical bytes are read through a
 * service-only accessor, they are stored, their SHA-256 is computed from what was stored, and only
 * then does archive_job_mark_uploaded move the job to done. A hash that does not match is refused by
 * the database and raises an integrity alert.
 *
 * Laws that shape this file:
 *   - L2: the payload is the tenant's own activity log and goes only to the tenant's own bucket path.
 *   - L5: the caller is verified before any service-role client is created, and the hash is ledgered.
 *   - F5: no response contains a secret, a ciphertext or a token; the body is the job's own status.
 *   - F21: the service role is used only server-side and only for the calls listed here.
 *   - L1: the only randomness is none at all; the hash is deterministic.
 */


export interface Row { [key: string]: unknown; }
export interface RpcError { message: string }
export interface QueryResult { data: Row | null; error: RpcError | null; }
export interface RpcResult { data: unknown; error: RpcError | null; }
export interface StorageResult { data: unknown; error: RpcError | null; }

/**
 * Only the digest is needed here, so the handler depends on the narrowest possible surface rather
 * than on all of CryptoLike. The real Deno `crypto` satisfies it; a test supplies a fixed digest.
 */
export interface DigestLike {
  subtle: { digestSync(algorithm: string, data: Uint8Array): Uint8Array };
}

export interface CallerClientLike {
  auth: { getUser(): Promise<{ data: { user: { id: string } | null } | null; error: unknown }> };
  rpc(fn: string, args?: Record<string, unknown>): Promise<RpcResult>;
}

export interface ServiceClientLike {
  rpc(fn: string, args?: Record<string, unknown>): Promise<RpcResult>;
  storage: {
    from(bucket: string): {
      upload(path: string, body: unknown, options?: Record<string, unknown>): Promise<StorageResult>;
    };
  };
}

export interface ArchiveUploadDeps {
  callerClient(authHeader: string): CallerClientLike;
  serviceClient(): ServiceClientLike;
  crypto: DigestLike;
  encoder: { encode(input: string): Uint8Array };
  bucket: string;
}

export interface ArchiveUploadBody {
  archiveId?: string | null;
}

export interface ArchiveUploadOutcome {
  status: number;
  body: Record<string, unknown>;
}

const BUCKET_DEFAULT = 'archives';

/** sha256 hex of the exact bytes that were stored. */
function sha256Hex(bytes: Uint8Array, crypto: DigestLike): string {
  const digest = crypto.subtle.digestSync('SHA-256', bytes) as Uint8Array;
  return Array.from(digest).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function createArchiveUploadHandler(deps: ArchiveUploadDeps) {
  return async function handle(req: Request): Promise<Response> {
    if (req.method !== 'POST') {
      return Response.json({ ok: false, reason: 'method not allowed' }, { status: 405 });
    }

    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader.startsWith('Bearer ')) {
      return Response.json({ ok: false, reason: 'a signed-in session is required' }, { status: 401 });
    }

    let body: ArchiveUploadBody;
    try {
      body = await req.json();
    } catch {
      return Response.json({ ok: false, reason: 'a JSON body is required' }, { status: 400 });
    }
    const archiveId = (body.archiveId ?? '').trim();
    if (!archiveId) {
      return Response.json({ ok: false, reason: 'an archive id is required' }, { status: 400 });
    }

    // 1. Verify the caller BEFORE any service-role client exists (C1.2 entry-point rule).
    const caller = deps.callerClient(authHeader);
    const { data: authUser, error: authErr } = await caller.auth.getUser();
    if (authErr || !authUser?.user) {
      return Response.json({ ok: false, reason: 'a signed-in session is required' }, { status: 401 });
    }

    // 2. The caller's own authority, re-checked by the database rather than trusted from the body.
    const { data: permitted, error: permErr } = await caller.rpc('can_upload_archive', {
      p_archive_id: archiveId,
    });
    if (permErr) {
      return Response.json({ ok: false, reason: permErr.message }, { status: 403 });
    }
    if (permitted !== true) {
      return Response.json(
        { ok: false, reason: 'not allowed: the caller cannot upload this archive' },
        { status: 403 },
      );
    }

    // 3. Only now is the service-role client created.
    const service = deps.serviceClient();

    const { data: job, error: jobErr } = await service.rpc('archive_job_for_upload', {
      p_archive_id: archiveId,
    });
    if (jobErr) {
      return Response.json({ ok: false, reason: jobErr.message }, { status: 403 });
    }
    const row = (Array.isArray(job) ? job[0] : job) as Row | null;
    if (!row) {
      return Response.json({ ok: false, reason: 'no such archive job' }, { status: 404 });
    }

    const { data: canonical, error: canonErr } = await service.rpc('archive_job_canonical', {
      p_job_id: archiveId,
    });
    if (canonErr || typeof canonical !== 'string') {
      return Response.json({ ok: false, reason: 'the archive payload could not be read' }, { status: 500 });
    }

    // 4. Store exactly those bytes, then hash exactly those bytes.
    const bytes = deps.encoder.encode(canonical);
    const path = String(row.storage_path ?? `${row.org_id}/activity/${archiveId}.json`);
    const { error: upErr } = await service.storage
      .from(deps.bucket ?? BUCKET_DEFAULT)
      .upload(path, bytes, { contentType: 'application/json', upsert: true });
    if (upErr) {
      return Response.json({ ok: false, reason: 'the archive could not be stored' }, { status: 500 });
    }

    const storedHash = sha256Hex(bytes, deps.crypto);

    // 5. The database decides: done only when the stored hash equals the ledgered content hash.
    const { data: status, error: markErr } = await service.rpc('archive_job_mark_uploaded', {
      p_job_id: archiveId, p_sha256: storedHash, p_bytes: bytes.length,
    });
    if (markErr) {
      return Response.json({ ok: false, reason: markErr.message }, { status: 500 });
    }

    return Response.json(
      { ok: status === 'done', status, storagePath: path, bytes: bytes.length },
      { status: status === 'done' ? 200 : 409 },
    );
  };
}

export { BUCKET_DEFAULT, sha256Hex };
