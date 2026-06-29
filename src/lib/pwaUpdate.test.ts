import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the build-time virtual module so we can capture the options
// `initPwaAutoUpdate` passes to `registerSW`.
const { registerSWMock } = vi.hoisted(() => ({ registerSWMock: vi.fn() }));
vi.mock('virtual:pwa-register', () => ({ registerSW: registerSWMock }));

import { initPwaAutoUpdate } from './pwaUpdate';

type OnRegistered = (
  swScriptUrl: string,
  registration: { update: () => Promise<unknown> } | undefined,
) => void;

const getOnRegisteredSW = (): OnRegistered => {
  const opts = registerSWMock.mock.calls[0]?.[0] as { onRegisteredSW: OnRegistered };
  return opts.onRegisteredSW;
};

const setVisibility = (state: 'visible' | 'hidden'): void => {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
};

describe('pwaUpdate › initPwaAutoUpdate', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    registerSWMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('registers the service worker immediately', () => {
    initPwaAutoUpdate();
    expect(registerSWMock).toHaveBeenCalledTimes(1);
    const opts = registerSWMock.mock.calls[0][0];
    expect(opts.immediate).toBe(true);
    expect(typeof opts.onRegisteredSW).toBe('function');
  });

  it('checks for an update on the periodic interval', () => {
    initPwaAutoUpdate();
    const update = vi.fn().mockResolvedValue(undefined);
    getOnRegisteredSW()('/sw.js', { update });

    expect(update).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60_000);
    expect(update).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_000);
    expect(update).toHaveBeenCalledTimes(2);
  });

  it('checks for an update when the app becomes visible (reopened)', () => {
    initPwaAutoUpdate();
    const update = vi.fn().mockResolvedValue(undefined);
    getOnRegisteredSW()('/sw.js', { update });

    setVisibility('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(update).not.toHaveBeenCalled();

    setVisibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('checks for an update when connectivity is regained', () => {
    initPwaAutoUpdate();
    const update = vi.fn().mockResolvedValue(undefined);
    getOnRegisteredSW()('/sw.js', { update });

    window.dispatchEvent(new Event('online'));
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('does nothing extra when registration is undefined (e.g. dev / unsupported)', () => {
    initPwaAutoUpdate();
    // Must not throw when there is no registration object.
    expect(() => getOnRegisteredSW()('/sw.js', undefined)).not.toThrow();
    window.dispatchEvent(new Event('online'));
    // No registration -> no listeners wired, nothing to assert beyond no-throw.
  });

  it('swallows update() rejections (offline / mid-install)', async () => {
    initPwaAutoUpdate();
    const update = vi.fn().mockRejectedValue(new Error('offline'));
    getOnRegisteredSW()('/sw.js', { update });

    expect(() => {
      window.dispatchEvent(new Event('online'));
    }).not.toThrow();
    expect(update).toHaveBeenCalledTimes(1);
  });
});
