// ── Sync system – pure functions ──────────────────────────────────────────────

export const SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Returns true if a sync is overdue (never synced, or interval elapsed).
 */
export const needsSync = (
  lastSynced: string | null,
  intervalMs: number = SYNC_INTERVAL_MS,
): boolean => {
  if (!lastSynced) return true;
  const elapsed = Date.now() - new Date(lastSynced).getTime();
  return elapsed >= intervalMs;
};

/**
 * Returns milliseconds until the next sync is due.
 * Returns 0 if sync is already overdue.
 */
export const getNextSyncMs = (
  lastSynced: string | null,
  intervalMs: number = SYNC_INTERVAL_MS,
): number => {
  if (!lastSynced) return 0;
  const elapsed = Date.now() - new Date(lastSynced).getTime();
  return Math.max(0, intervalMs - elapsed);
};

/**
 * Formats a UTC ISO timestamp into a human-readable relative string (PL/EN).
 * Returns 'never' equivalent when null.
 */
export const formatLastSynced = (lastSynced: string | null): string => {
  if (!lastSynced) return '—';
  const diff = Date.now() - new Date(lastSynced).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 5) return 'przed chwilą';
  if (secs < 60) return `${secs}s temu`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} min temu`;
  const hrs = Math.floor(mins / 60);
  return `${hrs} godz. temu`;
};

/**
 * Determines whether the online→sync should actually fire
 * (avoids hammering the server when coming back online repeatedly).
 */
export const shouldSyncOnReconnect = (
  lastSynced: string | null,
  minGapMs: number = 30_000,
): boolean => {
  if (!lastSynced) return true;
  const elapsed = Date.now() - new Date(lastSynced).getTime();
  return elapsed >= minGapMs;
};
