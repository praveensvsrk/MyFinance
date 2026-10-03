import type { AccountKind } from '../../db/schema';
import type { IconName } from '../Icon';

export const KIND_META: Record<AccountKind, { icon: IconName; label: string }> = {
  savings: { icon: 'bank', label: 'Savings account' },
  ppf: { icon: 'shield', label: 'PPF' },
  epf: { icon: 'shield', label: 'EPF' },
  mf: { icon: 'layers', label: 'Mutual funds' },
  equity: { icon: 'trend', label: 'Employer shares' },
  loan: { icon: 'loan', label: 'Home loan' },
  cash: { icon: 'wallet', label: 'Cash' },
};
