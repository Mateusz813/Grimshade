import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  SYNC_INTERVAL_MS,
  needsSync,
  getNextSyncMs,
  formatLastSynced,
  shouldSyncOnReconnect,
} from './syncSystem';

describe('SYNC_INTERVAL_MS', () => {
  it('should be 5 minutes in milliseconds', () => {
    expect(SYNC_INTERVAL_MS).toBe(5 * 60 * 1000);
  });
});

describe('needsSync', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns true when lastSynced is null', () => {
    expect(needsSync(null)).toBe(true);
  });

  it('returns true when interval has elapsed', () => {
    const lastSynced = new Date('2025-01-01T11:50:00Z').toISOString(); // 10 min ago
    expect(needsSync(lastSynced, 5 * 60 * 1000)).toBe(true);
  });

  it('returns false when synced recently', () => {
    const lastSynced = new Date('2025-01-01T11:58:00Z').toISOString(); // 2 min ago
    expect(needsSync(lastSynced, 5 * 60 * 1000)).toBe(false);
  });

  it('returns true exactly at the interval boundary', () => {
    const lastSynced = new Date('2025-01-01T11:55:00Z').toISOString(); // exactly 5 min ago
    expect(needsSync(lastSynced, 5 * 60 * 1000)).toBe(true);
  });

  it('respects custom interval', () => {
    const lastSynced = new Date('2025-01-01T11:59:30Z').toISOString(); // 30s ago
    expect(needsSync(lastSynced, 60_000)).toBe(false);
    expect(needsSync(lastSynced, 20_000)).toBe(true);
  });
});

describe('getNextSyncMs', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns 0 when lastSynced is null', () => {
    expect(getNextSyncMs(null)).toBe(0);
  });

  it('returns 0 when sync is overdue', () => {
    const lastSynced = new Date('2025-01-01T11:50:00Z').toISOString();
    expect(getNextSyncMs(lastSynced)).toBe(0);
  });

  it('returns remaining ms when sync is not yet due', () => {
    const lastSynced = new Date('2025-01-01T11:57:00Z').toISOString(); // 3 min ago
    const remaining = getNextSyncMs(lastSynced);
    expect(remaining).toBeCloseTo(2 * 60 * 1000, -100); // ~2 minutes left
    expect(remaining).toBeGreaterThan(0);
  });
});

describe('formatLastSynced', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns "—" when null', () => {
    expect(formatLastSynced(null)).toBe('—');
  });

  it('returns "przed chwilą" for very recent syncs', () => {
    const ts = new Date('2025-01-01T11:59:58Z').toISOString(); // 2s ago
    expect(formatLastSynced(ts)).toBe('przed chwilą');
  });

  it('returns seconds ago for recent syncs', () => {
    const ts = new Date('2025-01-01T11:59:30Z').toISOString(); // 30s ago
    expect(formatLastSynced(ts)).toContain('s temu');
  });

  it('returns minutes ago for older syncs', () => {
    const ts = new Date('2025-01-01T11:57:00Z').toISOString(); // 3 min ago
    expect(formatLastSynced(ts)).toContain('min temu');
  });

  it('returns hours ago for very old syncs', () => {
    const ts = new Date('2025-01-01T10:00:00Z').toISOString(); // 2h ago
    expect(formatLastSynced(ts)).toContain('godz. temu');
  });
});

describe('shouldSyncOnReconnect', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns true when lastSynced is null', () => {
    expect(shouldSyncOnReconnect(null)).toBe(true);
  });

  it('returns true when gap has elapsed', () => {
    const ts = new Date('2025-01-01T11:59:00Z').toISOString(); // 60s ago
    expect(shouldSyncOnReconnect(ts, 30_000)).toBe(true);
  });

  it('returns false when synced too recently', () => {
    const ts = new Date('2025-01-01T11:59:50Z').toISOString(); // 10s ago
    expect(shouldSyncOnReconnect(ts, 30_000)).toBe(false);
  });
});
