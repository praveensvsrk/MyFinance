import { useUpdatePrompt } from '../../pwa/useUpdatePrompt';

/** Presentational part, so the banner can be tested without a service worker. */
export function UpdateBannerView({
  needRefresh,
  offlineReady,
  onUpdate,
  onDismiss,
}: {
  needRefresh: boolean;
  offlineReady: boolean;
  onUpdate: () => void;
  onDismiss: () => void;
}) {
  if (!needRefresh && !offlineReady) return null;
  return (
    <div role="status" className="update-banner">
      {needRefresh ? (
        <>
          <span>Update available</span>
          <button type="button" onClick={onUpdate}>
            Reload
          </button>
        </>
      ) : (
        <span>Ready to work offline</span>
      )}
      <button type="button" onClick={onDismiss} aria-label="Dismiss">
        ✕
      </button>
    </div>
  );
}

/** "Update available — Reload" and "Ready to work offline", driven by the service worker. */
export function UpdateBanner() {
  const { needRefresh, offlineReady, update, dismiss } = useUpdatePrompt();
  return <UpdateBannerView needRefresh={needRefresh} offlineReady={offlineReady} onUpdate={update} onDismiss={dismiss} />;
}
