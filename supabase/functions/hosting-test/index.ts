/**
 * hosting-test (C2.1, S11, F16, F21). Wires the real dependencies into the handler.
 *
 * Authorisation happens inside the handler before the service client is created, so this file is
 * pure wiring. The password is read with the service role and passed straight to the driver; it is
 * never returned, logged or stored in a response.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  createHostingTestHandler, type ConnectionSpec, type DriverLike, type DriverReport,
} from '../_shared/hostingTestHandler.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

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
 * The real driver. It opens one connection with the Postgres wire protocol, asks the four questions
 * the report needs, and closes. A driver that cannot connect throws, and the handler turns that
 * into a plain-language report.
 */
const postgresDriver: DriverLike = {
  async probe(connection: ConnectionSpec, timeoutMs: number): Promise<DriverReport> {
    const { Client } = await import('https://deno.land/x/postgres@v0.19.3/mod.ts');
    const client = new Client({
      hostname: connection.host,
      port: connection.port,
      database: connection.database,
      user: connection.username,
      password: connection.password,
      tls: { enforce: connection.sslMode !== 'disable' },
      connection: { attempts: 1 },
    });
    let timer: number | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('the connection timed out')), timeoutMs);
      });
      await Promise.race([client.connect(), timeout]);

      const versionRes = await client.queryObject<{ v: number }>('show server_version_num');
      const extRes = await client.queryObject<{ name: string }>(
        'select extname as name from pg_extension');
      const roleRes = await client.queryObject<{ name: string }>(
        'select rolname as name from pg_roles');
      let freeSpaceBytes: number | null = null;
      try {
        const spaceRes = await client.queryObject<{ bytes: bigint | string }>(
          'select pg_database_size(current_database()) as bytes');
        const raw = spaceRes.rows[0]?.bytes;
        if (raw != null) freeSpaceBytes = Number(raw);
      } catch {
        freeSpaceBytes = null;
      }
      return {
        serverVersionNum: versionRes.rows[0]?.v ?? null,
        extensions: extRes.rows.map((r) => r.name),
        roles: roleRes.rows.map((r) => r.name),
        freeSpaceBytes,
      };
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      try { await client.end(); } catch { /* already closed */ }
    }
  },
};

const handler = createHostingTestHandler({
  callerClient,
  serviceClient,
  driver: postgresDriver,
  now: () => Date.now(),
  // The address check runs on every DNS answer, not only on the literal host (audit 2026-10-23).
  resolveHost: async (host: string) => {
    const out: string[] = [];
    for (const type of ['A', 'AAAA'] as const) {
      try { out.push(...(await Deno.resolveDns(host, type))); } catch { /* no record of this type */ }
    }
    return out;
  },
});

Deno.serve(handler);
