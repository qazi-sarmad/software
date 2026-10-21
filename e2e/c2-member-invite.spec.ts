import { test, expect, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { passwordFor } from './password';

/**
 * C2.4: a colleague invitation, end to end.
 *
 * The path this proves, in order:
 *   People & Roles → invite → the queue row carries the acceptance link → the invitee's account is
 *   created and they sign in → /invite/accept?token=… binds the membership with the invited role →
 *   the People table shows the new member.
 *
 * The UI copy is asserted to say "queued" and never "sent" (D20): the account does not exist until
 * the invitee accepts, so nothing has been sent by the platform.
 *
 * The token itself lives only in the queued message body, so this spec reads it with the service-role
 * key — a test-environment hook only, never a production path (F5).
 */
const ORG_ADMIN_EMAIL = 'ayesha.khan@provio-test.invalid';
const INVITEE_EMAIL = 'nadia.hassan.invited@provio-test.invalid';
const INVITEE_PASSWORD = 'invited-e2e-password-0001';

/**
 * Sign in as a synthetic user. The password comes from the per-run `passwords.json` the global setup
 * writes, EXCEPT for the invited colleague: this spec creates that account itself, so it passes the
 * password it chose.
 */
async function signIn(page: Page, email: string, password?: string) {
  await page.goto('/');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password ?? passwordFor(email));
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('navigation', { name: 'Navigation Strip' })).toBeVisible();
}

/**
 * Sign out before switching principal. The session lives in the browser, so a second `signIn` while
 * one is active would land on the tenant shell with no sign-in form (this bit the first CI run).
 */
async function signOut(page: Page) {
  await page.goto('/');
  await page.getByLabel('Open user profile menu').click();
  await page.getByText('Sign out').click();
  await expect(page.getByTestId('signin-screen')).toBeVisible();
}

function serviceClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) throw new Error('C2.4 spec needs SUPABASE_URL and SUPABASE_SECRET_KEY');
  return createClient(url, secret, { auth: { persistSession: false } });
}

