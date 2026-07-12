
import { describe, it, expect } from 'vitest';
import {
    SKILL_ANIMATIONS,
    getSkillAnimation,
    type SkillAnimCategory,
} from './skillAnimations';

const VALID_CATEGORIES: SkillAnimCategory[] = [
    'fire', 'ice', 'lightning', 'holy', 'dark', 'physical',
    'arrow', 'music', 'arcane', 'poison', 'buff', 'summon',
];


describe('SKILL_ANIMATIONS', () => {
    it('every entry uses one of the 12 documented categories', () => {
        for (const [id, anim] of Object.entries(SKILL_ANIMATIONS)) {
            expect(VALID_CATEGORIES, `skill ${id} uses an unknown category`).toContain(anim.category);
        }
    });

    it('every entry has cssClass following the skill-anim--{category} convention', () => {
        for (const [id, anim] of Object.entries(SKILL_ANIMATIONS)) {
            expect(anim.cssClass, `skill ${id} cssClass mismatch`).toBe(`skill-anim--${anim.category}`);
        }
    });

    it('every entry has a positive duration', () => {
        for (const [id, anim] of Object.entries(SKILL_ANIMATIONS)) {
            expect(anim.duration, `skill ${id} has non-positive duration`).toBeGreaterThan(0);
        }
    });

    it('every entry has a hex colour', () => {
        for (const [id, anim] of Object.entries(SKILL_ANIMATIONS)) {
            expect(anim.color, `skill ${id} color is not hex`).toMatch(/^#[0-9a-f]{3,8}$/i);
        }
    });

    it('every entry has a non-empty emoji', () => {
        for (const [id, anim] of Object.entries(SKILL_ANIMATIONS)) {
            expect(typeof anim.emoji).toBe('string');
            expect(anim.emoji.length, `skill ${id} emoji is empty`).toBeGreaterThan(0);
        }
    });
});


describe('SKILL_ANIMATIONS coverage', () => {
    it('includes signature Knight skills with the documented categories', () => {
        expect(SKILL_ANIMATIONS.shield_bash.category).toBe('physical');
        expect(SKILL_ANIMATIONS.berserker_rage.category).toBe('fire');
        expect(SKILL_ANIMATIONS.divine_strike.category).toBe('holy');
    });

    it('includes signature Mage / Cleric / Necromancer / Bard skills', () => {
        expect(SKILL_ANIMATIONS.fireball.category).toBe('fire');
        expect(SKILL_ANIMATIONS.ice_lance.category).toBe('ice');
        expect(SKILL_ANIMATIONS.holy_strike.category).toBe('holy');
        expect(SKILL_ANIMATIONS.summon_skeleton.category).toBe('summon');
        expect(SKILL_ANIMATIONS.battle_hymn.category).toBe('music');
    });

    it('includes the guild-boss spell ids (cios, pozoga, apokalipsa, …)', () => {
        expect(SKILL_ANIMATIONS.cios).toBeDefined();
        expect(SKILL_ANIMATIONS.pozoga.category).toBe('fire');
        expect(SKILL_ANIMATIONS.mroz.category).toBe('ice');
        expect(SKILL_ANIMATIONS.apokalipsa).toBeDefined();
        expect(SKILL_ANIMATIONS.apokalipsaCienia.category).toBe('dark');
    });
});


describe('getSkillAnimation', () => {
    it('returns the matching animation for a known id', () => {
        const a = getSkillAnimation('fireball');
        expect(a).toBeDefined();
        expect(a?.category).toBe('fire');
        expect(a?.emoji).toBe('fire');
    });

    it('is the SAME reference as SKILL_ANIMATIONS[id]', () => {
        expect(getSkillAnimation('shield_bash')).toBe(SKILL_ANIMATIONS.shield_bash);
    });

    it('returns undefined for an unknown id', () => {
        expect(getSkillAnimation('not_a_real_skill')).toBeUndefined();
    });

    it('returns undefined for the empty string', () => {
        expect(getSkillAnimation('')).toBeUndefined();
    });

    it('is case-sensitive — "Fireball" != "fireball"', () => {
        expect(getSkillAnimation('Fireball')).toBeUndefined();
    });
});
