import type { ReactNode } from 'react';
import { Icon, type IconName } from '../Icon';

/** The design's empty state: tonal art tile, a heading, one line of help and an optional action. */
export function Empty({
  icon,
  title,
  children,
  action,
}: {
  icon: IconName;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="empty">
      <span className="art">
        <Icon name={icon} size={44} />
      </span>
      <h2>{title}</h2>
      {children !== undefined && <p>{children}</p>}
      {action}
    </section>
  );
}

/** Placeholder cards while a screen's first query resolves. */
export function ScreenSkeleton({ heights = [110, 220, 180] }: { heights?: number[] }) {
  return (
    <div className="stack gap16" aria-busy="true" aria-label="Loading">
      {heights.map((height, i) => (
        <div key={i} className="sk r" style={{ height }} />
      ))}
    </div>
  );
}
