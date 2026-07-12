import { describe, it, expect } from 'vitest';
import { isHpMpPotionId, getPotionMinLevel, canUsePotionAtLevel } from './potionGating';
import { ELIXIRS } from '../stores/shopStore';


const TIERS: Array<[string, number]> = [
    ['sm', 1],
    ['md', 20],
    ['lg', 50],
    ['mega', 100],
    ['great', 200],
    ['super', 350],
    ['ultimate', 500],
    ['divine', 700],
];

describe('potionGating › isHpMpPotionId', () => {
    it('recognises every HP/MP potion id', () => {
        for (const [tier] of TIERS) {
            expect(isHpMpPotionId(`hp_potion_${tier}`)).toBe(true);
            expect(isHpMpPotionId(`mp_potion_${tier}`)).toBe(true);
        }
    });

    it('returns false for non-potion consumables', () => {
        for (const id of ['xp_boost', 'death_protection', 'amulet_of_loss', 'stat_reset', 'skill_xp_boost', 'arena_hp_potion']) {
            expect(isHpMpPotionId(id)).toBe(false);
        }
    });
});

describe('potionGating › getPotionMinLevel', () => {
    it('maps each HP tier to its unlock level', () => {
        for (const [tier, lvl] of TIERS) {
            expect(getPotionMinLevel(`hp_potion_${tier}`)).toBe(lvl);
        }
    });

    it('maps each MP tier to the SAME unlock level as HP', () => {
        for (const [tier, lvl] of TIERS) {
            expect(getPotionMinLevel(`mp_potion_${tier}`)).toBe(lvl);
        }
    });

    it('returns 1 (ungated) for non-potion ids', () => {
        expect(getPotionMinLevel('xp_boost')).toBe(1);
        expect(getPotionMinLevel('death_protection')).toBe(1);
        expect(getPotionMinLevel('totally_unknown_thing')).toBe(1);
    });
});

describe('potionGating › canUsePotionAtLevel', () => {
    it('blocks a potion exactly one level below its unlock, allows at/above', () => {
        for (const [tier, lvl] of TIERS) {
            const id = `hp_potion_${tier}`;
            if (lvl > 1) expect(canUsePotionAtLevel(id, lvl - 1)).toBe(false);
            expect(canUsePotionAtLevel(id, lvl)).toBe(true);
            expect(canUsePotionAtLevel(id, lvl + 5)).toBe(true);
        }
    });

    it('matches the player report: a level-14 character can ONLY use the 50-tier potion', () => {
        expect(canUsePotionAtLevel('hp_potion_sm', 14)).toBe(true);
        expect(canUsePotionAtLevel('hp_potion_md', 14)).toBe(false);
        expect(canUsePotionAtLevel('hp_potion_lg', 14)).toBe(false);
        expect(canUsePotionAtLevel('hp_potion_mega', 14)).toBe(false);
        expect(canUsePotionAtLevel('mp_potion_md', 14)).toBe(false);
    });

    it('gates the % potions at the high levels (200/350/500/700)', () => {
        expect(canUsePotionAtLevel('hp_potion_great', 199)).toBe(false);
        expect(canUsePotionAtLevel('hp_potion_great', 200)).toBe(true);
        expect(canUsePotionAtLevel('mp_potion_divine', 699)).toBe(false);
        expect(canUsePotionAtLevel('mp_potion_divine', 700)).toBe(true);
    });
});

describe('potionGating › shop ELIXIRS stay in sync', () => {
    it('every HP/MP elixir minLevel matches getPotionMinLevel', () => {
        const potions = ELIXIRS.filter((e) => isHpMpPotionId(e.id));
        expect(potions.length).toBe(16);
        for (const e of potions) {
            expect(e.minLevel).toBe(getPotionMinLevel(e.id));
        }
    });
});
