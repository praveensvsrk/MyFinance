import { useAccounts } from '../hooks';
import { Debug } from './Debug';

export function Accounts() {
  return <Debug title="Accounts" query={useAccounts()} />;
}
