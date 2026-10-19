/**
 * Secret encryption for the F5 path (M-2). A secret value never reaches the database: the Edge
 * Function encrypts it here and stores only a reference plus a mask.
 *
 *   - Vault present: the value goes to vault.create_secret and the row keeps the vault id only.
 *   - Vault absent: AES-256-GCM with a 12-byte nonce, key from the Edge Function secret
 *     SECRETS_MASTER_KEY (32 bytes, base64). The stored ciphertext is base64(nonce || ciphertext ||
 *     tag), so the nonce travels with the value and no state is kept in the database.
 *
 * Pure and injectable: WebCrypto is passed in, so the module is unit-tested under Node without a
 * Deno runtime. No randomness outside the injected crypto (L1 does not ban a random nonce: the nonce
 * is not audit logic, and it must be unique per encryption).
 */

export interface CryptoLike {
  getRandomValues(array: Uint8Array): Uint8Array;
  subtle: {
    importKey(
      format: 'raw', keyData: Uint8Array, algorithm: { name: string },
      extractable: boolean, keyUsages: string[]
    ): Promise<unknown>;
    encrypt(
      algorithm: { name: string; iv: Uint8Array }, key: unknown, data: Uint8Array
    ): Promise<ArrayBuffer>;
    decrypt(
      algorithm: { name: string; iv: Uint8Array }, key: unknown, data: Uint8Array
    ): Promise<ArrayBuffer>;
  };
}

const NONCE_BYTES = 12;
const KEY_BYTES = 32;

/** Decode the base64 master key and check it is exactly 32 bytes. Throws a plain message. */
export function decodeMasterKey(base64: string): Uint8Array {
  let bytes: Uint8Array;
  try {
    const binary = atob(base64.trim());
    bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  } catch {
    throw new Error('SECRETS_MASTER_KEY is not valid base64.');
  }
  if (bytes.length !== KEY_BYTES) {
    throw new Error(`SECRETS_MASTER_KEY must decode to ${KEY_BYTES} bytes (got ${bytes.length}).`);
  }
  return bytes;
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/** Encrypt a value. Returns base64(nonce || ciphertext || tag). The value is never returned. */
export async function encryptSecret(
  value: string, masterKey: Uint8Array, crypto: CryptoLike
): Promise<string> {
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const key = await crypto.subtle.importKey('raw', masterKey, { name: 'AES-GCM' }, false, ['encrypt']);
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, new TextEncoder().encode(value))
  );
  const combined = new Uint8Array(nonce.length + sealed.length);
  combined.set(nonce, 0);
  combined.set(sealed, nonce.length);
  return toBase64(combined);
}

/** Decrypt base64(nonce || ciphertext || tag). A wrong key throws, so a tampered value fails closed. */
export async function decryptSecret(
  stored: string, masterKey: Uint8Array, crypto: CryptoLike
): Promise<string> {
  const combined = fromBase64(stored);
  if (combined.length <= NONCE_BYTES) throw new Error('The stored secret is malformed.');
  const nonce = combined.slice(0, NONCE_BYTES);
  const sealed = combined.slice(NONCE_BYTES);
  const key = await crypto.subtle.importKey('raw', masterKey, { name: 'AES-GCM' }, false, ['decrypt']);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, sealed);
  return new TextDecoder().decode(plain);
}

/**
 * The masked display the database is allowed to hold: only the last four characters. The full value
 * never reaches the database, so the mask is computed here and passed in as `p_masked` (F5).
 */
export function maskValue(value: string | null | undefined): string {
  if (value === null || value === undefined || value.length === 0) return '•••• not set';
  return '•••• ' + value.slice(Math.max(0, value.length - 4));
}
