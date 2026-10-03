import { formatInr, formatUsd } from '../domain/money';
import { useApp } from './AppContext';
import { MASK } from './format';

/** The masked form of an amount: dots on screen, "hidden" for screen readers, never the figure. */
function Masked() {
  return (
    <span className="money mask">
      {MASK}
      <span className="sr"> hidden</span>
    </span>
  );
}

/** An amount in integer paise, Indian-grouped and masked when "hide amounts" is on. */
export function Money({
  paise,
  compact = false,
  sign = false,
  whole = false,
}: {
  paise: number;
  compact?: boolean;
  sign?: boolean;
  /** Round to whole rupees, for headline figures. */
  whole?: boolean;
}) {
  const { hideAmounts } = useApp();
  if (hideAmounts) return <Masked />;
  return <span className="money">{formatInr(paise, { compact, sign, whole })}</span>;
}

/** An amount in integer US cents (RSU values), masked like `Money`. */
export function Usd({ cents }: { cents: number }) {
  const { hideAmounts } = useApp();
  if (hideAmounts) return <Masked />;
  return <span className="money">{formatUsd(cents)}</span>;
}
