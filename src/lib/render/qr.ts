/**
 * renderQr (F9, F11): a deterministic QR code for a verification URL. Pure — it wraps the `qrcode`
 * library and returns a data URL or raw modules. The same function serves the Board Pack PDF, the
 * certificate and the public verification page.
 */
import QRCode from 'qrcode';

export interface QrOptions {
  size?: number;
  margin?: number;
  /** The module colour (a data value, never a component hex). */
  dark?: string;
  light?: string;
}

/** A PNG data URL, ready to embed in a PDF (pdf-lib) or an <img> in the app. */
export async function renderQrDataUrl(text: string, opts: QrOptions = {}): Promise<string> {
  return QRCode.toDataURL(text, {
    errorCorrectionLevel: 'M',
    margin: opts.margin ?? 1,
    width: opts.size ?? 256,
    color: { dark: opts.dark ?? '#000000', light: opts.light ?? '#ffffff' },
  });
}

/** The raw module matrix, for a caller that draws the QR itself (the PPTX and web view). */
export async function renderQrModules(text: string): Promise<{ size: number; data: boolean[] }> {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const size = qr.modules.size;
  const data: boolean[] = [];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) data.push(Boolean(qr.modules.get(r, c)));
  }
  return { size, data };
}

/** The public verification URL for a certificate or board pack id (F11, F10). */
export function verificationUrl(appBaseUrl: string, kind: 'verify' | 'pack', id: string): string {
  const base = appBaseUrl.replace(/\/+$/, '');
  return `${base}/${kind}/${id}`;
}
