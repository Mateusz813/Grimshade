
import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { seedQuestState } from '../../fixtures/seedQuestState';
import { waitForAppReady } from '../../fixtures/appReady';

test.describe('City › Offline Hunt', { tag: '@city' }, () => {
    test.describe.configure({ timeout: 90_000 });

    test('claim offline hunt against rat advances active rat_10 task progress past killCount threshold', async ({ page }) => {
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

            await waitForAppReady(page);

            const prePogress = await page.evaluate(async () => {
                const mod = await import('/src/stores/taskStore.ts');
                const t = mod.useTaskStore.getState().activeTasks[0];
                return t ? { id: t.id, progress: t.progress, killCount: t.killCount } : null;
            });
            expect(prePogress).not.toBeNull();
            expect(prePogress?.id).toBe('rat_10');
            expect(prePogress?.progress).toBe(0);
            expect(prePogress?.killCount).toBe(10);

            const result = await page.evaluate(async () => {
                const [ohMod, monsterMod, ohSysMod, taskMod] = await Promise.all([
                    import('/src/stores/offlineHuntStore.ts'),
                    import('/src/data/monsters.json'),
                    import('/src/systems/offlineHuntSystem.ts'),
                    import('/src/stores/taskStore.ts'),
                ]);
                const hadCrash = false;
                let kills = 0;
                let taskProgressAfter = 0;
                try {
                    const monsters = (monsterMod.default ?? monsterMod) as Array<{ id: string; level: number; }>;
                    const rat = monsters.find((m) => m.id === 'rat');
                    if (!rat) throw new Error('[test 5.14] rat not found in monsters.json');
                    ohMod.useOfflineHuntStore.getState().startHunt(rat as Parameters<typeof ohMod.useOfflineHuntStore.getState.prototype.startHunt>[0] extends infer T ? T : never, 'sword_fighting');
                    const TWELVE_H_MS = 12 * 60 * 60 * 1000;
                    ohMod.useOfflineHuntStore.setState({
                        startedAt: new Date(Date.now() - TWELVE_H_MS - 1000).toISOString(),
                    });
                    const claimResult = ohSysMod.claimOfflineHunt();
                    if (!claimResult) {
                        return { hadCrash: false, kills: 0, taskProgressAfter: 0 };
                    }
                    kills = claimResult.kills;
                    const taskAfter = taskMod.useTaskStore.getState().activeTasks[0];
                    taskProgressAfter = taskAfter?.progress ?? -1;
                    return { hadCrash, kills, taskProgressAfter };
                } catch (e) {
                    return { hadCrash: true, kills, taskProgressAfter, error: String(e) };
                }
            });

            expect(result.hadCrash, `claim threw — ${'error' in result ? result.error : 'no error string'}`).toBe(false);
            expect(result.kills).toBeGreaterThan(0);
            expect(result.taskProgressAfter).toBeGreaterThanOrEqual(10);
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
