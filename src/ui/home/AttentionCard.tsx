import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { Attention, AttentionKind } from '../../domain/attention';
import { Icon, type IconName } from '../Icon';

const ICON: Record<AttentionKind, IconName> = {
  'stale-bank': 'bank',
  'stale-epf': 'shield',
  'stale-cas': 'file',
  'backup-overdue': 'shield',
  'price-failed': 'trend',
  'unverified-import': 'alert',
  'stale-provisional': 'repeat',
  'storage-not-persisted': 'db',
  'etrade-mismatch': 'alert',
};

const SHOWN = 3;

/** Things that need the user's attention, three at a time. */
export function AttentionCard({ items }: { items: Attention[] }) {
  const [open, setOpen] = useState(false);
  if (items.length === 0) return null;
  const visible = open ? items : items.slice(0, SHOWN);
  const more = items.length - SHOWN;

  return (
    <section className="att-card" aria-labelledby="att-h">
      <h2 id="att-h">
        <Icon name="alert" size={20} />
        Needs attention
        <span className="tag warn" style={{ marginLeft: 'auto' }}>
          {items.length}
        </span>
      </h2>
      {visible.map((item) => (
        <Link key={item.id} to={item.target} className="att">
          <span className="a-ic">
            <Icon name={ICON[item.kind]} size={18} />
          </span>
          <span className="a-msg">{item.message}</span>
          <span className="chev">
            <Icon name="chevron" size={20} />
          </span>
        </Link>
      ))}
      {more > 0 && (
        <button type="button" className="link" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? 'Show less' : `${more} more`}
        </button>
      )}
    </section>
  );
}
