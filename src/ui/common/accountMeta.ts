import type { AccountKind } from '../../db/schema';
import type { IconName } from '../Icon';

export type AccountTone = 'blue' | 'red' | 'indigo' | 'green' | 'amber' | 'grey';

export const KIND_META: Record<AccountKind, { icon: IconName; label: string; tone: AccountTone; useIcon: boolean }> = {
  savings: { icon: 'bank', label: 'Savings account', tone: 'blue', useIcon: false },
  card: { icon: 'wallet', label: 'Credit card', tone: 'red', useIcon: false },
  ppf: { icon: 'shield', label: 'PPF', tone: 'blue', useIcon: false },
  epf: { icon: 'shield', label: 'EPF', tone: 'indigo', useIcon: false },
  mf: { icon: 'layers', label: 'Mutual funds', tone: 'green', useIcon: false },
  equity: { icon: 'trend', label: 'Employer shares', tone: 'green', useIcon: false },
  loan: { icon: 'loan', label: 'Home loan', tone: 'red', useIcon: false },
  cash: { icon: 'wallet', label: 'Cash', tone: 'grey', useIcon: true },
  property: { icon: 'home', label: 'Home', tone: 'amber', useIcon: true },
};

/** Up to three capital letters that stand in for a logo: the kind for EPF/PPF/MF, else the institution. */
export function accountInitials(account: { kind: AccountKind; institution: string; name: string }): string {
  if (account.kind === 'epf') return 'EPF';
  if (account.kind === 'ppf') return 'PPF';
  if (account.kind === 'mf') return 'MF';
  const source = (account.institution || account.name).replace(/[^A-Za-z0-9 ]/g, '').trim();
  const words = source.split(/\s+/).filter((word) => word !== '');
  if (words.length === 0) return '·';
  return (words.length > 1 && words[0].length <= 2 ? words.map((w) => w[0]).join('') : words[0]).slice(0, 3).toUpperCase();
}
