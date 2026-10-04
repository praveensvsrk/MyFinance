import type { IsoDate, Paise } from '../../parsers/types';
import type { AccountKind, FinanceDb } from '../../db/schema';
import { newId, upsertAccount } from '../../db/repos';

export interface ManualAccountInput {
  kind: Extract<AccountKind, 'savings' | 'card'>;
  institution: string;
  maskedNumber: string;
  name?: string;
  /** Savings: cash in the account. Card: amount owed, stored negative. */
  balance: Paise;
  date: IsoDate;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 24) || 'bank';
}

/**
 * Creates a savings or card account typed in by hand, with one balance snapshot. Further
 * transactions come from a CSV/Excel import against the same institution and last four digits.
 */
export async function saveManualAccount(db: FinanceDb, input: ManualAccountInput): Promise<string> {
  const institution = input.institution.trim().slice(0, 40) || 'Bank';
  const last4 = input.maskedNumber.replace(/\D/g, '').slice(-4);
  const kind = input.kind;
  const id =
    kind === 'card'
      ? `${slug(institution)}-card-${last4 || newId().slice(0, 4)}`
      : `${slug(institution)}-${last4 || newId().slice(0, 4)}`;
  const name =
    input.name?.trim().slice(0, 40) ||
    (kind === 'card' ? `${institution} Credit Card` : `${institution} Savings`);
  const balance = kind === 'card' ? -Math.abs(input.balance) : input.balance;
  await db.transaction('rw', db.accounts, db.balanceSnapshots, async () => {
    await upsertAccount(db, {
      id,
      kind,
      institution,
      maskedNumber: last4,
      name,
      meta: { source: 'manual' },
    });
    await db.balanceSnapshots.put({
      accountId: id,
      date: input.date,
      balance,
      source: 'manual',
      importId: null,
    });
  });
  return id;
}
