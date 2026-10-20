/**
 * invite-user (S3, F6, F13). Two actions behind one function, both reachable only with a verified
 * JWT:
 *
 *   { action: "invite", email, roleSlug } — an Org Admin (manage_users) invites a colleague. The
 *                                           database records the invitation, counts it against the
 *                                           cap and queues the acceptance link. No Supabase Auth
 *                                           email is used: the link in the queued message is the
 *                                           only thing the invitee needs.
 *   { action: "accept", token }           — the invitee, already signed in, presents the token. The
 *                                           function calls admin_accept_invite, which is
 *                                           service-role-only, to bind the account to the invited
 *                                           role and mark the invitation used.
 *
 * Laws that shape this file:
 *   - F5: no secret and no token is logged. The service-role key is read from the environment and
 *     never returned.
 *   - F4/L5: the caller is verified before anything happens, and the database re-checks the right.
 *   - The service role is used only here and only for the acceptance call, which is exactly the
 *     list F21 allows.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

/** The caller's client, carrying the caller's JWT, so every RPC is re-checked as that caller. */
function callerClient(authHeader: string) {
  return createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ ok: false, reason: 'method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) {
    return json({ ok: false, reason: 'a signed-in session is required' }, 401);
  }

  let body: { action?: string; email?: string; roleSlug?: string | null; token?: string };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, reason: 'a JSON body is required' }, 400);
  }

  if (body.action === 'invite') {
    if (!body.email || !body.email.includes('@')) {
      return json({ ok: false, reason: 'a valid email address is required' }, 400);
    }
    const caller = callerClient(authHeader);
    const { data, error } = await caller.rpc('invite_user_capped', {
      p_email: body.email,
      p_role_slug: body.roleSlug ?? null,
    });
    if (error) return json({ ok: false, reason: error.message }, 403);
    return json({ ok: true, inviteId: data, status: 'queued' });
  }

  if (body.action === 'accept') {
    if (!body.token || body.token.trim() === '') {
      return json({ ok: false, reason: 'the invitation code is required' }, 400);
    }
    const caller = callerClient(authHeader);
    const { data: who, error: whoError } = await caller.auth.getUser();
    if (whoError || !who?.user) {
      return json({ ok: false, reason: 'a signed-in session is required' }, 401);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const { data: accepted, error: acceptError } = await admin.rpc('admin_accept_invite', {
      p_token: body.token,
      p_user: who.user.id,
    });
    if (acceptError) return json({ ok: false, reason: acceptError.message }, 403);

    const row = Array.isArray(accepted) ? accepted[0] : accepted;
    return json({
      ok: true,
      orgId: row?.out_org_id ?? null,
      roleSlug: row?.out_role_slug ?? null,
      email: row?.out_email ?? null,
    });
  }

  // F13: an external auditor accepts its invite. Same shape as "accept", but the account is bound
  // through external_auditor_accept (service-role only), which writes the access row and the
  // per-engagement grants. The caller must already be signed in (the account was created by the
  // invite link). No Supabase Auth email is used, exactly as the member flow.
  if (body.action === 'accept-external') {
    if (!body.token || body.token.trim() === '') {
      return json({ ok: false, reason: 'the invitation code is required' }, 400);
    }
    const caller = callerClient(authHeader);
    const { data: who, error: whoError } = await caller.auth.getUser();
    if (whoError || !who?.user) {
      return json({ ok: false, reason: 'a signed-in session is required' }, 401);
    }
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const { data: accepted, error: acceptError } = await admin.rpc('external_auditor_accept', {
      p_token: body.token,
      p_user: who.user.id,
    });
    if (acceptError) return json({ ok: false, reason: acceptError.message }, 403);
    const row = Array.isArray(accepted) ? accepted[0] : accepted;
    return json({ ok: true, orgId: row?.out_org_id ?? null, email: row?.out_email ?? null });
  }

  return json({ ok: false, reason: 'unknown action' }, 400);
});