/**
 * Atomic E2E — task progress respects monster ID matching + rarity
 * multiplier (BACKLOG 7.2).
 *
 * Spec coverage:
 *  - 7.2 -> "Task: rarity-based count w walce". Tasks in `src/data/tasks.json`
 *    are keyed to a single `monsterId` (e.g. `rat_10` requires 10 rat
 *    kills). The contract has two parts:
 *      1. Kills of OTHER monsters MUST NOT advance the task — `taskStore.addKill`
 *         (taskStore.ts line 89) bails when `t.monsterId !== monsterId`.
 *      2. Kills of the SAME monster advance `progress` by
 *         `MONSTER_RARITY_TASK_KILLS[rarity]` (lootSystem.ts line 48):
 *         normal=1, strong=3, epic=10, legendary=50, boss=200. The engine
 *         applies this multiplier at the call site (combatEngine.ts line
 *         1138 / 1278 / 2573 / 2998) and passes it to `addKill` as the
 *         third arg.
 *
 * Test strategy:
 *  We exercise both parts via `killMonsterViaEngine` (the live-combat
 *  reward path that runs `handleMonsterDeath`'s full reward flow — same
 *  one production hits). SKIP-resolve (`runCombatViaSkip`) would also
 *  work for the multiplier path but `killMonsterViaEngine` also lets us
 *  pick the rarity directly without depending on the RNG roll inside
 *  `resolveInstantFight`. We need a deterministic rarity to assert the
 *  exact progress delta.
 *
 * Phase A — wrong-monster kill must NOT advance:
 *  Seed Knight lvl 5 with active `rat_10` task (progress=0). Spider is
 *  unlocked at lvl 2 (per default progression rules), so the Knight can
 *  legitimately kill it. Call `killMonsterViaEngine(page, 'cave_spider',
 *  'normal')`. Assert `activeTasks[0].progress === 0` — the spider kill
 *  was a no-op for the rat task.
 *
 *  This is critical because if `addKill` regressed to match by-anything
 *  (e.g. someone accidentally drops the `monsterId` guard at taskStore.ts
 *  line 89), every kill would advance every task — silently. Pinning
 *  monster-ID specificity here protects against that.
 *
 * Phase B — matching monster + rarity multiplier:
 *  Same task, same character (continues in the same test for clarity).
 *  Call `killMonsterViaEngine(page, 'rat', 'normal')` -> expect
 *  `progress === 1` (normal = ×1).
 *  Then call `killMonsterViaEngine(page, 'rat', 'strong')` -> expect
 *  `progress === 4` (1 + strong×3 = 4).
 *  Then call `killMonsterViaEngine(page, 'rat', 'epic')` -> expect
 *  `progress === 14` (4 + epic×10 = 14).
 *
 *  Three different rarities prove the multiplier table is consulted per
 *  kill, not a fixed +1 regardless of rarity. The math (1->4->14) is
 *  unambiguous: any other multiplier set produces a different sequence,
 *  so the assertion has only one passing path.
 *
 * Why not seed a "rarity-based task" (the brief's literal wording):
 *  `tasks.json` doesn't have rarity-keyed tasks — every entry binds a
 *  single `monsterId` + `killCount`. The rarity factor enters at the
 *  KILL site (engine passes `MONSTER_RARITY_TASK_KILLS[rarity]` as the
 *  `killCount` argument to `addKill`). This test pins THAT contract,
 *  which is the actual "rarity-based count" mechanism in the codebase.
 *  Quest goals support `kill_rarity` (questStore.ts line 9) but tasks
 *  do not, so a literal "rare-rarity-only task" cannot exist with the
 *  current schema.
 *
 * Cleanup: try/finally + cleanupCharacterById.
 */

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
            // 1. Knight lvl 5 — well above both rat (lvl 1) + cave_spider
            //    (lvl 2) so neither bails at the level check inside
            //    `handleMonsterDeath` reward path. hp_regen/mp_regen=0
            //    pins HP between engine calls so no auto-potion fires.
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: { level: 5, highest_level: 5, hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            // 2. Seed active `rat_10` task at progress=0. Values match
            //    src/data/tasks.json line 2-10 — single source of truth
            //    so a JSON tweak that changes killCount/rewards is caught
            //    in code review.
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

            // 3. Login + Town hydration — required by killMonsterViaEngine
            //    (it asserts `useCharacterStore.character !== null` and
            //    we need the task slice to be applied to in-memory store
            //    via `applyBlobToStores` triggered by character pick).
            await loginViaUI(page, testUsers.primary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 10_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
            await expect(page.locator('.town__char-name')).toHaveText(nick, { timeout: 10_000 });

            // 4. Sanity guard — task hydrated into taskStore correctly.
            const initial = await page.evaluate(async () => {
                // @ts-expect-error — dev-time Vite URL not resolvable by tsc
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

            // -- Phase A: wrong-monster kill must NOT advance the rat task --
            //
            // Kill a cave_spider (a different monster) with normal rarity.
            // The reward flow runs (gold, XP, mastery progress, etc.) but
            // `taskStore.addKill('cave_spider', ...)` finds no matching
            // task (because activeTasks[0].monsterId === 'rat') and is a
            // no-op for rat_10. Regression guard: if `addKill` ever drops
            // the monsterId guard, this assertion fails.
            await killMonsterViaEngine(page, 'cave_spider', 'normal');

            const afterSpider = await page.evaluate(async () => {
                // @ts-expect-error — dev-time Vite URL not resolvable by tsc
                const mod = await import('/src/stores/taskStore.ts');
                const ts = (mod as {
                    useTaskStore: { getState: () => { activeTasks: Array<{ id: string; progress: number }> } };
                }).useTaskStore.getState();
                return ts.activeTasks.find((t) => t.id === 'rat_10')?.progress ?? -1;
            });
            expect(afterSpider).toBe(0);

            // -- Phase B: matching monster, normal rarity -> +1 --
            //
            // MONSTER_RARITY_TASK_KILLS.normal = 1 (lootSystem.ts line 49).
            // `handleMonsterDeath` (combatEngine.ts line 1138) passes
            // `taskKills = 1` to `addKill` -> progress goes 0 -> 1.
            await killMonsterViaEngine(page, 'rat', 'normal');

            const afterRatNormal = await page.evaluate(async () => {
                // @ts-expect-error — dev-time Vite URL not resolvable by tsc
                const mod = await import('/src/stores/taskStore.ts');
                const ts = (mod as {
                    useTaskStore: { getState: () => { activeTasks: Array<{ id: string; progress: number }> } };
                }).useTaskStore.getState();
                return ts.activeTasks.find((t) => t.id === 'rat_10')?.progress ?? -1;
            });
            expect(afterRatNormal).toBe(1);

            // -- Phase C: matching monster, strong rarity -> +3 --
            //
            // MONSTER_RARITY_TASK_KILLS.strong = 3 -> progress 1 -> 4.
            await killMonsterViaEngine(page, 'rat', 'strong');

            const afterRatStrong = await page.evaluate(async () => {
                // @ts-expect-error — dev-time Vite URL not resolvable by tsc
                const mod = await import('/src/stores/taskStore.ts');
                const ts = (mod as {
                    useTaskStore: { getState: () => { activeTasks: Array<{ id: string; progress: number }> } };
                }).useTaskStore.getState();
                return ts.activeTasks.find((t) => t.id === 'rat_10')?.progress ?? -1;
            });
            expect(afterRatStrong).toBe(4);

            // -- Phase D: matching monster, epic rarity -> +10 --
            //
            // MONSTER_RARITY_TASK_KILLS.epic = 10 -> progress 4 -> 14.
            // Task killCount=10, so progress is now >= killCount -> claimable.
            // (We don't assert the claimable state here — that's covered by
            // 7.10 / 7.12. The math is the load-bearing assertion.)
            await killMonsterViaEngine(page, 'rat', 'epic');

            const afterRatEpic = await page.evaluate(async () => {
                // @ts-expect-error — dev-time Vite URL not resolvable by tsc
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
