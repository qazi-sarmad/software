/**
 * archive-upload (C2.5, spec §25.4). Wires the real dependencies into the handler.
 *
 * Authorisation happens inside the handler before the service client is created, so this file is
 * pure wiring: it passes the client factories by reference and never calls them itself. The service
 * role is used only after the caller has been verified and the database has re-checked the right.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createArchiveUploadHandler, type DigestLike } from '../_shared/archiveUploadHandler.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const BUCKET = Deno.env.get('ARCHIVE_BUCKET') ?? 'archives';

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

const handler = createArchiveUploadHandler({
  callerClient,
  serviceClient,
  crypto: crypto as unknown as DigestLike,
  encoder: new TextEncoder(),
  bucket: BUCKET,
});

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const res = await handler(req);
  for (const [k, v] of Object.entries(CORS)) res.headers.set(k, v);
  return res;
});
