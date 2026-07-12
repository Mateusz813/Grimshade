
import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { seedQuestState } from '../../fixtures/seedQuestState';

test.describe('City › Monsters', { tag: '@city' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('"Tylko z taskiem / questem" filter narrows list to only monsters with active tasks', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: { level: 5, highest_level: 5, hp_regen: 0, mp_regen: 0 },
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

            await page.goto('/monsters');
            await expect(page.locator('.combat__hub-monsters')).toBeVisible({ timeout: 10_000 });

            const cards = page.locator('.combat__mcard');
            await expect(cards.first()).toBeVisible({ timeout: 10_000 });
            const initialCount = await cards.count();
            expect(initialCount).toBeGreaterThan(1);

            const taskedToggle = page.locator('.combat__filter-toggle', {
                hasText: /Tylko z taskiem/,
            });
            await taskedToggle.tap();
            await expect(taskedToggle).toHaveClass(/combat__filter-toggle--active/);

            await expect(cards).toHaveCount(1, { timeout: 5_000 });

            await expect(cards.first().locator('.combat__mcard-name')).toContainText('Szczur');

            await taskedToggle.tap();
            await expect(taskedToggle).not.toHaveClass(/combat__filter-toggle--active/);
            await expect(cards).toHaveCount(initialCount, { timeout: 5_000 });
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
