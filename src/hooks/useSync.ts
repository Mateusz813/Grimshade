import { useCallback, useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { syncToCloud } from '../storage/gameStorage';
import { useSyncStore } from '../stores/syncStore';
import { getActiveCharacterId, saveCurrentCharacterStores } from '../stores/characterScope';
import { SYNC_INTERVAL_MS, shouldSyncOnReconnect } from '../systems/syncSystem';

export const useSync = () => {
  const { isOnline, isSyncing, lastSynced, setSyncing, setLastSynced } = useSyncStore(useShallow((s) => ({ isOnline: s.isOnline, isSyncing: s.isSyncing, lastSynced: s.lastSynced, setSyncing: s.setSyncing, setLastSynced: s.setLastSynced })));

  const doSync = useCallback(async () => {
    if (!isOnline || isSyncing) return;

    const charId = getActiveCharacterId();
    if (!charId) return;

    setSyncing(true);
    try {
      await saveCurrentCharacterStores();
      await syncToCloud(charId);
      setLastSynced(new Date().toISOString());
    } catch {
    } finally {
      setSyncing(false);
    }
  }, [isOnline, isSyncing, setSyncing, setLastSynced]);

  useEffect(() => {
    const id = setInterval(() => {
      void doSync();
    }, SYNC_INTERVAL_MS);
    return () => clearInterval(id);
  }, [doSync]);

  useEffect(() => {
    if (isOnline && shouldSyncOnReconnect(lastSynced)) {
      void doSync();
    }
  }, [isOnline]);

  return { isOnline, isSyncing, lastSynced, doSync };
};
