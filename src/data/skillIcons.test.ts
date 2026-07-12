
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../systems/spriteAssets', () => ({
    getSpellImage: vi.fn(() => null),
}));

import { SKILL_ICONS, getSkillIcon } from './skillIcons';
import { getSpellImage } from '../systems/spriteAssets';

beforeEach(() => {
    vi.mocked(getSpellImage).mockReset();
    vi.mocked(getSpellImage).mockReturnValue(null);
});


describe('SKILL_ICONS', () => {
    it('exposes weapon / utility skill emojis', () => {
        expect(SKILL_ICONS.sword_fighting).toBe('crossed-swords');
        expect(SKILL_ICONS.distance_fighting).toBe('bow-and-arrow');
        expect(SKILL_ICONS.dagger_fighting).toBe('dagger');
        expect(SKILL_ICONS.magic_level).toBe('crystal-ball');
        expect(SKILL_ICONS.bard_level).toBe('musical-note');
        expect(SKILL_ICONS.shielding).toBe('shield');
    });

    it('exposes signature class skill emojis', () => {
        expect(SKILL_ICONS.shield_bash).toBe(':crossed-swords::shield:');
        expect(SKILL_ICONS.berserker_rage).toBe(':face-with-steam-from-nose::fire:');
        expect(SKILL_ICONS.fireball).toBe('fire');
        expect(SKILL_ICONS.meteor).toBe('comet');
        expect(SKILL_ICONS.heal).toBe('green-heart');
        expect(SKILL_ICONS.precise_shot).toBe(':bow-and-arrow::bullseye:');
        expect(SKILL_ICONS.backstab).toBe(':dagger::dashing-away:');
        expect(SKILL_ICONS.summon_skeleton).toBe(':skull::bone:');
        expect(SKILL_ICONS.battle_hymn).toBe(':musical-note::crossed-swords:');
    });

    it('every value is a non-empty string', () => {
        for (const [id, icon] of Object.entries(SKILL_ICONS)) {
            expect(typeof icon).toBe('string');
            expect(icon.length, `${id} has empty icon`).toBeGreaterThan(0);
        }
    });
});


describe('getSkillIcon', () => {
    it('returns the PNG URL when getSpellImage resolves it', () => {
        vi.mocked(getSpellImage).mockReturnValueOnce('/assets/spells/knight-1.png');
        expect(getSkillIcon('shield_bash')).toBe('/assets/spells/knight-1.png');
        expect(getSpellImage).toHaveBeenCalled();
    });

    it('falls back to the emoji map when getSpellImage returns null', () => {
        vi.mocked(getSpellImage).mockReturnValue(null);
        expect(getSkillIcon('shield_bash')).toBe(SKILL_ICONS.shield_bash);
        expect(getSkillIcon('fireball')).toBe('fire');
    });

    it('falls back to the generic sparkle (:sparkles:) for an unknown skill id', () => {
        vi.mocked(getSpellImage).mockReturnValue(null);
        expect(getSkillIcon('not_a_real_skill')).toBe('sparkles');
    });

    it('returns the emoji for weapon skills (not in skills.json -> no PNG lookup)', () => {
        expect(getSkillIcon('sword_fighting')).toBe('crossed-swords');
        expect(getSkillIcon('magic_level')).toBe('crystal-ball');
        expect(getSkillIcon('shielding')).toBe('shield');
    });

    it('still falls back to :sparkles: when getSpellImage returns the empty string', () => {
        vi.mocked(getSpellImage).mockReturnValue('');
        expect(getSkillIcon('unknown_skill_xyz')).toBe('sparkles');
    });

    it('handles the empty string skill id gracefully', () => {
        vi.mocked(getSpellImage).mockReturnValue(null);
        expect(getSkillIcon('')).toBe('sparkles');
    });
});
