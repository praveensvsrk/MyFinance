import { setSetting } from '../db/repos';
import { SCHEMA_VERSION, TABLE_STORES, type FinanceDb, type TableName } from '../db/schema';
import { todayIso } from '../domain/dates';

/** Backup envelope format version (the JSON shape, not the database schema). */
const ENVELOPE_VERSION = 1;
const APP_ID = 'myfinance';

/** PBKDF2 iterations used unless a test overrides them. */
const DEFAULT_KDF_ITERATIONS = 310_000;
let kdfIterations = DEFAULT_KDF_ITERATIONS;

/** Overrides the PBKDF2 iteration count; tests pass 1000 to stay fast. */
export function setKdfIterations(iterations: number): void {
  kdfIterations = iterations;
}

/** Why a restore could not proceed. */
export type BackupErrorReason = 'decrypt' | 'newer';

/** A restore failed: the file or passphrase is bad (`decrypt`) or the file is too new (`newer`). */
export class BackupError extends Error {
  readonly reason: BackupErrorReason;

  constructor(reason: BackupErrorReason, message: string) {
    super(message);
    this.name = 'BackupError';
    this.reason = reason;
  }
}

/** Table name → rows, exactly as stored inside the encrypted payload. */
export type BackupTables = Record<string, unknown[]>;

/** Migration step from schema version `n` to `n + 1`; empty until v2 exists. */
export const migrations: Record<number, (tables: BackupTables) => BackupTables> = {};

interface Envelope {
  app: string;
  v: number;
  schema: number;
  kdf: { name: string; hash: string; iterations: number; salt: string };
  iv: string;
  data: string;
}

const TABLE_NAMES = Object.keys(TABLE_STORES) as TableName[];

/** A structurally typed view of Dexie's `Table` so code can iterate every store uniformly. */
interface AnyTable {
  toArray(): Promise<unknown[]>;
  clear(): Promise<void>;
  bulkAdd(items: unknown[]): Promise<unknown>;
}

function tableOf(db: FinanceDb, name: TableName): AnyTable {
  return db[name] as unknown as AnyTable;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

// ---------- base64 (atob/btoa work in the browser and in Node 24) ----------

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// ---------- envelope ----------

function parseEnvelope(bytes: Uint8Array): Envelope {
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new BackupError('decrypt', 'The backup file is not valid JSON.');
  }
  if (!isRecord(raw) || raw.app !== APP_ID || typeof raw.v !== 'number') {
    throw new BackupError('decrypt', 'The file is not a MyFinance backup.');
  }
  if (raw.v > ENVELOPE_VERSION) {
    throw new BackupError('newer', `Backup format v${raw.v} is newer than this app supports.`);
  }
  const kdf: unknown = raw.kdf;
  if (
    raw.v !== ENVELOPE_VERSION ||
    typeof raw.schema !== 'number' ||
    !isRecord(kdf) ||
    kdf.name !== 'PBKDF2' ||
    kdf.hash !== 'SHA-256' ||
    typeof kdf.iterations !== 'number' ||
    typeof kdf.salt !== 'string' ||
    typeof raw.iv !== 'string' ||
    typeof raw.data !== 'string'
  ) {
    throw new BackupError('decrypt', 'The backup envelope is malformed.');
  }
  return raw as unknown as Envelope;
}

async function deriveKey(
  passphrase: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function dumpTables(db: FinanceDb): Promise<BackupTables> {
  const tables: BackupTables = {};
  for (const name of TABLE_NAMES) {
    tables[name] = await tableOf(db, name).toArray();
  }
  return tables;
}

async function encryptTables(passphrase: string, tables: BackupTables): Promise<Uint8Array> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, kdfIterations);
  const plaintext = new TextEncoder().encode(JSON.stringify({ tables }));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext),
  );
  const envelope: Envelope = {
    app: APP_ID,
    v: ENVELOPE_VERSION,
    schema: SCHEMA_VERSION,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: kdfIterations, salt: toBase64(salt) },
    iv: toBase64(iv),
    data: toBase64(ciphertext),
  };
  return new TextEncoder().encode(JSON.stringify(envelope));
}

async function decryptTables(envelope: Envelope, passphrase: string): Promise<BackupTables> {
  try {
    const key = await deriveKey(passphrase, fromBase64(envelope.kdf.salt), envelope.kdf.iterations);
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(envelope.iv) },
      key,
      fromBase64(envelope.data),
    );
    const payload: unknown = JSON.parse(new TextDecoder().decode(plaintext));
    if (!isRecord(payload) || !isRecord(payload.tables)) {
      throw new Error('payload has no tables');
    }
    return payload.tables as BackupTables;
  } catch (error) {
    if (error instanceof BackupError) throw error;
    throw new BackupError('decrypt', 'Wrong passphrase or corrupted backup file.');
  }
}

// ---------- public API ----------

/**
 * Encrypts every table (including the `passwords` setting) into a self-describing
 * envelope and records the export date in `lastBackupAt`.
 */
export async function exportBackup(db: FinanceDb, passphrase: string): Promise<Uint8Array> {
  const tables = await dumpTables(db);
  const bytes = await encryptTables(passphrase, tables);
  await setSetting(db, 'lastBackupAt', todayIso());
  return bytes;
}

/**
 * Decrypts a backup and replaces the database contents. The database is only
 * touched after the whole file decrypts and its schema version is accepted.
 */
export async function restoreBackup(
  db: FinanceDb,
  bytes: Uint8Array,
  passphrase: string,
): Promise<{ tables: number; rows: number }> {
  const envelope = parseEnvelope(bytes);
  let tables = await decryptTables(envelope, passphrase);
  if (envelope.schema > SCHEMA_VERSION) {
    throw new BackupError(
      'newer',
      `The backup uses schema v${envelope.schema}; this app supports v${SCHEMA_VERSION}.`,
    );
  }
  for (let version = envelope.schema; version < SCHEMA_VERSION; version++) {
    const migrate = migrations[version];
    if (migrate !== undefined) tables = migrate(tables);
  }

  let restoredTables = 0;
  let restoredRows = 0;
  await db.transaction('rw', db.tables, async () => {
    for (const name of TABLE_NAMES) {
      await tableOf(db, name).clear();
    }
    for (const name of TABLE_NAMES) {
      const rows = tables[name] ?? [];
      if (rows.length === 0) continue;
      await tableOf(db, name).bulkAdd(rows);
      restoredTables += 1;
      restoredRows += rows.length;
    }
  });
  return { tables: restoredTables, rows: restoredRows };
}
