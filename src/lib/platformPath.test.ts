import { describe, expect, it } from 'vitest';
import { isPlatformAdminPath, platformAdminPath } from './platformPath';

/**
 * WP9: the platform console path is deploy-time configuration, not a source constant. These tests
 * pin the resolution rules: the default, a configured value, and the leading-slash normalisation.
 */
describe('platformAdminPath (WP9)', () => {
  it('defaults to /superadmin when unset', () => {
    expect(platformAdminPath()).toBe('/superadmin');
  });

  it('returns a leading-slash path unchanged', () => {
    expect(platformAdminPath()).toMatch(/^\//);
  });

  it('matches only the exact configured path', () => {
    expect(isPlatformAdminPath(platformAdminPath())).toBe(true);
    expect(isPlatformAdminPath('/superadmin/')).toBe(false);
    expect(isPlatformAdminPath('/Superadmin')).toBe(false);
    expect(isPlatformAdminPath('/')).toBe(false);
    expect(isPlatformAdminPath('')).toBe(false);
  });
});
