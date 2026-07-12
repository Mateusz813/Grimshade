
import { test, expect, type Page } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName, type CharacterClass } from '../../fixtures/createCharacter';
import { seedGameSave, findUserIdByEmail } from '../../fixtures/seedGameSave';
import { cleanupCharacterById } from '../../fixtures/cleanup';

interface IClassSkillAnimCase {
    cls: CharacterClass;
    skillId: string;
    expectedCategoryClass: string;
    target: 'enemy' | 'ally';
}

const CASES: ReadonlyArray<IClassSkillAnimCase> = [
    { cls: 'Knight',      skillId: 'shield_bash',  expectedCategoryClass: 'skill-anim--physical', target: 'enemy' },
    { cls: 'Mage',        skillId: 'fireball',     expectedCategoryClass: 'skill-anim--fire',     target: 'enemy' },
    { cls: 'Cleric',      skillId: 'holy_strike',  expectedCategoryClass: 'skill-anim--holy',     target: 'enemy' },
    { cls: 'Archer',      skillId: 'precise_shot', expectedCategoryClass: 'skill-anim--arrow',    target: 'enemy' },
    { cls: 'Rogue',       skillId: 'backstab',     expectedCategoryClass: 'skill-anim--physical', target: 'enemy' },
    { cls: 'Necromancer', skillId: 'life_drain',   expectedCategoryClass: 'skill-anim--dark',     target: 'enemy' },
    { cls: 'Bard',        skillId: 'battle_hymn',  expectedCategoryClass: 'skill-anim--music',    target: 'ally'  },
];

const pickCharacter = async (page: Page, nick: string): Promise<void> => {
    await page.goto('/character-select');
    const card = page.locator('.char-select__card', {
        has: page.locator('.char-select__card-name', { hasText: nick }),
    });
    await expect(card).toBeVisible({ timeout: 10_000 });
    await card.getByRole('button', { name: /Wybierz/i }).tap();
    await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
    await expect(page.locator('.top-header')).toBeVisible({ timeout: 10_000 });
};

test.describe('Skills › Animations', { tag: '@skills' }, () => {
    test.describe.configure({ timeout: 60_000, mode: 'serial' });

    for (const { cls, skillId, expectedCategoryClass, target } of CASES) {
        test(`solo: ${cls} -> ${skillId} (${expectedCategoryClass}) animation renders on ${target} card in /trainer`, async ({ page }) => {
            const nick = generateTestCharacterName();
            let createdId: string | null = null;

            try {
                const created = await createCharacterViaApi({
                    userEmail: testUsers.primary.email,
                    name: nick,
                    class: cls,
                    overrides: { level: 5, hp_regen: 0, mp_regen: 0 },
                });
                createdId = created.id;

                const userId = await findUserIdByEmail(testUsers.primary.email);
                await seedGameSave({
                    characterId: created.id,
                    userId,
                    skills: {
                        activeSkillSlots: [skillId, null, null, null],
                        unlockedSkills: { [skillId]: true },
                    },
                });

                await loginViaUI(page, testUsers.primary);
                await pickCharacter(page, nick);

                await page.goto('/trainer');
                await expect(page).toHaveURL(/\/trainer$/, { timeout: 10_000 });

                await expect(page.locator('.trainer')).toBeVisible({ timeout: 15_000 });
                const actionBar = page.locator('.combat-ui__action-bar');
                await expect(actionBar).toBeVisible({ timeout: 10_000 });

                const autoSkillChip = page.locator('.combat-ui__chip[title="Auto skille"]');
                await expect(autoSkillChip).toBeVisible({ timeout: 5_000 });
                const wasAutoSkillOn = (await autoSkillChip.textContent())?.includes('ON');
                if (wasAutoSkillOn) {
                    await autoSkillChip.tap();
                    await expect(autoSkillChip).toContainText('OFF', { timeout: 3_000 });
                }
                const autoFightChip = page.locator('.combat-ui__chip[title="Auto walka"]');
                if (await autoFightChip.count() > 0) {
                    const wasAutoFightOn = (await autoFightChip.textContent())?.includes('ON');
                    if (wasAutoFightOn) await autoFightChip.tap();
                }

                const skillBtn = actionBar.locator(`button[aria-label="${skillId}"]`);
                await expect(skillBtn).toBeVisible({ timeout: 10_000 });
                await expect(skillBtn).toBeEnabled({ timeout: 20_000 });
                await expect(skillBtn).not.toHaveClass(/combat-ui__action-btn--disabled/);

                const targetCardsBefore = page.locator(`.combat-ui__${target} .skill-anim-overlay`);
                await expect.poll(
                    async () => await targetCardsBefore.count(),
                    { timeout: 2_500, intervals: [100, 250, 500] },
                ).toBe(0);

                await skillBtn.tap();

                const overlay = page.locator(`.combat-ui__${target} .${expectedCategoryClass}`);
                await expect(overlay.first()).toBeVisible({ timeout: 3_000 });

                const overlayEmoji = overlay.first().locator('.skill-anim-emoji');
                await expect(overlayEmoji).toBeVisible({ timeout: 1_500 });

                await expect(overlay.first()).toBeHidden({ timeout: 3_500 });
            } finally {
                if (createdId) {
                    await cleanupCharacterById(createdId);
                }
            }
        });
    }
});
