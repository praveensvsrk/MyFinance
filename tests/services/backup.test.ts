import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getSetting } from '../../src/db/repos';
import {
  FinanceDb,
  SCHEMA_VERSION,
  TABLE_STORES,
  type AccountRow,
  type EpfEntryRow,
  type RuleRow,
  type SnapshotRow,
  type TableName,
  type TxnRow,
} from '../../src/db/schema';
import { todayIso } from '../../src/domain/dates';
import { CATEGORISER_VERSION } from '../../src/domain/categorise';
import {
  BackupError,
  exportBackup,
  restoreBackup,
  setKdfIterations,
} from '../../src/services/backup';
import { loadSecret, saveSecret } from '../../src/services/secrets';

const PASSPHRASE = 'correct horse battery staple';
const TABLE_NAMES = Object.keys(TABLE_STORES) as TableName[];

/** A structurally typed view of Dexie's `Table` so tests can iterate every table uniformly. */
interface AnyTable {
  toArray(): Promise<unknown[]>;
  count(): Promise<number>;
}

function tableOf(db: FinanceDb, name: TableName): AnyTable {
  return db[name] as unknown as AnyTable;
}

async function dumpAll(db: FinanceDb): Promise<Record<string, unknown[]>> {
  const dump: Record<string, unknown[]> = {};
  for (const name of TABLE_NAMES) {
    dump[name] = await tableOf(db, name).toArray();
  }
  return dump;
}

function account(id: string, name: string): AccountRow {
  return {
    id,
    kind: 'savings',
    institution: 'SBI',
    maskedNumber: '1234',
    name,
    meta: {},
  };
}

function txn(id: string, overrides: Partial<TxnRow> = {}): TxnRow {
  return {
    id,
    accountId: 'acct-1',
    date: '2026-04-02',
    description: 'UPI/DR/1/SHOP/5411',
    ref: '',
    amount: -100_000,
    balanceAfter: 9_900_000,
    category: 'Groceries',
    categorySource: 'rule',
    kind: 'normal',
    transferPairId: null,
    importId: 'imp-1',
    fingerprint: `fp-${id}`,
    ...overrides,
  };
}

function snapshot(): SnapshotRow {
  return {
    accountId: 'acct-1',
    date: '2026-04-30',
    balance: 9_550_000,
    source: 'statement',
    importId: 'imp-1',
  };
}

function epfEntry(): EpfEntryRow {
  return {
    accountId: 'epf-12345',
    fy: 2026,
    kind: 'contribution',
    creditDate: '2026-05-01',
    ee: 100_000,
    er: 100_000,
    eps: 0,
    importId: 'imp-1',
  };
}

function rule(): RuleRow {
  return { id: 'rule-1', pattern: 'GROCERY', isRegex: false, category: 'Groceries', priority: 5 };
}

/** Seven populated tables and ten rows in total. */
async function seed(db: FinanceDb): Promise<void> {
  await db.accounts.bulkAdd([account('acct-1', 'SBI savings'), account('acct-2', 'Other savings')]);
  await db.transactions.bulkAdd([txn('txn-1'), txn('txn-2', { amount: 50_000, kind: 'normal' })]);
  await db.balanceSnapshots.add(snapshot());
  await db.epfEntries.add(epfEntry());
  await db.prices.put({ symbol: 'ACME', date: '2026-04-30', value: 20_000, source: 'api' });
  await db.rules.add(rule());
  await saveSecret(db, 'finnhubKey', 'key-123');
}

function freshDb(): FinanceDb {
  return new FinanceDb(`myfinance-backup-${crypto.randomUUID()}`);
}

let source: FinanceDb;
let target: FinanceDb;

beforeEach(async () => {
  // Keep every test fast; the format only records the count in the envelope.
  setKdfIterations(1000);
  source = freshDb();
  target = freshDb();
  await source.open();
  await target.open();
});

afterEach(async () => {
  await source.delete();
  await target.delete();
});

