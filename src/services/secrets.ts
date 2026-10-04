import { getSetting, setSetting } from '../db/repos';
import type { FinanceDb } from '../db/schema';

/**
 * Settings that hold a secret (the Finnhub key) are stored encrypted with AES-256-GCM. The key is a
 * non-extractable WebCrypto key kept in its own IndexedDB database, never in the app database, so it
 * is not part of backups and page code cannot read its bytes.
 */

const KEY_DB = 'myfinance-keys';
const KEY_STORE = 'keys';
const KEY_ID = 'device';

interface Sealed {
  iv: string;
  data: string;
}

function isSealed(value: unknown): value is Sealed {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Sealed).iv === 'string' &&
    typeof (value as Sealed).data === 'string'
  );
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function openKeyDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(KEY_DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(KEY_STORE);
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
}

/** The device key, created on first use. Two tabs racing end up with whichever was stored first. */
async function deviceKey(): Promise<CryptoKey> {
  const candidate = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
  const keyDb = await openKeyDb();
  try {
    const store = keyDb.transaction(KEY_STORE, 'readwrite').objectStore(KEY_STORE);
    const existing = (await request(store.get(KEY_ID))) as CryptoKey | undefined;
    if (existing !== undefined) return existing;
    await request(store.put(candidate, KEY_ID));
    return candidate;
  } finally {
    keyDb.close();
  }
}

const toBase64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));
const fromBase64 = (text: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(atob(text), (char) => char.charCodeAt(0));

/** Binds a ciphertext to its setting, so it cannot be moved under another name. */
const aad = (name: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(`myfinance:${name}`);

async function seal(name: string, plaintext: string): Promise<Sealed> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aad(name) },
    await deviceKey(),
    new TextEncoder().encode(plaintext),
  );
  return { iv: toBase64(iv), data: toBase64(new Uint8Array(data)) };
}

async function open(name: string, sealed: Sealed): Promise<string> {
  const data = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(sealed.iv), additionalData: aad(name) },
    await deviceKey(),
    fromBase64(sealed.data),
  );
  return new TextDecoder().decode(data);
}

/** Stores a secret setting encrypted; an empty value clears it. */
export async function saveSecret(db: FinanceDb, name: string, value: string): Promise<void> {
  await setSetting(db, name, value === '' ? '' : await seal(name, value));
}

/**
 * Reads a secret setting; '' when unset or unreadable. A plaintext value (from before secrets were
 * encrypted, or just restored from a backup) is encrypted in place on the way through.
 */
export async function loadSecret(db: FinanceDb, name: string): Promise<string> {
  const stored = await getSetting<unknown>(db, name, '');
  if (typeof stored === 'string') {
    if (stored !== '') await saveSecret(db, name, stored);
    return stored;
  }
  if (!isSealed(stored)) return '';
  try {
    return await open(name, stored);
  } catch {
    return '';
  }
}
