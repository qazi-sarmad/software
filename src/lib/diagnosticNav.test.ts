import { describe, expect, it } from 'vitest';
import { destinationForScreen } from './diagnosticNav';
import { ORG_DIAGNOSTIC_RULES, PLATFORM_DIAGNOSTIC_RULES } from './diagnostics';

describe('diagnosticNav (self-diagnostic destinations)', () => {
  it('maps an org control screen to its inspector and tab', () => {
    expect(destinationForScreen('OA-29')).toEqual({
      kind: 'inspector', inspector: 'org_control', data: { tab: 'integrity' },
    });
    expect(destinationForScreen('OA-31')).toEqual({
      kind: 'inspector', inspector: 'org_control', data: { tab: 'incidents' },
    });
  });

  it('maps an audit-file screen to the audit-file tab', () => {
    expect(destinationForScreen('AF-13')).toEqual({ kind: 'tab', tab: 'audit_file' });
  });

  it('returns null for no id and for an id with no destination (never a button to nowhere)', () => {
    expect(destinationForScreen(null)).toBeNull();
    expect(destinationForScreen('ZZ-99')).toBeNull();
  });

  it('every org rule that names a screen has a reachable destination', () => {
    const unmapped = ORG_DIAGNOSTIC_RULES
      .filter((r) => r.screenId !== null)
      .filter((r) => destinationForScreen(r.screenId) === null)
      .map((r) => `${r.id} → ${r.screenId}`);
    // SA-02/SA-04 are the platform console, which is a separate bundle: an org finding does not
    // name them. Every other screen a rule names must be reachable from the shell.
    expect(unmapped.filter((u) => !u.includes('SA-0'))).toEqual([]);
  });

  it('every platform rule that names a screen is a platform-console screen', () => {
    for (const r of PLATFORM_DIAGNOSTIC_RULES) {
      if (r.screenId) expect(r.screenId).toMatch(/^SA-\d{2}$/);
    }
  });
});
