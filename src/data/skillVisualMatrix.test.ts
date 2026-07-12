import { describe, it, expect } from 'vitest';
import skillsData from './skills.json';
import {
    getSkillAnimation,
    SKILL_ANIMATIONS,
    type SkillAnimCategory,
} from './skillAnimations';
import { getSkillIcon } from './skillIcons';
import { isImageUrl } from '../systems/spriteAssets';


const DOCUMENTED_CATEGORIES: ReadonlySet<SkillAnimCategory> = new Set([
    'fire', 'ice', 'lightning', 'holy', 'dark', 'physical',
    'arrow', 'music', 'arcane', 'poison', 'buff', 'summon',
]);

interface IActiveSkill {
    id: string;
    name: string;
    unlockLevel: number;
}

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
