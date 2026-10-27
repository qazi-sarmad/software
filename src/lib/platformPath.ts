/**
 * The unlisted path the platform console answers on (WP9).
 *
 * The route is deploy-time configuration, not a constant in the source, so it is not a value an
 * attacker can guess from the public bundle. `VITE_PLATFORM_ADMIN_PATH` sets it; the default is the
 * historical `/superadmin`, which local runs and the test suite use.
 *
 * This is a deterrent, not the security control. The control is the platform role
 * (`platform_admins` + the access-token hook) and the MFA gate in `require_platform_admin()`. The
 * path only removes the "find the login page" step from an attacker's list.
 */
export function platformAdminPath(): string {
  const raw = import.meta.env.VITE_PLATFORM_ADMIN_PATH;
  const value = typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : '/superadmin';
  return value.startsWith('/') ? value : `/${value}`;
}

/** True when a path is the platform console route. Exact match; no trailing-slash variants. */
export function isPlatformAdminPath(path: string): boolean {
  return path === platformAdminPath();
}
