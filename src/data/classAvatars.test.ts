
import { describe, it, expect } from 'vitest';
import {
    BASE_CLASS_AVATARS,
    TRANSFORM_AVATARS,
    getCharacterAvatar,
} from './classAvatars';


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


describe('TRANSFORM_AVATARS', () => {
    it('has 11 transform tiers for every class', () => {
        for (const cls of Object.keys(BASE_CLASS_AVATARS)) {
            const tiers = TRANSFORM_AVATARS[cls];
            expect(tiers).toBeDefined();
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


describe('getCharacterAvatar', () => {
    it('returns the base portrait when no transform is completed', () => {
        expect(getCharacterAvatar('Knight', [])).toBe(BASE_CLASS_AVATARS.Knight);
        expect(getCharacterAvatar('Mage')).toBe(BASE_CLASS_AVATARS.Mage);
    });

    it('returns the transform portrait for the HIGHEST completed id', () => {
        expect(getCharacterAvatar('Archer', [1, 5, 3])).toBe(TRANSFORM_AVATARS.Archer[5]);
        expect(getCharacterAvatar('Rogue', [11])).toBe(TRANSFORM_AVATARS.Rogue[11]);
    });

    it('falls back to the base portrait when the highest id has no matching transform art', () => {
        expect(getCharacterAvatar('Bard', [99])).toBe(BASE_CLASS_AVATARS.Bard);
    });

    it('falls back to the Mage base portrait for an unknown class id', () => {
        expect(getCharacterAvatar('NotARealClass', [])).toBe(BASE_CLASS_AVATARS.Mage);
        expect(getCharacterAvatar('NotARealClass', [3])).toBe(BASE_CLASS_AVATARS.Mage);
    });

    it('treats a single completed id correctly', () => {
        expect(getCharacterAvatar('Cleric', [1])).toBe(TRANSFORM_AVATARS.Cleric[1]);
    });

    it('is robust against an empty array (default behaviour)', () => {
        expect(getCharacterAvatar('Necromancer', [])).toBe(BASE_CLASS_AVATARS.Necromancer);
    });
});
