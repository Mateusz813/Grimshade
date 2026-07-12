
import { describe, it, expect } from 'vitest';
import { getLochBackground, getLochBossImage } from './guildLochAssets';


describe('getLochBackground', () => {
    it('returns a URL for every tier in 1..50', () => {
        for (let tier = 1; tier <= 50; tier++) {
            const url = getLochBackground(tier);
            expect(typeof url).toBe('string');
            expect(url.length).toBeGreaterThan(0);
        }
    });

    it('returns DISTINCT URLs across tiers (no recycled art)', () => {
        const all = Array.from({ length: 50 }, (_, i) => getLochBackground(i + 1));
        expect(new Set(all).size).toBe(50);
    });

    it('falls back to the tier-1 background for tier > 50', () => {
        const tier1 = getLochBackground(1);
        expect(getLochBackground(51)).toBe(tier1);
        expect(getLochBackground(999)).toBe(tier1);
    });

    it('falls back to the tier-1 background for tier <= 0', () => {
        const tier1 = getLochBackground(1);
        expect(getLochBackground(0)).toBe(tier1);
        expect(getLochBackground(-5)).toBe(tier1);
    });

    it('falls back to the tier-1 background for NaN', () => {
        expect(getLochBackground(NaN)).toBe(getLochBackground(1));
    });
});


describe('getLochBossImage', () => {
    it('returns a URL for every tier in 1..50', () => {
        for (let tier = 1; tier <= 50; tier++) {
            const url = getLochBossImage(tier);
            expect(typeof url).toBe('string');
            expect(url.length).toBeGreaterThan(0);
        }
    });

    it('returns DISTINCT URLs across tiers (no recycled art)', () => {
        const all = Array.from({ length: 50 }, (_, i) => getLochBossImage(i + 1));
        expect(new Set(all).size).toBe(50);
    });

    it('falls back to the tier-1 portrait for tier > 50', () => {
        const tier1 = getLochBossImage(1);
        expect(getLochBossImage(51)).toBe(tier1);
        expect(getLochBossImage(9999)).toBe(tier1);
    });

    it('falls back to the tier-1 portrait for tier <= 0', () => {
        const tier1 = getLochBossImage(1);
        expect(getLochBossImage(0)).toBe(tier1);
        expect(getLochBossImage(-1)).toBe(tier1);
    });
});


describe('background vs boss image parallelism', () => {
    it('returns DIFFERENT urls for background vs portrait at the same tier', () => {
        for (const tier of [1, 10, 25, 50]) {
            expect(getLochBackground(tier)).not.toBe(getLochBossImage(tier));
        }
    });
});
