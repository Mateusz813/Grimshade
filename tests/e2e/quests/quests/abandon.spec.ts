
import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { seedQuestState } from '../../fixtures/seedQuestState';

test.describe('Quests › Quests', { tag: '@progression' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('abandon confirm removes active quest from list and decrements counter', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: { level: 12, highest_level: 12, hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            await seedQuestState({
                characterId: created.id,
                activeQuests: [
                    {
                        questId: 'quest_first_steps',
                        goals: [
                            { type: 'kill', monsterId: 'rat', count: 50, progress: 0 },
                            { type: 'kill', monsterId: 'goblin', count: 20, progress: 0 },
                        ],
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
            await page.locator('.quests__hub-tile--quests').tap();
            await expect(page.locator('.quests__filters')).toBeVisible({ timeout: 10_000 });

            const activeFilterBtn = page.locator('.quests__filter-btn', { hasText: /^Aktywne/ });
            await expect(activeFilterBtn).toContainText('Aktywne (1)');

            const questCard = page.locator('.quests__card', {
                has: page.locator('.quests__card-name', { hasText: 'Pierwsze Kroki' }),
            });
            await expect(questCard).toBeVisible({ timeout: 10_000 });
            await expect(questCard).toHaveClass(/quests__card--active/);

            await questCard.locator('.quests__action-btn--abandon').tap();

            const modal = page.locator('.quests__abandon-modal');
            await expect(modal).toBeVisible({ timeout: 5_000 });
            await modal.locator('.quests__abandon-modal-btn--confirm').tap();

            await expect(modal).toHaveCount(0, { timeout: 5_000 });
            await expect(activeFilterBtn).toContainText('Aktywne (0)');

            await expect(questCard).not.toHaveClass(/quests__card--active/);
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
