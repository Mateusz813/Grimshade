/**
 * Tests for the shared class-avatar registry.
 *
 * The module owns two lookup maps and one resolver:
 *   • BASE_CLASS_AVATARS — base portrait per class.
 *   • TRANSFORM_AVATARS  — `class -> transform id (1..11) -> url`.
 *   • getCharacterAvatar — pulls the highest-completed transform from
 *     `transformSystem.getHighestCompletedTransform()` and routes to
 *     the matching art, falling back to the base portrait (or Mage's
 *     when the class id is unknown).
 *
 * All avatar URLs are imported PNGs — Vite serves them as strings at
 * test time (vitest goes through Vite's transformer). We assert
 * presence + identity rather than exact paths so the test stays
 * stable across asset reshuffles.
 */

import { describe, it, expect } from 'vitest';
import {
    BASE_CLASS_AVATARS,
    TRANSFORM_AVATARS,
    getCharacterAvatar,
} from './classAvatars';

// ── BASE_CLASS_AVATARS ──────────────────────────────────────────────────────

describe('BASE_CLASS_AVATARS', () => {
    it('ships an entry for every gameplay class', () => {
        const expected = ['Knight', 'Mage', 'Cleric', 'Archer', 'Rogue', 'Necromancer', 'Bard'];
        for (const cls of expected) {
            expect(BASE_CLASS_AVATARS[cls]).toBeDefined();
            expect(typeof BASE_CLASS_AVATARS[cls]).toBe('string');
            expect(BASE_CLASS_AVATARS[cls].length).toBeGreaterThan(0);
        }
    });

    it('uses distinct portraits per class (no duplicate URLs)', () => {
        const urls = Object.values(BASE_CLASS_AVATARS);
        expect(new Set(urls).size).toBe(urls.length);
    });
});

// ── TRANSFORM_AVATARS ───────────────────────────────────────────────────────

describe('TRANSFORM_AVATARS', () => {
    it('has 11 transform tiers for every class', () => {
        for (const cls of Object.keys(BASE_CLASS_AVATARS)) {
            const tiers = TRANSFORM_AVATARS[cls];
            expect(tiers).toBeDefined();
            // 1..11 each populated.
            for (let i = 1; i <= 11; i++) {
                expect(tiers[i]).toBeDefined();
                expect(typeof tiers[i]).toBe('string');
            }
        }
    });

    it("does NOT define a base (transform id 0) entry — base lives in BASE_CLASS_AVATARS", () => {
        for (const cls of Object.keys(BASE_CLASS_AVATARS)) {
            expect(TRANSFORM_AVATARS[cls][0]).toBeUndefined();
        }
    });
});

// ── getCharacterAvatar ──────────────────────────────────────────────────────

describe('getCharacterAvatar', () => {
    it('returns the base portrait when no transform is completed', () => {
        expect(getCharacterAvatar('Knight', [])).toBe(BASE_CLASS_AVATARS.Knight);
        // Default arg covers the same branch.
        expect(getCharacterAvatar('Mage')).toBe(BASE_CLASS_AVATARS.Mage);
    });

    it('returns the transform portrait for the HIGHEST completed id', () => {
        expect(getCharacterAvatar('Archer', [1, 5, 3])).toBe(TRANSFORM_AVATARS.Archer[5]);
        expect(getCharacterAvatar('Rogue', [11])).toBe(TRANSFORM_AVATARS.Rogue[11]);
    });

    it('falls back to the base portrait when the highest id has no matching transform art', () => {
        // Highest completed id (99) is outside the 1..11 transform grid →
        // resolver should NOT crash, just return the base.
        expect(getCharacterAvatar('Bard', [99])).toBe(BASE_CLASS_AVATARS.Bard);
    });

    it('falls back to the Mage base portrait for an unknown class id', () => {
        expect(getCharacterAvatar('NotARealClass', [])).toBe(BASE_CLASS_AVATARS.Mage);
        // …and with transforms too — the unknown class has no TRANSFORM_AVATARS
        // entry, so the base-fallback fires.
        expect(getCharacterAvatar('NotARealClass', [3])).toBe(BASE_CLASS_AVATARS.Mage);
    });

    it('treats a single completed id correctly', () => {
        expect(getCharacterAvatar('Cleric', [1])).toBe(TRANSFORM_AVATARS.Cleric[1]);
    });

    it('is robust against an empty array (default behaviour)', () => {
        expect(getCharacterAvatar('Necromancer', [])).toBe(BASE_CLASS_AVATARS.Necromancer);
    });
});
