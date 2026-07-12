
import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { seedQuestState } from '../../fixtures/seedQuestState';

test.describe('Quests › Tasks', { tag: '@progression' }, () => {
    test.describe.configure({ timeout: 90_000 });

    test('Szczur card gets --task modifier + Task pill when rat_10 task is active; other unlocked monsters stay un-highlighted', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            const created = await createCharacterViaApi({
                userEmail: testUsers.secondary.email,
                name: nick,
                class: 'Knight',
                overrides: { level: 5, highest_level: 5, hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            await seedQuestState({
                characterId: created.id,
                activeTasks: [{
                    id: 'rat_10',
                    monsterId: 'rat',
                    monsterLevel: 1,
                    monsterName: 'Szczur',
                    killCount: 10,
                    rewardGold: 50,
                    rewardXp: 100,
                    progress: 0,
                }],
            });

            await loginViaUI(page, testUsers.secondary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 10_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });

            await page.goto('/monsters');

            const szczurCard = page.locator('.combat__mcard', {
                has: page.locator('.combat__mcard-name', { hasText: /^Szczur$/ }),
            }).first();
            await expect(szczurCard).toBeVisible({ timeout: 10_000 });

            await expect(szczurCard).toHaveClass(/combat__mcard--task/);

            const taskPill = szczurCard.locator('.combat__mcard-goal--task');
            await expect(taskPill).toBeVisible();
            await expect(taskPill).toContainText(/Task\s+0\s*\/\s*10/);

            const unhighlightedCards = page.locator(
                '.combat__mcard:not(.combat__mcard--task)',
            );
            const unhighlightedCount = await unhighlightedCards.count();
            expect(unhighlightedCount).toBeGreaterThan(0);
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
