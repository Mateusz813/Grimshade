
import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { seedQuestState } from '../../fixtures/seedQuestState';

test.describe('Quests › Quests', { tag: '@progression' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('two active quests on the same character render side-by-side with --active modifier and counter "(2)"', async ({ page }) => {
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
                    {
                        questId: 'quest_undead_hunter',
                        goals: [
                            { type: 'kill', monsterId: 'skeleton', count: 30, progress: 0 },
                            { type: 'kill', monsterId: 'zombie', count: 30, progress: 0 },
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

            const activeFilterBtn = page.locator('.quests__filter-btn', {
                hasText: /^Aktywne/,
            });
            await expect(activeFilterBtn).toContainText('Aktywne (2)');

            const lvlInput = page.locator('.quests__lvl-filter--inline');
            await lvlInput.fill('10');

            const firstStepsCard = page.locator('.quests__card', {
                has: page.locator('.quests__card-name', { hasText: 'Pierwsze Kroki' }),
            });
            const undeadCard = page.locator('.quests__card', {
                has: page.locator('.quests__card-name', { hasText: 'Lowca Nieumarych' }),
            });
            await expect(firstStepsCard).toBeVisible({ timeout: 10_000 });
            await expect(undeadCard).toBeVisible({ timeout: 10_000 });

            await expect(firstStepsCard).toHaveClass(/quests__card--active/);
            await expect(undeadCard).toHaveClass(/quests__card--active/);

            await activeFilterBtn.tap();
            await expect(activeFilterBtn).toHaveClass(/quests__filter-btn--active/);
            await expect(firstStepsCard).toBeVisible();
            await expect(undeadCard).toBeVisible();
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
