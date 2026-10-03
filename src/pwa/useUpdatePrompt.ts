import { useRegisterSW } from 'virtual:pwa-register/react';

/**
 * Service-worker lifecycle for the update banner. `update` activates the waiting worker and
 * reloads, so a new version only takes over when the user asks for it.
 */
export function useUpdatePrompt(): {
  needRefresh: boolean;
  offlineReady: boolean;
  update: () => void;
  dismiss: () => void;
} {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW();
  return {
    needRefresh,
    offlineReady,
    update: () => void updateServiceWorker(true),
    dismiss: () => {
      setNeedRefresh(false);
      setOfflineReady(false);
    },
  };
}
