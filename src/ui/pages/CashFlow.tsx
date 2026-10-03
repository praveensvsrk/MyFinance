import { useApp } from '../AppContext';
import { useCashFlow } from '../hooks';
import { Debug } from './Debug';

export function CashFlow() {
  const { today } = useApp();
  return <Debug title="Cash flow" query={useCashFlow(today.slice(0, 7))} />;
}
