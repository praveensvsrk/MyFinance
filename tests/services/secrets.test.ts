import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getSetting, setSetting } from '../../src/db/repos';
import { FinanceDb } from '../../src/db/schema';
import { loadSecret, saveSecret } from '../../src/services/secrets';

let db: FinanceDb;

beforeEach(async () => {
  db = new FinanceDb(`test-secrets-${crypto.randomUUID()}`);
  await db.open();
});

afterEach(async () => {
  await db.delete();
});

describe('secret settings', () => {
  it('stores a secret encrypted and reads it back', async () => {
    await saveSecret(db, 'finnhubKey', 'abc-123');
    const stored = await getSetting<unknown>(db, 'finnhubKey', '');
    expect(JSON.stringify(stored)).not.toContain('abc-123');
    expect(await loadSecret(db, 'finnhubKey')).toBe('abc-123');
  });

  it('uses a fresh IV each time', async () => {
    await saveSecret(db, 'finnhubKey', 'abc-123');
    const first = await getSetting<unknown>(db, 'finnhubKey', '');
    await saveSecret(db, 'finnhubKey', 'abc-123');
    expect(await getSetting<unknown>(db, 'finnhubKey', '')).not.toEqual(first);
  });

  it('encrypts a plaintext value in place when it is first read', async () => {
    await setSetting(db, 'finnhubKey', 'legacy-key');
    expect(await loadSecret(db, 'finnhubKey')).toBe('legacy-key');
    expect(JSON.stringify(await getSetting<unknown>(db, 'finnhubKey', ''))).not.toContain('legacy-key');
    expect(await loadSecret(db, 'finnhubKey')).toBe('legacy-key');
  });

  it('clears on an empty value and reads unset as empty', async () => {
    expect(await loadSecret(db, 'finnhubKey')).toBe('');
    await saveSecret(db, 'finnhubKey', 'abc-123');
    await saveSecret(db, 'finnhubKey', '');
    expect(await loadSecret(db, 'finnhubKey')).toBe('');
  });

  it('refuses a ciphertext moved under another setting name', async () => {
    await saveSecret(db, 'finnhubKey', 'abc-123');
    await setSetting(db, 'other', await getSetting<unknown>(db, 'finnhubKey', ''));
    expect(await loadSecret(db, 'other')).toBe('');
  });

  it('reads as empty when the stored value cannot be decrypted', async () => {
    await setSetting(db, 'finnhubKey', { iv: 'AAAAAAAAAAAAAAAA', data: 'AAAA' });
    expect(await loadSecret(db, 'finnhubKey')).toBe('');
  });
});