test.describe('C2.4: colleague invitation end to end', () => {
  test('[E2E] invite, accept the link, and the membership carries the invited role', async ({ page }) => {
    const sb = serviceClient();

    // Start clean: remove any residue from an earlier run of this spec.
    const prior = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const priorUser = prior.data?.users.find((u) => u.email === INVITEE_EMAIL);
    if (priorUser) {
      await sb.from('org_members').delete().eq('user_id', priorUser.id);
      await sb.auth.admin.deleteUser(priorUser.id);
    }
    await sb.from('auth_invites').delete().eq('email', INVITEE_EMAIL);

    // 1. The Org Admin invites a colleague from People & Roles.
    await signIn(page, ORG_ADMIN_EMAIL);
    await page.getByLabel('Open user profile menu').click();
    await page.getByText('People & Roles').click();
    await expect(page.getByTestId('admin-people')).toBeVisible();

    await page.getByLabel('Enter email address').fill(INVITEE_EMAIL);
    await page.getByLabel('Select role').click();
    await page.getByRole('option', { name: 'Preparer' }).click();
    await page.getByTestId('admin-invite').click();

    // The copy is honest: "queued", never "sent".
    const confirmation = page.getByTestId('admin-invite-sent');
    await expect(confirmation).toBeVisible();
    await expect(confirmation).toContainText('queued');
    await expect(confirmation).not.toContainText('sent');

    // 2. The queue row carries the acceptance link and is pending, not sent.
    const invite = await sb.from('auth_invites').select('id, token_hash, role_slug, accepted_at')
      .eq('email', INVITEE_EMAIL).single();
    expect(invite.error, invite.error?.message).toBeNull();
    expect(invite.data!.role_slug).toBe('preparer');
    expect(invite.data!.accepted_at).toBeNull();
    // The token is stored as a hash only; the plaintext is not in the table.
    expect(invite.data!.token_hash).toMatch(/^[0-9a-f]{64}$/);

    const queued = await sb.from('email_queue')
      .select('body_text, status').eq('metadata->>invite_id', invite.data!.id).single();
    expect(queued.error, queued.error?.message).toBeNull();
    expect(queued.data!.status).toBe('pending');
    const body = queued.data!.body_text as string;
    expect(body).toContain('/invite/accept?token=');
    expect(body).not.toContain('has been sent');
    const token = body.match(/\/invite\/accept\?token=([0-9a-f]+)/)![1];
    // The plaintext token is exactly what the stored hash covers (the hook is read-only).
    expect(invite.data!.token_hash).toBe(
      // sha256 hex of the token
      await sha256Hex(token)
    );

    // 3. The invitee's account exists (created by the invitee) and they sign in.
    const created = await sb.auth.admin.createUser({
      email: INVITEE_EMAIL, password: INVITEE_PASSWORD, email_confirm: true,
    });
    expect(created.error, created.error?.message).toBeNull();
    const user = (await sb.auth.admin.listUsers({ page: 1, perPage: 1000 })).data!.users
      .find((u) => u.email === INVITEE_EMAIL)!;
    expect(user, 'the invited account exists').toBeTruthy();

    // 4. The acceptance route is reachable without a session and carries the code from the link.
    await signOut(page);
    await page.goto(`/invite/accept?token=${token}`);
    await expect(page.getByTestId('oa-accept')).toBeVisible();
    await expect(page.getByTestId('oa-accept-token')).toHaveValue(token);

    // 5. Sign in as the invitee (who has no organisation yet, so no tenant shell), then accept on the
    //    same route. The screen sees the session and offers "Accept invitation".
    //
    //    The `invite-user` Edge Function is not deployed to the test project (the owner deploys it;
    //    see docs/COMPLETION-REPORT.md), so the HTTP hop is stubbed at the network boundary — exactly
    //    as e2e/c1-graph-oauth.spec.ts stubs graph-oauth. The stub is NOT a mock of our logic: it runs
    //    in the test process with the service-role key and calls the real `admin_accept_invite` RPC,
    //    which is the only thing the deployed function does. So the screen, the route and the database
    //    binding are all real; only the undeployed function hop is stubbed.
    await page.route('**/functions/v1/invite-user', async (route) => {
      const { data, error } = await sb.rpc('admin_accept_invite', { p_token: token, p_user: user.id });
      const bound = !error && Array.isArray(data) && data.length > 0;
      await route.fulfill({
        status: bound ? 200 : 400,
        contentType: 'application/json',
        body: JSON.stringify(bound ? { ok: true } : { ok: false, reason: error?.message ?? 'not bound' }),
      });
    });

    await page.goto('/');
    await page.getByLabel('Email').fill(INVITEE_EMAIL);
    await page.getByLabel('Password').fill(INVITEE_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    // The invitee has no membership yet, so the app shows the no-tenant welcome, never the tenant shell.
    await expect(page.getByTestId('no-tenant-screen')).toBeVisible();
    await page.goto(`/invite/accept?token=${token}`);
    // The session is still resolving for a moment after the navigation; wait for the resolved state
    // ("Accept invitation") before clicking, or the screen would offer account creation instead.
    const acceptBtn = page.getByTestId('oa-accept-submit');
    await expect(acceptBtn).toBeVisible();
    await expect(acceptBtn).toHaveText('Accept invitation');
    await acceptBtn.click();
    await expect(page.getByTestId('oa-accept-done')).toBeVisible();

    // 6. The membership exists with the invited role, and the invitation is used once.
    const member = await sb.from('org_members')
      .select('org_id, role_id, roles(slug)').eq('user_id', user.id).single();
    expect(member.error, member.error?.message).toBeNull();
    expect((member.data!.roles as unknown as { slug: string }).slug).toBe('preparer');

    const used = await sb.from('auth_invites').select('accepted_at').eq('id', invite.data!.id).single();
    expect(used.data!.accepted_at).not.toBeNull();

    // A second acceptance is refused, so the link is single use.
    const second = await sb.rpc('admin_accept_invite', { p_token: token, p_user: user.id });
    expect(second.error?.message ?? '').toMatch(/already been used/i);

    // 7. The People table now lists the new member.
    await signOut(page);
    await signIn(page, ORG_ADMIN_EMAIL);
    await page.getByLabel('Open user profile menu').click();
    await page.getByText('People & Roles').click();
    await expect(page.getByTestId(`member-${user.id}`)).toBeVisible();
  });
});

/** sha256 hex, used only to prove the stored hash matches the token in the queued body. */
async function sha256Hex(value: string): Promise<string> {
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(value).digest('hex');
}
