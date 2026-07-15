import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cachedRead, invalidateQueryCache } from './queryCache';

describe('queryCache', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        invalidateQueryCache();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('fetches on miss and serves cache within TTL', async () => {
        const fetcher = vi.fn().mockResolvedValue('A');
        expect(await cachedRead('k', 1000, fetcher)).toBe('A');
        expect(await cachedRead('k', 1000, fetcher)).toBe('A');
        expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it('refetches after TTL expiry', async () => {
        const fetcher = vi.fn().mockResolvedValueOnce('A').mockResolvedValueOnce('B');
        expect(await cachedRead('k', 1000, fetcher)).toBe('A');
        vi.setSystemTime(1001);
        expect(await cachedRead('k', 1000, fetcher)).toBe('B');
        expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it('keeps keys independent', async () => {
        const fA = vi.fn().mockResolvedValue('A');
        const fB = vi.fn().mockResolvedValue('B');
        expect(await cachedRead('a', 1000, fA)).toBe('A');
        expect(await cachedRead('b', 1000, fB)).toBe('B');
        expect(fA).toHaveBeenCalledTimes(1);
        expect(fB).toHaveBeenCalledTimes(1);
    });

    it('invalidateQueryCache(predicate) drops only matching keys', async () => {
        const f = vi.fn().mockResolvedValue('X');
        await cachedRead('deaths:1', 10_000, f);
        await cachedRead('market:1', 10_000, f);
        invalidateQueryCache((k) => k.startsWith('deaths'));
        await cachedRead('deaths:1', 10_000, f);
        await cachedRead('market:1', 10_000, f);
        expect(f).toHaveBeenCalledTimes(3);
    });

    it('invalidateQueryCache() clears everything', async () => {
        const f = vi.fn().mockResolvedValue('X');
        await cachedRead('k', 10_000, f);
        invalidateQueryCache();
        await cachedRead('k', 10_000, f);
        expect(f).toHaveBeenCalledTimes(2);
    });
});
