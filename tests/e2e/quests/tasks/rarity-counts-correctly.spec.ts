
import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { seedQuestState } from '../../fixtures/seedQuestState';
import { killMonsterViaEngine } from '../../fixtures/combatSim';

test.describe('Quests › Tasks', { tag: '@progression' }, () => {
    test.describe.configure({ timeout: 90_000 });

    test('rat_10 task: cave_spider kill does NOT advance; rat kills apply MONSTER_RARITY_TASK_KILLS multiplier (normal=1, strong=3, epic=10)', async ({ page }) => {
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

            await loginViaUI(page, testUsers.primary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 10_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
            await expect(page.locator('.town__char-name')).toHaveText(nick, { timeout: 10_000 });

            const initial = await page.evaluate(async () => {
                const mod = await import('/src/stores/taskStore.ts');
                const ts = (mod as {
                    useTaskStore: { getState: () => { activeTasks: Array<{ id: string; progress: number }> } };
                }).useTaskStore.getState();
                return {
                    count: ts.activeTasks.length,
                    ratTaskProgress: ts.activeTasks.find((t) => t.id === 'rat_10')?.progress ?? -1,
                };
            });
            expect(initial.count).toBe(1);
            expect(initial.ratTaskProgress).toBe(0);

            await killMonsterViaEngine(page, 'cave_spider', 'normal');

            const afterSpider = await page.evaluate(async () => {
                const mod = await import('/src/stores/taskStore.ts');
                const ts = (mod as {
                    useTaskStore: { getState: () => { activeTasks: Array<{ id: string; progress: number }> } };
                }).useTaskStore.getState();
                return ts.activeTasks.find((t) => t.id === 'rat_10')?.progress ?? -1;
            });
            expect(afterSpider).toBe(0);

            await killMonsterViaEngine(page, 'rat', 'normal');

            const afterRatNormal = await page.evaluate(async () => {
                const mod = await import('/src/stores/taskStore.ts');
                const ts = (mod as {
                    useTaskStore: { getState: () => { activeTasks: Array<{ id: string; progress: number }> } };
                }).useTaskStore.getState();
                return ts.activeTasks.find((t) => t.id === 'rat_10')?.progress ?? -1;
            });
            expect(afterRatNormal).toBe(1);

            await killMonsterViaEngine(page, 'rat', 'strong');

            const afterRatStrong = await page.evaluate(async () => {
                const mod = await import('/src/stores/taskStore.ts');
                const ts = (mod as {
                    useTaskStore: { getState: () => { activeTasks: Array<{ id: string; progress: number }> } };
                }).useTaskStore.getState();
                return ts.activeTasks.find((t) => t.id === 'rat_10')?.progress ?? -1;
            });
            expect(afterRatStrong).toBe(4);

            await killMonsterViaEngine(page, 'rat', 'epic');

            const afterRatEpic = await page.evaluate(async () => {
                const mod = await import('/src/stores/taskStore.ts');
                const ts = (mod as {
                    useTaskStore: { getState: () => { activeTasks: Array<{ id: string; progress: number }> } };
                }).useTaskStore.getState();
                return ts.activeTasks.find((t) => t.id === 'rat_10')?.progress ?? -1;
            });
            expect(afterRatEpic).toBe(14);
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