describe('encrypted backup', () => {
  it('round-trips every table into a fresh database', async () => {
    await seed(source);
    const settingsBeforeExport = await source.settings.toArray();

    const bytes = await exportBackup(source, PASSPHRASE);
    const result = await restoreBackup(target, bytes, PASSPHRASE);

    expect(result).toEqual({ tables: 7, rows: 10 });
    for (const name of TABLE_NAMES.filter((table) => table !== 'settings')) {
      expect(await tableOf(target, name).toArray()).toEqual(await tableOf(source, name).toArray());
    }
    // `lastBackupAt` is stored before the dump, so the backup carries its own date. The secret is
    // sealed afresh in the target, so only its decrypted value is compared.
    const withoutSecret = (rows: { key: string }[]) => rows.filter((row) => row.key !== 'finnhubKey');
    expect(withoutSecret(await target.settings.toArray())).toEqual(
      [
        ...withoutSecret(settingsBeforeExport),
        { key: 'lastBackupAt', value: todayIso() },
        // Set by the re-filing a restore runs.
        { key: 'categoriserVersion', value: CATEGORISER_VERSION },
        { key: 'familyBackfillDone', value: true },
      ].sort((a, b) =>
        a.key < b.key ? -1 : 1,
      ),
    );
    expect(await loadSecret(target, 'finnhubKey')).toBe('key-123');
    expect(JSON.stringify(await getSetting(target, 'finnhubKey', ''))).not.toContain('key-123');
  });

  it('files rows an older categoriser left on Other', async () => {
    await source.transactions.add(
      txn('txn-old', { description: 'WDL TFR UPI/DR/611663677972/BLINKIT/HDFC/blinkit1.p/Blink', category: 'Other', categorySource: 'default' }),
    );
    await restoreBackup(target, await exportBackup(source, PASSPHRASE), PASSPHRASE);
    expect((await target.transactions.get('txn-old'))?.category).toBe('Groceries');
  });

  it('drops a statement password saved by an older version', async () => {
    await seed(source);
    await source.settings.put({ key: 'passwords', value: { sbi: 'old-pass' } });
    await restoreBackup(target, await exportBackup(source, PASSPHRASE), PASSPHRASE);
    expect(await target.settings.get('passwords')).toBeUndefined();
  });

  it('rejects a backup that asks for an absurd number of key-derivation rounds', async () => {
    await seed(source);
    const envelope = JSON.parse(new TextDecoder().decode(await exportBackup(source, PASSPHRASE)));
    envelope.kdf.iterations = 2_000_000_000;
    await expect(
      restoreBackup(target, new TextEncoder().encode(JSON.stringify(envelope)), PASSPHRASE),
    ).rejects.toMatchObject({ reason: 'decrypt' });
  });

  it('throws BackupError(decrypt) for a wrong passphrase and leaves existing data unchanged', async () => {
    await seed(source);
    const bytes = await exportBackup(source, PASSPHRASE);
    await seed(target);
    const before = await dumpAll(target);

    const failure = await restoreBackup(target, bytes, 'not the passphrase').then(
      () => null,
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(BackupError);
    expect((failure as BackupError).reason).toBe('decrypt');
    expect(await dumpAll(target)).toEqual(before);
  });

  it('throws BackupError(decrypt) for a truncated file', async () => {
    await seed(source);
    const bytes = await exportBackup(source, PASSPHRASE);
    const truncated = bytes.slice(0, bytes.length - 25);

    const failure = await restoreBackup(target, truncated, PASSPHRASE).then(
      () => null,
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(BackupError);
    expect((failure as BackupError).reason).toBe('decrypt');
    expect(await target.accounts.count()).toBe(0);
  });

  it('sets lastBackupAt to today on export', async () => {
    expect(await getSetting(source, 'lastBackupAt', null)).toBeNull();

    await exportBackup(source, PASSPHRASE);

    expect(await getSetting(source, 'lastBackupAt', null)).toBe(todayIso());
  });

  it('marks a newer schema as BackupError(newer) without touching the db', async () => {
    await seed(source);
    const bytes = await exportBackup(source, PASSPHRASE);
    const envelope = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
    envelope.schema = SCHEMA_VERSION + 1;
    const patched = new TextEncoder().encode(JSON.stringify(envelope));

    const failure = await restoreBackup(target, patched, PASSPHRASE).then(
      () => null,
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(BackupError);
    expect((failure as BackupError).reason).toBe('newer');
    expect(await target.accounts.count()).toBe(0);
  });

  it('records the overridden KDF parameters in the envelope and restores with them', async () => {
    setKdfIterations(1000);
    await seed(source);

    const bytes = await exportBackup(source, PASSPHRASE);
    const envelope = JSON.parse(new TextDecoder().decode(bytes)) as {
      app: string;
      v: number;
      schema: number;
      kdf: { name: string; hash: string; iterations: number; salt: string };
      iv: string;
      data: string;
    };

    expect(envelope).toMatchObject({ app: 'myfinance', v: 1, schema: SCHEMA_VERSION });
    expect(envelope.kdf.name).toBe('PBKDF2');
    expect(envelope.kdf.hash).toBe('SHA-256');
    expect(envelope.kdf.iterations).toBe(1000);
    expect(envelope.kdf.salt).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(envelope.iv).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(envelope.data).toMatch(/^[A-Za-z0-9+/]+=*$/);
    await expect(restoreBackup(target, bytes, PASSPHRASE)).resolves.toEqual({ tables: 7, rows: 10 });
  });

  it('leaves lastBackupAt as it was when the export fails', async () => {
    await seed(source);
    await source.settings.put({ key: 'lastBackupAt', value: '2026-01-01' });
    setKdfIterations(0); // makes key derivation, and so the export, throw
    await expect(exportBackup(source, PASSPHRASE)).rejects.toThrow();
    expect(await getSetting(source, 'lastBackupAt', null)).toBe('2026-01-01');
  });
});
