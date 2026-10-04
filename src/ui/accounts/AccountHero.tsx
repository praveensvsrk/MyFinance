import type { ReactNode } from 'react';
import type { IsoDate, Paise } from '../../parsers/types';
import { TrendChart } from '../charts/TrendChart';

export interface StripItem {
  k: string;
  v: ReactNode;
  tone?: 'good' | 'bad';
}

/**
 * The value card every account page opens with: label, headline amount, change line, history chart with
 * range tabs, then a three-up strip. Kind-specific pieces arrive as props or children.
 */
export function AccountHero({
  eyebrow,
  title,
  subs = [],
  label,
  amount,
  amountTestId,
  delta,
  asOf,
  points,
  chartLabel,
  invested,
  strip = [],
  children,
}: {
  eyebrow?: ReactNode;
  title: string;
  subs?: ReactNode[];
  label: string;
  amount: ReactNode;
  amountTestId?: string;
  delta?: ReactNode;
  asOf?: ReactNode;
  points?: { date: IsoDate; balance: Paise }[];
  chartLabel?: string;
  /** A dashed reference line at this value (money put in). */
  invested?: Paise;
  strip?: StripItem[];
  children?: ReactNode;
}) {
  const hasChart = points !== undefined && points.length >= 2;
  return (
    <section className="card ad-hero" aria-labelledby="acct-h">
      {eyebrow}
      <h2 id="acct-h" className="ad-title">
        {title}
      </h2>
      {subs.map((sub, index) => (
        <span key={index} className="sub">
          {sub}
        </span>
      ))}
      <span className="k ad-label">{label}</span>
      <span className="ad-amt mono" data-testid={amountTestId}>
        {amount}
      </span>
      {delta !== undefined && <div className="ad-delta">{delta}</div>}
      {asOf !== undefined && <span className="asof">{asOf}</span>}
      {hasChart && (
        <div className="ad-chart">
          <TrendChart
            points={points.map((point) => ({ date: point.date, total: point.balance }))}
            label={chartLabel ?? 'History'}
            reference={invested}
            referenceLabel="Invested"
            initialRange="All"
          />
        </div>
      )}
      {strip.length > 0 && (
        <div className="ad-strip">
          {strip.map((item) => (
            <div key={item.k}>
              <div className="k">{item.k}</div>
              <div className={item.tone === undefined ? 'v mono' : `v mono ${item.tone}`}>{item.v}</div>
            </div>
          ))}
        </div>
      )}
      {children}
    </section>
  );
}
