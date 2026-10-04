import { useId, useState, type ReactNode } from 'react';

/** One row of the Projections list; opens its calculator inline underneath. */
export function ProjectionRow({
  badge,
  badgeClass,
  title,
  sub,
  children,
}: {
  badge: ReactNode;
  badgeClass: string;
  title: string;
  sub: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const panel = useId();
  return (
    <li className="proj-item">
      <button type="button" className="proj-row" aria-expanded={open} aria-controls={panel} onClick={() => setOpen((v) => !v)}>
        <span className={`proj-badge ${badgeClass}`}>{badge}</span>
        <span className="proj-mid">
          <span className="proj-ttl">{title}</span>
          <span className="proj-sub">{sub}</span>
        </span>
        <svg className={open ? 'proj-chev open' : 'proj-chev'} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M9 6l6 6-6 6" />
        </svg>
      </button>
      {open && (
        <div id={panel} className="proj-panel">
          {children}
        </div>
      )}
    </li>
  );
}
