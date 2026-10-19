/**
 * Server-side request forgery (SSRF) checks for the AI gateway (F8, L2).
 *
 * A server-mode call is made by the ai-gateway Edge Function, so the endpoint URL is attacker-
 * influenced configuration. In `server` mode the URL must be https or a public address: localhost,
 * loopback, RFC1918, link-local, unique-local and cloud-metadata addresses are rejected. In
 * `browser` mode the user's own browser calls the endpoint, so a localhost or private name is
 * allowed and only the scheme matters.
 *
 * Pure: no network. A hostname that is a name (not an IP literal) is judged by the name and by any
 * IP literals supplied to `isPrivateHost`; the caller resolves DNS and passes the resolved address.
 */

export type AccessMode = 'server' | 'browser';

const DENY_MESSAGE =
  'This looks like a vendor-hosted AI service. Provio only allows models that run on your own infrastructure (spec L2).';

const PRIVATE_MESSAGE =
  'In server mode the endpoint must be a public https address. Local and private addresses are refused.';

/** The vendor-hosted refusal, exported so the UI and the gateway show one message (F8). */
export const VENDOR_ENDPOINT_MESSAGE = DENY_MESSAGE;

/** The private-address refusal for server mode. */
export const PRIVATE_ENDPOINT_MESSAGE = PRIVATE_MESSAGE;

export interface SsrfResult {
  ok: boolean;
  reason?: string;
}

/** An IPv4 dotted quad parsed to four octets, or null. */
export function parseIpv4(host: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const octets = m.slice(1).map((p) => Number(p));
  if (octets.some((o) => o > 255)) return null;
  return octets;
}

/** True for an IPv4 literal in a private, loopback, link-local or metadata range. */
export function isPrivateIpv4(host: string): boolean {
  const o = parseIpv4(host);
  if (!o) return false;
  const [a, b] = o;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // RFC1918
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local, incl. 169.254.169.254 metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 192 && b === 168) return true; // RFC1918
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  return false;
}

/** True for an IPv6 literal in a loopback, unspecified, link-local or unique-local range, including
 *  an IPv4-mapped form (::ffff:127.0.0.1). */
export function isPrivateIpv6(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === '::1' || h === '::') return true;
  const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(h);
  if (mapped) return isPrivateIpv4(mapped[1]);
  if (h.startsWith('fe80')) return true; // link-local
  if (h.startsWith('fc') || h.startsWith('fd')) return true; // unique-local fc00::/7
  return false;
}

/** True when a host literal (an IP or a name) is local, private, link-local or a metadata host. */
export function isPrivateHost(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (h === 'metadata.google.internal' || h === 'metadata') return true;
  if (h.includes(':')) return isPrivateIpv6(h);
  if (parseIpv4(h)) return isPrivateIpv4(h);
  return false;
}

/** A deny-list match for a vendor AI host, using the same contains-match the database uses (F8). */
export function isDeniedEndpoint(url: string, denyPatterns: string[]): boolean {
  const lower = url.toLowerCase();
  return denyPatterns.some((p) => p && lower.includes(p.toLowerCase()));
}

/**
 * Decide whether an endpoint URL may be used in the given access mode.
 * - server: must be https (or http on a public host is still refused), and the host must be public.
 * - browser: must be http or https; a localhost/private name is allowed.
 * `resolvedIp` is the DNS answer, when the caller has one, so a name that resolves to a private
 * address is refused in server mode.
 */
export function checkEndpoint(
  url: string, mode: AccessMode, denyPatterns: string[], resolvedIp?: string
): SsrfResult {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: 'The endpoint URL is not a valid URL.' };
  }
  if (isDeniedEndpoint(url, denyPatterns)) {
    return { ok: false, reason: DENY_MESSAGE };
  }
  const host = parsed.hostname;
  if (mode === 'browser') {
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { ok: false, reason: 'The endpoint must be an http or https URL.' };
    }
    return { ok: true };
  }
  // server mode
  if (parsed.protocol !== 'https:') {
    return { ok: false, reason: PRIVATE_MESSAGE };
  }
  if (isPrivateHost(host)) {
    return { ok: false, reason: PRIVATE_MESSAGE };
  }
  if (resolvedIp && isPrivateHost(resolvedIp)) {
    return { ok: false, reason: PRIVATE_MESSAGE };
  }
  return { ok: true };
}
