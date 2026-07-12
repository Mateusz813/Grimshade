
import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { seedQuestState } from '../../fixtures/seedQuestState';

test.describe('Quests › Notifications', { tag: '@progression' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('TopHeader TaskBadge gets --claimable modifier when at least one task is ready to claim', async ({ page }) => {
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
                        progress: 10,
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

            await expect(page.locator('.top-header')).toBeVisible({ timeout: 10_000 });

            const taskBadgeBtn = page.locator('.top-header__tasks-btn');
            await expect(taskBadgeBtn).toBeVisible({ timeout: 10_000 });

            await expect(taskBadgeBtn).toHaveClass(/top-header__tasks-btn--claimable/);

            await expect(
                taskBadgeBtn.locator('.top-header__tasks-icon svg.game-icon'),
            ).toHaveAttribute('data-icon', 'wrapped-gift');

            await expect(
                taskBadgeBtn.locator('.top-header__tasks-status-dot--claim'),
            ).toBeVisible();

            const ariaLabel = await taskBadgeBtn.getAttribute('aria-label');
            expect(ariaLabel).toContain('do odebrania');

            await expect(taskBadgeBtn.locator('.top-header__tasks-count')).toHaveText('1');
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
