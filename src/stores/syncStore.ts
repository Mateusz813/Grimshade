import { create } from 'zustand';

interface ISyncState {
  isOnline: boolean;
  lastSynced: string | null;
  isSyncing: boolean;
  setOnline: (online: boolean) => void;
  setLastSynced: (ts: string) => void;
  setSyncing: (syncing: boolean) => void;
}

export const useSyncStore = create<ISyncState>((set) => ({
  isOnline: navigator.onLine,
  lastSynced: null,
  isSyncing: false,
  setOnline:     (isOnline)    => set({ isOnline }),
  setLastSynced: (lastSynced)  => set({ lastSynced }),
  setSyncing:    (isSyncing)   => set({ isSyncing }),
}));

window.addEventListener('online',  () => useSyncStore.getState().setOnline(true));
window.addEventListener('offline', () => useSyncStore.getState().setOnline(false));
