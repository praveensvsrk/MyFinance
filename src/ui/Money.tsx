import { formatInr, formatUsd } from '../domain/money';
import { useApp } from './AppContext';
import { MASK } from './format';

/** An amount in integer paise, Indian-grouped and masked when "hide amounts" is on. */
export function Money({
  paise,
  compact = false,
  sign = false,
}: {
  paise: number;
  compact?: boolean;
  sign?: boolean;
}) {
  const { hideAmounts } = useApp();
  return <span className="money">{hideAmounts ? MASK : formatInr(paise, { compact, sign })}</span>;
}

/** An amount in integer US cents (RSU values), masked like `Money`. */
export function Usd({ cents }: { cents: number }) {
  const { hideAmounts } = useApp();
  return <span className="money">{hideAmounts ? MASK : formatUsd(cents)}</span>;
}
