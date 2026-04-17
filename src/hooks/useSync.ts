import { useCallback, useEffect } from 'react';
import { syncToCloud } from '../storage/gameStorage';
import { useSyncStore } from '../stores/syncStore';
import { getActiveCharacterId, saveCurrentCharacterStores } from '../stores/characterScope';
import { SYNC_INTERVAL_MS, shouldSyncOnReconnect } from '../systems/syncSystem';

/**
 * Sets up automatic 5-minute cloud sync and provides a manual sync trigger.
 * Syncs current character's store data to Supabase.
 * Must be mounted once at the app root level (App.tsx).
 */
export const useSync = () => {
  const { isOnline, isSyncing, lastSynced, setSyncing, setLastSynced } = useSyncStore();

  const doSync = useCallback(async () => {
    if (!isOnline || isSyncing) return;

    const charId = getActiveCharacterId();
    if (!charId) return;

    setSyncing(true);
    try {
      // First save current stores to localStorage
      await saveCurrentCharacterStores();
      // Then push to Supabase
      await syncToCloud(charId);
      setLastSynced(new Date().toISOString());
    } catch {
      // silent – user is notified via isOnline indicator
    } finally {
      setSyncing(false);
    }
  }, [isOnline, isSyncing, setSyncing, setLastSynced]);

  // Auto-sync every 5 minutes
  useEffect(() => {
    const id = setInterval(() => {
      void doSync();
    }, SYNC_INTERVAL_MS);
    return () => clearInterval(id);
  }, [doSync]);

  // Sync when coming back online (with de-bounce guard)
  useEffect(() => {
    if (isOnline && shouldSyncOnReconnect(lastSynced)) {
      void doSync();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline]);

  return { isOnline, isSyncing, lastSynced, doSync };
};
