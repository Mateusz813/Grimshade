
import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { seedQuestState } from '../../fixtures/seedQuestState';

test.describe('Quests › Tasks', { tag: '@progression' }, () => {
    test.describe.configure({ timeout: 90_000 });

    test('rat_10 active + combat phase=fighting against rat -> TopHeader TaskBadge gets --live + LIVE tag on the row', async ({ page }) => {
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
            await expect(page.locator('.town__char-name')).toHaveText(nick, { timeout: 10_000 });

            const tasksBtn = page.locator('.top-header__tasks-btn');
            await expect(tasksBtn).toBeVisible({ timeout: 10_000 });
            await expect(tasksBtn.locator('.top-header__tasks-count')).toHaveText('1');
            await expect(tasksBtn).not.toHaveClass(/top-header__tasks-btn--live/);

            await page.evaluate(async () => {
                const engineMod = await import('/src/systems/combatEngine.ts');
                const combatMod = await import('/src/stores/combatStore.ts');

                const engine = engineMod as {
                    getAllMonsters: () => Array<{ id: string; hp: number; level: number }>;
                };
                const useCombatStore = (combatMod as {
                    useCombatStore: {
                        getState: () => {
                            initCombat: (m: unknown, hp: number, mp: number, rarity?: string) => void;
                        };
                    };
                }).useCombatStore;

                const rat = engine.getAllMonsters().find((m) => m.id === 'rat');
                if (!rat) throw new Error('rat missing from registry');

                useCombatStore.getState().initCombat(rat, 120, 30, 'normal');
            });

            await expect(tasksBtn).toHaveClass(/top-header__tasks-btn--live/, { timeout: 5_000 });
            await expect(tasksBtn.locator('.top-header__tasks-count')).toHaveText('1');
            await expect(tasksBtn).not.toHaveClass(/top-header__tasks-btn--claimable/);

            await tasksBtn.tap();
            const dropdown = page.locator('.top-header__tasks-dropdown');
            await expect(dropdown).toBeVisible({ timeout: 5_000 });

            const liveRow = dropdown.locator('.top-header__task-row--live');
            await expect(liveRow).toHaveCount(1);
            await expect(liveRow.locator('.top-header__task-row-live-tag')).toBeVisible();
            await expect(liveRow).toContainText('Szczur');
            await expect(liveRow.locator('.top-header__task-row-progress')).toContainText('0/10');
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
