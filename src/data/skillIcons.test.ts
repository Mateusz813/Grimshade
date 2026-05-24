/**
 * Tests for the skill-icon registry + resolver.
 *
 * Two layered concerns:
 *
 * 1. SKILL_ICONS — emoji fallback map. Hand-maintained, must cover
 *    every active skill plus the weapon-skill ids. We assert the
 *    spot-checked emoji per class so accidental wipes show up.
 *
 * 2. getSkillIcon — first tries to resolve PNG artwork from the
 *    sprite registry (`getSpellImage`), then falls back to the
 *    emoji map, then to a generic sparkle ('✦'). The image registry
 *    is built at module-import time from `skills.json`, so we test
 *    by mocking `spriteAssets.getSpellImage` to control the artwork
 *    branch.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the spell-image resolver — we want explicit control over the
// artwork branch so the emoji fallback is testable in isolation.
vi.mock('../systems/spriteAssets', () => ({
    getSpellImage: vi.fn(() => null),
}));

// Import AFTER the mock so the registry build picks up the mocked
// getSpellImage signature (return value is read at lookup time, not
// build time, so the mock value can be flipped per test).
import { SKILL_ICONS, getSkillIcon } from './skillIcons';
import { getSpellImage } from '../systems/spriteAssets';

beforeEach(() => {
    vi.mocked(getSpellImage).mockReset();
    vi.mocked(getSpellImage).mockReturnValue(null);
});

// ── SKILL_ICONS map coverage ────────────────────────────────────────────────

describe('SKILL_ICONS', () => {
    it('exposes weapon / utility skill emojis', () => {
        expect(SKILL_ICONS.sword_fighting).toBe('⚔️');
        expect(SKILL_ICONS.distance_fighting).toBe('🏹');
        expect(SKILL_ICONS.dagger_fighting).toBe('🗡️');
        expect(SKILL_ICONS.magic_level).toBe('🔮');
        expect(SKILL_ICONS.bard_level).toBe('🎵');
        expect(SKILL_ICONS.shielding).toBe('🛡️');
    });

    it('exposes signature class skill emojis', () => {
        // Knight
        expect(SKILL_ICONS.shield_bash).toBe('⚔️🛡️');
        expect(SKILL_ICONS.berserker_rage).toBe('😤🔥');
        // Mage
        expect(SKILL_ICONS.fireball).toBe('🔥');
        expect(SKILL_ICONS.meteor).toBe('☄️');
        // Cleric
        expect(SKILL_ICONS.heal).toBe('💚');
        // Archer
        expect(SKILL_ICONS.precise_shot).toBe('🏹🎯');
        // Rogue
        expect(SKILL_ICONS.backstab).toBe('🗡️💨');
        // Necromancer
        expect(SKILL_ICONS.summon_skeleton).toBe('💀🦴');
        // Bard
        expect(SKILL_ICONS.battle_hymn).toBe('🎵⚔️');
    });

    it('every value is a non-empty string', () => {
        for (const [id, icon] of Object.entries(SKILL_ICONS)) {
            expect(typeof icon).toBe('string');
            expect(icon.length, `${id} has empty icon`).toBeGreaterThan(0);
        }
    });
});

// ── getSkillIcon resolver — three-tier fallback ─────────────────────────────

describe('getSkillIcon', () => {
    it('returns the PNG URL when getSpellImage resolves it', () => {
        vi.mocked(getSpellImage).mockReturnValueOnce('/assets/spells/knight-1.png');
        // shield_bash is the first knight skill in skills.json → key { knight, 1 }.
        expect(getSkillIcon('shield_bash')).toBe('/assets/spells/knight-1.png');
        expect(getSpellImage).toHaveBeenCalled();
    });

    it('falls back to the emoji map when getSpellImage returns null', () => {
        vi.mocked(getSpellImage).mockReturnValue(null);
        expect(getSkillIcon('shield_bash')).toBe(SKILL_ICONS.shield_bash);
        expect(getSkillIcon('fireball')).toBe('🔥');
    });

    it('falls back to the generic sparkle (✦) for an unknown skill id', () => {
        // Unknown id → no key in SKILL_TO_IMAGE_KEY, no entry in
        // SKILL_ICONS → '✦'.
        vi.mocked(getSpellImage).mockReturnValue(null);
        expect(getSkillIcon('not_a_real_skill')).toBe('✦');
    });

    it('returns the emoji for weapon skills (not in skills.json → no PNG lookup)', () => {
        // sword_fighting / magic_level etc. are not part of the
        // SKILL_TO_IMAGE_KEY map (they're weapon-level, not active
        // skills), so the PNG branch never runs.
        expect(getSkillIcon('sword_fighting')).toBe('⚔️');
        expect(getSkillIcon('magic_level')).toBe('🔮');
        expect(getSkillIcon('shielding')).toBe('🛡️');
    });

    it('still falls back to ✦ when getSpellImage returns the empty string', () => {
        // Empty string is falsy → resolver treats it as "no image" and
        // hits the emoji map. Unknown id with empty image → sparkle.
        vi.mocked(getSpellImage).mockReturnValue('');
        expect(getSkillIcon('unknown_skill_xyz')).toBe('✦');
    });

    it('handles the empty string skill id gracefully', () => {
        vi.mocked(getSpellImage).mockReturnValue(null);
        expect(getSkillIcon('')).toBe('✦');
    });
});
