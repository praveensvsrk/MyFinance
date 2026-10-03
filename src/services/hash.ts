/** Content hashing helpers. Hashes are lowercase hex SHA-256 digests. */

const encoder = new TextEncoder();

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

/** Lowercase-hex SHA-256 of the given bytes, using WebCrypto. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return toHex(new Uint8Array(digest));
}

/** SHA-256 of the parts joined with U+001F (unit separator), used for row dedupe. */
export function fingerprint(parts: (string | number)[]): Promise<string> {
  return sha256Hex(encoder.encode(parts.join('\u001f')));
}
