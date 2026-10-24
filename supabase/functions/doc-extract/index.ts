/**
 * doc-extract (C2.6, spec §13.1, §20). Wires the real parsers into the handler.
 *
 * Authorisation happens inside the handler before the service client is created, so this file is
 * pure wiring: it passes the client factories and the parser functions by reference and never calls
 * them itself. The service role is used only after the caller has been verified and the database has
 * re-checked the right.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createDocExtractHandler, type PdfTextResult } from '../_shared/docExtractHandler.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const BUCKET = Deno.env.get('EVIDENCE_BUCKET') ?? 'evidence';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function callerClient(authHeader: string) {
  return createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
}

function serviceClient() {
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
}

/**
 * A small text-layer PDF parser. PDF text extraction is genuinely hard; rather than add a large
 * dependency, this decompresses nothing and reads the common text-showing operators (Tj, TJ). A PDF
 * with no text layer yields empty text and the handler records 'unsupported' (§20). The parser never
 * throws on unexpected input, so a malformed PDF cannot crash the function.
 */
async function pdfText(bytes: Uint8Array): Promise<PdfTextResult> {
  const raw = new TextDecoder('latin1').decode(bytes);
  const pageCount = (raw.match(/\/Type\s*\/Page[^s]/g) ?? []).length || 1;
  const pieces: string[] = [];
  for (const m of raw.matchAll(/\(((?:\\.|[^\\()])*)\)\s*Tj/g)) pieces.push(m[1]);
  for (const m of raw.matchAll(/\[((?:[^\]\\]|\\.)*)\]\s*TJ/g)) {
    for (const s of m[1].matchAll(/\(((?:\\.|[^\\()])*)\)/g)) pieces.push(s[1]);
  }
  const text = pieces.join(' ').replace(/\\([()\\])/g, '$1').trim();
  return { text, pageCount };
}

/** DOCX: mammoth is already a dependency of the import paths; keep one DOCX parser for the product. */
async function parseDocx(bytes: Uint8Array): Promise<string> {
  const mammoth = await import('https://esm.sh/mammoth@1.13.0');
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const result = await mammoth.extractRawText({ arrayBuffer: buf });
  return String(result.value ?? '');
}

/**
 * XLSX/CSV: the vendored SheetJS parser, imported through Deno's npm specifier so the edge runtime
 * bundles the same version the browser uses. A missing parser throws, and the handler records a
 * plain failure rather than inventing text (L1).
 */
async function parseSheet(bytes: Uint8Array, kind: 'xlsx' | 'csv'): Promise<string> {
  if (kind === 'csv') return new TextDecoder('utf-8').decode(bytes);
  const XLSX = await import('npm:xlsx@0.20.3');
  const wb = XLSX.read(bytes, { type: 'array' });
  return wb.SheetNames.map((name: string) => `# ${name}\n${XLSX.utils.sheet_to_csv(wb.Sheets[name])}`).join('\n');
}

const handler = createDocExtractHandler({
  callerClient,
  serviceClient,
  bucket: BUCKET,
  parseDocx,
  parseSheet,
  pdfText,
});

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const res = await handler(req);
  for (const [k, v] of Object.entries(CORS)) res.headers.set(k, v);
  return res;
});
