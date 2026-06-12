/**
 * Atomic E2E — claim offline hunt advances active task progress.
 *
 * Spec (BACKLOG.md 5.14): "Offline trening + task active -> task progress".
 *
 * Contract: `claimOfflineHunt` (offlineHuntSystem.ts line 356) calls
 *   useTaskStore.getState().addKill(monster.id, monster.level, weightedTaskKills);
 * where `weightedTaskKills` is the rarity-weighted kill count of the
 * hunt. After a successful claim, an active task for the SAME monster
 * id should have its `progress` field bumped by `weightedTaskKills`
 * (capped at `killCount` per taskStore.ts line 93).
 *
 * ## Test strategy — direct claim invocation (not full clock wait)
 *
 * Same approach as `full-inventory-edge.spec.ts`:
 *   1. Seed character + active `rat_10` task (10 rat kills needed).
 *   2. Start hunt against rat via page.evaluate.
 *   3. Backdate `startedAt` to fake 12h elapsed (max cap of hunt).
 *   4. Call `claimOfflineHunt`.
 *   5. Assert the active task's `progress` rose from 0 to something
 *      > 0 (uplifted to `killCount` if total weighted kills overflow).
 *
 * ## Why we set elapsed = 12h (the max cap)
 *
 * At max cap, killsByRarity.normal alone is ~4320 (4320s / 1s @ x1
 * mastery 0, normal weight = 1). MONSTER_RARITY_TASK_KILLS.normal = 1
 * per kill, plus per-rarity rolled overshoot from strong/legendary/boss
 * weighted multipliers, so `weightedTaskKills` lands in the 10k+ range —
 * trivially exceeds any reasonable `killCount` (10 here).
 *
 * Note: `taskStore.addKill` (taskStore.ts line 85-100) does NOT cap
 * the progress field at `killCount` — it raw-accumulates. The "ready
 * to claim" UI state is derived elsewhere via `progress >= killCount`.
 * So a passing test only needs `progress >= killCount`, not equality.
 *
 * Smaller elapsed times would also work but max-cap is the most
 * deterministic — if it fails to advance, it's a real bug not a
 * speed-roll fluke.
 *
 * ## Why SECONDARY account
 *
 * Suite runs on primary per task brief.
 *
 * ## Setup
 *
 *  1. Seed Knight lvl 5 on SECONDARY (rat unlocks at lvl 1).
 *  2. Seed `rat_10` active task (10 kills needed, progress=0).
 *
 * ## Flow + assertions
 *
 *  1. Login -> pick character -> Town.
 *  2. page.evaluate: sanity — taskStore.activeTasks[0].progress === 0.
 *  3. page.evaluate: start hunt against rat + backdate startedAt 12h.
 *  4. page.evaluate: call claimOfflineHunt, return snapshot.
 *  5. Assert:
 *     - claimResult.kills > 0 (hunt ran)
 *     - claimResult.weightedTaskKills NOT asserted directly (computed
 *       privately inside system) but observed via task progress.
 *     - active task progress >= killCount (10) — proves addKill ran
 *       with positive count, task is in "ready to claim" range.
 *
 * ## Cleanup
 *
 * try/finally -> cleanupCharacterById (wipes game_saves blob including
 * tasks slice + offlineHunt slice).
 */

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
            // 1. Seed Knight lvl 5 on SECONDARY (rat unlocked at lvl 1).
            const created = await createCharacterViaApi({
                userEmail: testUsers.secondary.email,
                name: nick,
                class: 'Knight',
                overrides: { level: 5, highest_level: 5, hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            // 2. Seed active `rat_10` task — 10 rat kills, progress=0.
            //    Mirrors `quests/tasks/one-per-monster.spec.ts` (BACKLOG 7.1)
            //    seed shape.
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

            // 3. Login -> pick character -> Town.
            await loginViaUI(page, testUsers.secondary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 10_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });

            // 3b. Hydration barrier — block until App.tsx restore() fully
            //     settled (cloud loadGame + applyBlobToStores + the
            //     restoring->AppRouter transition). Without this the
            //     page.evaluate store-pokes below race a late applyBlobToStores
            //     that overwrites our startHunt AND the React re-render the
            //     claim triggers, surfacing as "Execution context was
            //     destroyed, most likely because of a navigation". See
            //     fixtures/appReady.ts.
            await waitForAppReady(page);

            // 4. Sanity — task hydrated with progress=0.
            const prePogress = await page.evaluate(async () => {
                const mod = await import('/src/stores/taskStore.ts');
                const t = mod.useTaskStore.getState().activeTasks[0];
                return t ? { id: t.id, progress: t.progress, killCount: t.killCount } : null;
            });
            expect(prePogress).not.toBeNull();
            expect(prePogress?.id).toBe('rat_10');
            expect(prePogress?.progress).toBe(0);
            expect(prePogress?.killCount).toBe(10);

            // 5+6. Start hunt + backdate + claim + snapshot — ALL in ONE
            //      evaluate. Imports are awaited up-front (single Promise.all);
            //      every store mutation (startHunt -> backdate -> claimOfflineHunt
            //      -> read task) then runs SYNCHRONOUSLY with no `await` between
            //      them. React batches renders to the next tick, so it never
            //      flushes a re-render + HuntGuard/route change mid-sequence —
            //      which is what previously destroyed the execution context
            //      (separate evaluates left a window where startHunt's
            //      isActive=true redirect and the claim's isActive=false
            //      redirect raced the second evaluate).
            const result = await page.evaluate(async () => {
                const [ohMod, monsterMod, ohSysMod, taskMod] = await Promise.all([
                    import('/src/stores/offlineHuntStore.ts'),
                    import('/src/data/monsters.json'),
                    import('/src/systems/offlineHuntSystem.ts'),
                    import('/src/stores/taskStore.ts'),
                ]);
                let hadCrash = false;
                let kills = 0;
                let taskProgressAfter = 0;
                try {
                    const monsters = (monsterMod.default ?? monsterMod) as Array<{ id: string; level: number; }>;
                    const rat = monsters.find((m) => m.id === 'rat');
                    if (!rat) throw new Error('[test 5.14] rat not found in monsters.json');
                    // --- synchronous mutation block (no await -> no mid-render nav) ---
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

            // 7. Assertions.
            //    (a) No crash from claim.
            expect(result.hadCrash, `claim threw — ${'error' in result ? result.error : 'no error string'}`).toBe(false);
            //    (b) Hunt actually ran (4320 kills @ 12h cap, x1, mastery 0).
            expect(result.kills).toBeGreaterThan(0);
            //    (c) Task progress advanced. taskStore.addKill (taskStore.ts
            //        line 85-100) does a RAW additive increment — no cap
            //        at killCount. UI separately reads `progress >= killCount`
            //        to decide claim-ready state. At 12h cap ->
            //        weightedTaskKills is in the 10k+ range (4320 normal
            //        kills × 1 + per-rarity boss/legendary weighting),
            //        which trivially exceeds 10. Assert progress is
            //        ≥ killCount (10) so a "ready to claim" UI state would
            //        render — proves the chain reached `addKill` with a
            //        positive count.
            expect(result.taskProgressAfter).toBeGreaterThanOrEqual(10);
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
