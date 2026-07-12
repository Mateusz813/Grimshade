
import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';

interface ITransformSnapshot {
    completedTransforms: number[];
    activeQuestId: number | null;
    defeatedCount: number;
    totalCount: number;
    pendingClaimId: number | null;
}

const getTransformSnapshot = async (
    page: import('@playwright/test').Page,
): Promise<ITransformSnapshot> => {
    return await page.evaluate(async (): Promise<ITransformSnapshot> => {
        const mod = await import('/src/stores/transformStore.ts');
        const state = (mod as {
            useTransformStore: {
                getState: () => {
                    completedTransforms: number[];
                    currentTransformQuest: {
                        transformId: number;
                        monstersDefeated: string[];
                        totalMonsters: number;
                    } | null;
                    pendingClaimTransformId: number | null;
                };
            };
        }).useTransformStore.getState();
        return {
            completedTransforms: [...state.completedTransforms],
            activeQuestId: state.currentTransformQuest?.transformId ?? null,
            defeatedCount: state.currentTransformQuest?.monstersDefeated.length ?? 0,
            totalCount: state.currentTransformQuest?.totalMonsters ?? 0,
            pendingClaimId: state.pendingClaimTransformId,
        };
    });
};

test.describe('Combat › Transform', { tag: '@combat' }, () => {
    test.describe.configure({ timeout: 90_000 });

    test('start -> defeat all monsters -> completeTransform: id in completedTransforms + pendingClaim lifecycle', async ({ page }) => {
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

            await loginViaUI(page, testUsers.primary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 10_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
            await expect(page.locator('.top-header')).toBeVisible({ timeout: 10_000 });

            const before = await getTransformSnapshot(page);
            expect(before.completedTransforms).toEqual([]);
            expect(before.activeQuestId).toBeNull();
            expect(before.pendingClaimId).toBeNull();

            const result = await page.evaluate(async (): Promise<{
                started: boolean;
                monsterCount: number;
                allDefeated: boolean;
                pendingBeforeComplete: number | null;
                completeReturned: number;
                claimReturned: number | null;
                pendingAfterClaim: number | null;
            }> => {
                const storeMod = await import('/src/stores/transformStore.ts');
                const sysMod = await import('/src/systems/transformSystem.ts');

                const useTransformStore = (storeMod as {
                    useTransformStore: {
                        getState: () => {
                            startTransformQuest: (id: number, lvl: number) => boolean;
                            defeatMonster: (id: string) => boolean;
                            completeTransform: () => number;
                            claimPendingReward: () => number | null;
                            currentTransformQuest: {
                                monstersDefeated: string[];
                                totalMonsters: number;
                            } | null;
                            pendingClaimTransformId: number | null;
                        };
                    };
                }).useTransformStore;
                const getTransformMonsters = (sysMod as {
                    getTransformMonsters: (id: number) => Array<{ id: string }>;
                }).getTransformMonsters;

                const started = useTransformStore.getState().startTransformQuest(1, 30);

                const monsters = getTransformMonsters(1);

                for (const m of monsters) {
                    useTransformStore.getState().defeatMonster(m.id);
                }

                const pendingBeforeComplete = useTransformStore.getState().pendingClaimTransformId;

                const q = useTransformStore.getState().currentTransformQuest;
                const allDefeated = q ? q.monstersDefeated.length >= q.totalMonsters : false;

                const completeReturned = useTransformStore.getState().completeTransform();

                const claimReturned = useTransformStore.getState().claimPendingReward();

                const pendingAfterClaim = useTransformStore.getState().pendingClaimTransformId;

                return {
                    started,
                    monsterCount: monsters.length,
                    allDefeated,
                    pendingBeforeComplete,
                    completeReturned,
                    claimReturned,
                    pendingAfterClaim,
                };
            });


            expect(result.started).toBe(true);

            expect(result.monsterCount).toBe(30);

            expect(result.allDefeated).toBe(true);

            expect(result.pendingBeforeComplete).toBe(1);

            expect(result.completeReturned).toBe(1);

            expect(result.claimReturned).toBe(1);
            expect(result.pendingAfterClaim).toBeNull();

            const after = await getTransformSnapshot(page);
            expect(after.completedTransforms).toContain(1);
            expect(after.activeQuestId).toBeNull();
            expect(after.pendingClaimId).toBeNull();
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
