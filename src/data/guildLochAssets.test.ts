/**
 * Tests for the loch (guild boss) artwork registry.
 *
 * The module ships two parallel maps keyed by tier (1..50):
 *   - LOCH_BACKGROUNDS  — full-bleed arena backgrounds (loch{N}.png).
 *   - LOCH_BOSS_IMAGES  — boss portraits (loch-{N}.png).
 *
 * Public resolvers:
 *   - getLochBackground(tier)  — looks up tier, falls back to tier 1.
 *   - getLochBossImage(tier)   — same shape.
 *
 * As with `spriteAssets.test.ts` we don't assert exact URL strings
 * (Vite hashes them). We assert presence, identity (fallback returns
 * the SAME url as tier 1), and out-of-range behaviour.
 */

import { describe, it, expect } from 'vitest';
import { getLochBackground, getLochBossImage } from './guildLochAssets';

// -- getLochBackground -------------------------------------------------------

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

// -- getLochBossImage --------------------------------------------------------

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

// -- parallel maps -----------------------------------------------------------

describe('background vs boss image parallelism', () => {
    it('returns DIFFERENT urls for background vs portrait at the same tier', () => {
        // bg{N}.png and boss{N}.png are distinct files — they shouldn't
        // alias to the same hashed URL.
        for (const tier of [1, 10, 25, 50]) {
            expect(getLochBackground(tier)).not.toBe(getLochBossImage(tier));
        }
    });
});
