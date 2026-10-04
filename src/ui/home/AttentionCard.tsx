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

/** The attention items (backup reminder, stale statements, ...) as rows. Rendered inside the Notifications sheet. */
export function AttentionList({ items, onNavigate }: { items: Attention[]; onNavigate?: () => void }) {
  return (
    <div className="notif-list">
      {items.map((item) => (
        <Link key={item.id} to={item.target} className="notif" onClick={onNavigate}>
          <span className="a-ic">
            <Icon name={ICON[item.kind]} size={20} />
          </span>
          <span className="a-msg">{item.message}</span>
          <span className="chev">
            <Icon name="chevron" size={20} />
          </span>
        </Link>
      ))}
    </div>
  );
}
