
import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { seedQuestState } from '../../fixtures/seedQuestState';

test.describe('Quests › Tasks', { tag: '@progression' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('Lvl-od input + Nieaktywne chip + Sortuj desc chip each narrow / reorder the list', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: { level: 20, highest_level: 20, hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            await seedQuestState({
                characterId: created.id,
                activeTasks: [
                    {
                        id: 'rat_10',
                        monsterId: 'rat',
                        monsterLevel: 1,
                        monsterName: 'Szczur',
                        killCount: 10,
                        rewardGold: 50,
                        rewardXp: 100,
                        progress: 0,
                    },
                ],
            });

            await loginViaUI(page, testUsers.primary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 10_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });

            await page.goto('/quests');
            await page.locator('.quests__hub-tile--tasks').tap();
            await expect(page.locator('.tasks__list')).toBeVisible({ timeout: 10_000 });

            const ratGroup = page.locator('.tasks__monster-group', {
                has: page.locator('.tasks__monster-name-label', { hasText: /^Szczur$/ }),
            });
            await expect(ratGroup).toBeVisible({ timeout: 5_000 });
            await expect(page.locator('.quests__sub-controls-meta')).toContainText('1 aktywne');

            const lvlInput = page.locator('.quests__lvl-filter').first();
            await lvlInput.fill('5');
            await expect(ratGroup).toHaveCount(0, { timeout: 5_000 });

            await lvlInput.fill('');
            await expect(ratGroup).toBeVisible({ timeout: 5_000 });

            const inactiveChip = page.locator('.quests__filter-chip', {
                hasText: /Nieaktywne/,
            });
            await inactiveChip.tap();
            await expect(inactiveChip).toHaveClass(/quests__filter-chip--on/);
            await expect(ratGroup).toHaveCount(0, { timeout: 5_000 });

            await inactiveChip.tap();
            await expect(inactiveChip).not.toHaveClass(/quests__filter-chip--on/);
            await expect(ratGroup).toBeVisible({ timeout: 5_000 });

            await lvlInput.fill('5');
            await expect(ratGroup).toHaveCount(0);

            const firstGroupName = async (): Promise<string> => {
                return (
                    (await page
                        .locator('.tasks__list .tasks__monster-name-label')
                        .first()
                        .textContent()) ?? ''
                ).trim();
            };

            const ascFirst = await firstGroupName();
            expect(ascFirst.length).toBeGreaterThan(0);

            const sortChip = page.locator('.quests__filter-chip', {
                hasText: /Sortuj od najwyższego lvl/,
            });
            await sortChip.tap();
            await expect(sortChip).toHaveClass(/quests__filter-chip--on/);

            const descFirst = await firstGroupName();
            expect(descFirst).not.toEqual(ascFirst);
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
