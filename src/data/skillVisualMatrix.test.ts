import { describe, it, expect } from 'vitest';
import skillsData from './skills.json';
import {
    getSkillAnimation,
    SKILL_ANIMATIONS,
    type SkillAnimCategory,
} from './skillAnimations';
import { getSkillIcon } from './skillIcons';
import { isImageUrl } from '../systems/spriteAssets';

/**
 * #14 — EXHAUSTIVE spell-visual matrix.
 *
 * The user's ask: "Na każdym widoku walki trzeba przetestować każdy spell
 * każdej klasy czy poprawnie się wyświetla u każdego — na moim ekranie i na
 * ekranie sojuszników, każdy jeden spell na każdym ekranie walki dosłownie."
 *
 * Why this single data-level test covers that whole matrix instead of
 * 105 skills × 8 combat views × 2 screens (= 1680) flaky E2E runs:
 *
 *   ALL 8 combat views (Combat, Dungeon, Boss, Raid, Transform, Arena,
 *   Trainer, Guild) render skill visuals through ONE shared primitive —
 *   `useCombatFx` -> `triggerEnemySkillAnim` (MY cast, shown on the target
 *   card on MY screen) and `triggerAllySkillAnim` (an ally's cast, shown on
 *   the ally card — i.e. the ally-screen path). Both resolve the visual via
 *   `getSkillAnimation(skillId)` + `getSkillIcon(skillId)`, and BOTH bail out
 *   silently when `getSkillAnimation` returns undefined:
 *
 *       const animData = getSkillAnimation(skillId);
 *       if (!animData) return;          // <- NO overlay renders. The spell is
 *                                       //   invisible on every view + screen.
 *
 *   So a skill present in skills.json but MISSING from SKILL_ANIMATIONS would
 *   cast with zero visual feedback everywhere. This test is the guard: every
 *   active skill of every class MUST resolve to complete, valid visual data,
 *   so it renders correctly on every view, own screen and ally screen alike.
 *
 * The companion `useCombatFx.test.ts` then proves the own-screen (enemy slot)
 * and ally-screen (ally slot) primitives actually set render state for every
 * one of these ids; the per-view wiring is covered by each view's component
 * test + the E2E specs (solo-trainer-per-class = own screen, party-member-
 * sees-ally-spell-cast = ally screen over the Realtime broadcast).
 */

const DOCUMENTED_CATEGORIES: ReadonlySet<SkillAnimCategory> = new Set([
    'fire', 'ice', 'lightning', 'holy', 'dark', 'physical',
    'arrow', 'music', 'arcane', 'poison', 'buff', 'summon',
]);

interface IActiveSkill {
    id: string;
    name: string;
    unlockLevel: number;
}

// Flatten every active skill of every class from skills.json into
// [class, skill] pairs so each test row is labelled with both.
const activeSkills = skillsData.activeSkills as unknown as Record<string, IActiveSkill[]>;
const ALL_SKILLS: Array<{ cls: string; skill: IActiveSkill }> = [];
for (const cls of Object.keys(activeSkills)) {
    for (const skill of activeSkills[cls]) {
        ALL_SKILLS.push({ cls, skill });
    }
}

describe('#14 spell-visual matrix — every active skill of every class', () => {
    it('skills.json exposes the expected 7 classes and 105 active skills', () => {
        expect(Object.keys(activeSkills).sort()).toEqual(
            ['archer', 'bard', 'cleric', 'knight', 'mage', 'necromancer', 'rogue'],
        );
        expect(ALL_SKILLS.length).toBe(105);
    });

    it('has no duplicate skill ids across classes', () => {
        const ids = ALL_SKILLS.map((s) => s.skill.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    // -- The core exhaustive loop — one assertion path per skill --------------
    for (const { cls, skill } of ALL_SKILLS) {
        describe(`${cls} › ${skill.id} (${skill.name})`, () => {
            it('resolves a DEFINED animation (will not silently skip the overlay)', () => {
                const anim = getSkillAnimation(skill.id);
                expect(anim, `skill "${skill.id}" has no SKILL_ANIMATIONS entry -> renders NO visual on any combat view`).toBeDefined();
            });

            it('animation uses a documented category', () => {
                const anim = getSkillAnimation(skill.id)!;
                expect(DOCUMENTED_CATEGORIES.has(anim.category), `${skill.id} category "${anim.category}"`).toBe(true);
            });

            it('animation cssClass follows skill-anim--{category}', () => {
                const anim = getSkillAnimation(skill.id)!;
                expect(anim.cssClass).toBe(`skill-anim--${anim.category}`);
            });

            it('animation has a positive duration + hex colour + non-empty emoji', () => {
                const anim = getSkillAnimation(skill.id)!;
                expect(anim.duration).toBeGreaterThan(0);
                expect(anim.color).toMatch(/^#[0-9a-fA-F]{3,8}$/);
                expect(anim.emoji.length).toBeGreaterThan(0);
            });

            it('getSkillIcon returns a non-empty icon (emoji or PNG url)', () => {
                const icon = getSkillIcon(skill.id);
                expect(typeof icon).toBe('string');
                expect(icon.length).toBeGreaterThan(0);
            });

            it('the resolved on-screen overlay glyph is always non-empty', () => {
                // Mirrors useSkillAnim line 31 / useCombatFx.resolveAnimEmoji:
                // prefer the per-class PNG artwork, else fall back to the
                // animation emoji. SOMETHING visible must always render.
                const anim = getSkillAnimation(skill.id)!;
                const icon = getSkillIcon(skill.id);
                const overlayGlyph = isImageUrl(icon) ? icon : anim.emoji;
                expect(overlayGlyph.length, `${skill.id} would render an empty overlay`).toBeGreaterThan(0);
            });
        });
    }
});

describe('#14 SKILL_ANIMATIONS hygiene', () => {
    it('every mapped entry (incl. guild-boss spells) is structurally valid', () => {
        for (const [id, anim] of Object.entries(SKILL_ANIMATIONS)) {
            expect(DOCUMENTED_CATEGORIES.has(anim.category), `${id}`).toBe(true);
            expect(anim.cssClass).toBe(`skill-anim--${anim.category}`);
            expect(anim.duration).toBeGreaterThan(0);
            expect(anim.color).toMatch(/^#[0-9a-fA-F]{3,8}$/);
            expect(anim.emoji.length).toBeGreaterThan(0);
        }
    });
});
