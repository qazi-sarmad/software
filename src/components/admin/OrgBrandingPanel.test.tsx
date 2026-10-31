import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const getBrandingFn = vi.fn();
const saveBrandingFn = vi.fn();
const savePptxThemeFn = vi.fn();
const listBrandingAssetsFn = vi.fn();

vi.mock('../../data/branding', async () => {
  const actual = await vi.importActual<typeof import('../../data/branding')>('../../data/branding');
  return {
    getBranding: (...a: unknown[]) => getBrandingFn(...a),
    saveBranding: (...a: unknown[]) => saveBrandingFn(...a),
    savePptxTheme: (...a: unknown[]) => savePptxThemeFn(...a),
    listBrandingAssets: (...a: unknown[]) => listBrandingAssetsFn(...a),
    uploadBrandingAsset: () => Promise.resolve({ ok: true, id: 'asset-1' }),
  };
});

let rights: Record<string, boolean> = { edit_config: true };
vi.mock('../../context/AppContext', () => ({
  useApp: () => ({ currentUser: { id: 'u-1', orgId: 'org-1', rights } }),
}));

import { OrgBrandingPanel } from './OrgBrandingPanel';
import { DEFAULT_BRANDING } from '../../lib/render/branding';

const baseSpec = { orgId: 'org-1', ...DEFAULT_BRANDING };

describe('OA-03 branding (F9)', () => {
  beforeEach(() => {
    rights = { edit_config: true };
    getBrandingFn.mockResolvedValue(baseSpec);
    saveBrandingFn.mockResolvedValue({ ok: true });
    savePptxThemeFn.mockResolvedValue({ ok: true });
    listBrandingAssetsFn.mockResolvedValue([]);
  });

  it('loads the saved branding and renders the live preview', async () => {
    render(<OrgBrandingPanel />);
    await waitFor(() => expect(screen.getByTestId('oa-branding')).toBeTruthy());
    expect(screen.getByTestId('oa-branding-preview-note').textContent).toContain('A4');
    expect(screen.getByTestId('oa-branding-preview-footer').textContent).toContain('Page 1 of 3');
  });

  it('saves a changed field through saveBranding', async () => {
    render(<OrgBrandingPanel />);
    await waitFor(() => expect(screen.getByTestId('oa-branding')).toBeTruthy());
    fireEvent.change(screen.getByTestId('oa-branding-header'), { target: { value: 'Acme Assurance' } });
    fireEvent.click(screen.getByTestId('oa-branding-save'));
    await waitFor(() => expect(saveBrandingFn).toHaveBeenCalled());
    const fields = saveBrandingFn.mock.calls[0][1] as Record<string, unknown>;
    expect(fields.headerText).toBe('Acme Assurance');
    await waitFor(() => expect(screen.getByTestId('oa-branding-saved')).toBeTruthy());
  });

  it('updates the live preview before saving', async () => {
    render(<OrgBrandingPanel />);
    await waitFor(() => expect(screen.getByTestId('oa-branding')).toBeTruthy());
    fireEvent.change(screen.getByTestId('oa-branding-header'), { target: { value: 'Live header' } });
    await waitFor(() =>
      expect(screen.getByTestId('oa-branding-preview-header').textContent).toContain('Live header'),
    );
  });

  it('shows a read-only notice and no save button without edit_config', async () => {
    rights = { edit_config: false };
    render(<OrgBrandingPanel />);
    await waitFor(() => expect(screen.getByTestId('oa-branding-readonly')).toBeTruthy());
    expect(screen.queryByTestId('oa-branding-save')).toBeNull();
  });

  it('surfaces the server refusal in plain words when a save is refused', async () => {
    saveBrandingFn.mockResolvedValue({ ok: false, reason: 'This feature is not included in your plan.' });
    render(<OrgBrandingPanel />);
    await waitFor(() => expect(screen.getByTestId('oa-branding')).toBeTruthy());
    fireEvent.click(screen.getByTestId('oa-branding-save'));
    await waitFor(() =>
      expect(screen.getByTestId('oa-branding-error').textContent).toContain('not included in your plan'),
    );
  });

  it('lists the stored branding assets so an upload can be confirmed (F4)', async () => {
    listBrandingAssetsFn.mockResolvedValue([
      { id: 'a1', kind: 'font', filename: 'house.woff2', mimeType: 'font/woff2', byteSize: 40960 },
      { id: 'a2', kind: 'logo_light', filename: 'logo.svg', mimeType: 'image/svg+xml', byteSize: 2048 },
    ]);
    render(<OrgBrandingPanel />);
    await waitFor(() => expect(screen.getByTestId('oa-branding-assets-list')).toBeTruthy());
    expect(screen.getByTestId('oa-branding-asset-a1').textContent).toContain('house.woff2');
    expect(screen.getByTestId('oa-branding-asset-a1').textContent).toContain('40.0 KB');
    expect(screen.getByTestId('oa-branding-asset-a2').textContent).toContain('logo.svg');
  });

  it('shows an empty state when the org has stored no assets', async () => {
    listBrandingAssetsFn.mockResolvedValue([]);
    render(<OrgBrandingPanel />);
    await waitFor(() => expect(screen.getByTestId('oa-branding-assets-empty')).toBeTruthy());
  });
});
