import { useState } from 'react';
import { Sheet } from '../common/Sheet';
import { AttentionList } from '../home/AttentionCard';
import { useHome } from '../hooks';
import { Icon } from '../Icon';

/** The attention items that feed the bell badge and the Notifications sheet. */
export function useNotifications() {
  const home = useHome();
  return home.data?.attention ?? [];
}

/** The header bell with a red unread-count badge; opens the Notifications sheet. */
export function NotificationsBell() {
  const items = useNotifications();
  const [open, setOpen] = useState(false);
  const count = items.length;
  return (
    <>
      <button
        type="button"
        className="ib"
        aria-label={count === 0 ? 'Notifications' : `Notifications, ${count} new`}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <Icon name="bell" size={20} />
        {count > 0 && (
          <span className="badge" aria-hidden="true">
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>
      {open && (
        <Sheet title="Notifications" subtitle={count === 0 ? undefined : `${count} need${count === 1 ? 's' : ''} your attention`} onClose={() => setOpen(false)} testId="notifications">
          {count === 0 ? (
            <p className="muted" style={{ padding: '16px 0' }}>
              You’re all caught up.
            </p>
          ) : (
            <AttentionList items={items} onNavigate={() => setOpen(false)} />
          )}
        </Sheet>
      )}
    </>
  );
}
