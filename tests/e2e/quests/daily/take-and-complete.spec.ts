
import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { seedQuestState } from '../../fixtures/seedQuestState';

test.describe('Quests › Daily', { tag: '@progression' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('daily tab shows seeded today-quests; claim button on a completed daily moves it to claimed state', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: { level: 30, highest_level: 30, hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            await seedQuestState({
                characterId: created.id,
                dailyQuests: {
                    todayQuestDefs: [
                        {
                            id: 'daily_kill_5',
                            name_pl: 'Rozgrzewka',
                            name_en: 'Warm Up',
                            description_pl: 'Zabij 5 dowolnych potworow',
                            minLevel: 25,
                            goal: { type: 'kill_any', count: 5 },
                            rewards: { gold: 200, xp: 100 },
                        },
                        {
                            id: 'daily_kill_10',
                            name_pl: 'Polowanie',
                            name_en: 'Hunt',
                            description_pl: 'Zabij 10 dowolnych potworow',
                            minLevel: 25,
                            goal: { type: 'kill_any', count: 10 },
                            rewards: { gold: 400, xp: 200 },
                        },
                    ],
                    activeQuests: [
                        {
                            questId: 'daily_kill_5',
                            progress: 5,
                            completed: true,
                            claimed: false,
                        },
                        {
                            questId: 'daily_kill_10',
                            progress: 3,
                            completed: false,
                            claimed: false,
                        },
                    ],
                },
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
            const dailyHubTile = page.locator('.quests__hub-tile--daily');
            await expect(dailyHubTile).toBeVisible({ timeout: 10_000 });
            await dailyHubTile.tap();

            await expect(page.locator('.quests__daily-locked')).toHaveCount(0);

            const dailyList = page.locator('.quests__daily-list');
            await expect(dailyList).toBeVisible({ timeout: 10_000 });

            const rozgrzewkaCard = page.locator('.quests__daily-quest', {
                has: page.locator('.quests__daily-quest-name', { hasText: 'Rozgrzewka' }),
            });
            await expect(rozgrzewkaCard).toBeVisible({ timeout: 10_000 });
            await expect(rozgrzewkaCard).toHaveClass(/quests__daily-quest--completed/);
            const claimBtn = rozgrzewkaCard.locator('.quests__action-btn--claim');
            await expect(claimBtn).toBeVisible();

            const polowanieCard = page.locator('.quests__daily-quest', {
                has: page.locator('.quests__daily-quest-name', { hasText: 'Polowanie' }),
            });
            await expect(polowanieCard).toBeVisible();
            await expect(polowanieCard).not.toHaveClass(/quests__daily-quest--completed/);
            await expect(polowanieCard).not.toHaveClass(/quests__daily-quest--claimed/);

            const bulkClaimBtn = page.locator(
                '.quests__bulk-actions--center .quests__bulk-btn--claim',
            );
            await expect(bulkClaimBtn).toBeVisible();
            await expect(bulkClaimBtn).toContainText('Odbierz wszystkie daily (1)');

            await claimBtn.tap();
            await expect(rozgrzewkaCard).toHaveClass(/quests__daily-quest--claimed/, {
                timeout: 5_000,
            });
            await expect(rozgrzewkaCard.locator('.quests__completed-label')).toContainText(
                'Odebrane',
            );
            await expect(rozgrzewkaCard.locator('.quests__action-btn--claim')).toHaveCount(0);
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
