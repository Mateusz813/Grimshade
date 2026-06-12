/**
 * Atomic E2E — active task on the currently fought monster shows in
 * the global TopHeader `TaskBadge` with the `--live` modifier
 * (BACKLOG 7.5).
 *
 * Spec coverage:
 *  - 7.5 -> "Task + quest pokazują się w header podczas walki". The
 *    `TaskBadge` is the global task/quest chip in `TopHeader`
 *    (TopHeader.tsx line 316) — visible on every character-loaded
 *    screen including Combat (AppShell mounts `<TopHeader>` whenever
 *    `showChrome===true`, regardless of `combatHudActive`).
 *
 *  The badge contract per `TaskBadge.tsx`:
 *    - Renders nothing when `activeTasks.length === 0 && activeQuests.length === 0`.
 *    - Renders `.top-header__tasks-btn` with `.top-header__tasks-count`
 *      = total active rows (line 159-170).
 *    - Adds `--live` modifier (line 163) when at least one row's
 *      monster matches `combatStore.baseMonster.id` and the player is
 *      in active combat (`phase !== 'idle' || backgroundActive`).
 *    - Tapping the button reveals `.top-header__tasks-dropdown` with
 *      one `.top-header__task-row` per task/quest (line 181-209).
 *    - A live row gets `.top-header__task-row--live` modifier + a
 *      visible "LIVE" tag (`.top-header__task-row-live-tag`).
 *
 * Test strategy:
 *  Seed Knight lvl 5 with active `rat_10` task. Login + Town hydrates
 *  the badge (visible with count "1" but no `--live` because we're not
 *  fighting yet). Then stage `phase='fighting'` against rat via
 *  `initCombat` (the same engine call live combat would do at the
 *  start of a fight — combatStore.ts line 192-200). After the stage,
 *  the badge MUST flip to `--live` for that row.
 *
 *  Why we don't navigate to /combat and start a real fight:
 *  Real fight start chains into the attack-tick loop + auto-fight after-
 *  victory transitions. We only need `phase='fighting'` + `baseMonster=rat`
 *  to satisfy the badge's "is the player fighting this task's monster"
 *  predicate. `initCombat` sets exactly those two fields synchronously
 *  (combatStore.ts initCombat impl), giving a deterministic state for
 *  the badge to read.
 *
 * Three assertion buckets:
 *
 *  A) Before combat — `.top-header__tasks-btn` visible with count "1",
 *     no `--live` modifier (we're in Town, not fighting).
 *  B) After `initCombat(rat)` — `.top-header__tasks-btn--live` modifier
 *     applied (the rat task row is now "live").
 *  C) Dropdown open — the single task row has `--live` modifier + LIVE
 *     tag visible. Proves the visual treatment cascades from button ->
 *     row.
 *
 * Why we use SECONDARY account:
 *  Suite runs concurrent on primary. Secondary is the parallel slot
 *  per task brief.
 *
 * Cleanup: try/finally + cleanupCharacterById.
 */

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
            // 1. Knight lvl 5 on SECONDARY. hp_regen=0 to keep state
            //    deterministic after initCombat stages HP.
            const created = await createCharacterViaApi({
                userEmail: testUsers.secondary.email,
                name: nick,
                class: 'Knight',
                overrides: { level: 5, highest_level: 5, hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            // 2. Seed active rat_10 task (progress=0, just-started state).
            //    The badge only cares about "this row's monsterId matches
            //    baseMonster.id" — progress value is for the dropdown
            //    display only, not the --live decision.
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

            // 3. Login -> pick -> Town. TopHeader mounts, TaskBadge sees
            //    the seeded activeTask and renders the button.
            await loginViaUI(page, testUsers.secondary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 10_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
            await expect(page.locator('.town__char-name')).toHaveText(nick, { timeout: 10_000 });

            // -- Bucket A — pre-combat baseline -------------------------
            //
            // Button visible with count "1". --live MUST NOT be set
            // (we're in Town, phase=idle, baseMonster=null).
            const tasksBtn = page.locator('.top-header__tasks-btn');
            await expect(tasksBtn).toBeVisible({ timeout: 10_000 });
            await expect(tasksBtn.locator('.top-header__tasks-count')).toHaveText('1');
            await expect(tasksBtn).not.toHaveClass(/top-header__tasks-btn--live/);

            // -- Bucket B — stage combat against rat, expect --live ------
            //
            // Same engine call live combat would do at fight start:
            // `useCombatStore.getState().initCombat(monster, hp, mp, rarity)`
            // sets `phase='fighting'` + `baseMonster=monster` + `monster=monster`
            // synchronously (combatStore.ts initCombat impl). The badge's
            // `inActiveCombat` predicate (TaskBadge.tsx line 68) flips
            // to true -> `liveMonsterId` = rat -> row.live = true -> button
            // gets --live class.
            await page.evaluate(async () => {
                // @ts-expect-error — dev-time Vite URL not resolvable by tsc
                const engineMod = await import('/src/systems/combatEngine.ts');
                // @ts-expect-error — dev-time Vite URL not resolvable by tsc
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

                // hp=120/mp=30 = full Knight stats — anything > 0 works for
                // the badge predicate (it doesn't read HP). Rarity 'normal'.
                useCombatStore.getState().initCombat(rat, 120, 30, 'normal');
            });

            // React state subscriptions (TaskBadge uses `useCombatStore`
            // selectors at lines 64-67) re-render on the next animation
            // frame after the engine call. Poll the button class to allow
            // the React commit to flush.
            await expect(tasksBtn).toHaveClass(/top-header__tasks-btn--live/, { timeout: 5_000 });
            // Count unchanged at "1" — we didn't add another task.
            await expect(tasksBtn.locator('.top-header__tasks-count')).toHaveText('1');
            // No `--claimable` modifier — task progress=0 is nowhere near
            // killCount=10, so claimableCount param to TaskBadge stays 0.
            await expect(tasksBtn).not.toHaveClass(/top-header__tasks-btn--claimable/);

            // -- Bucket C — open dropdown, assert live tag on the row ---
            //
            // Tap the badge button -> `.top-header__tasks-dropdown` opens.
            // Inside, the single row gets the `--live` modifier + a
            // visible LIVE tag span (TaskBadge.tsx line 197-202).
            await tasksBtn.tap();
            const dropdown = page.locator('.top-header__tasks-dropdown');
            await expect(dropdown).toBeVisible({ timeout: 5_000 });

            const liveRow = dropdown.locator('.top-header__task-row--live');
            await expect(liveRow).toHaveCount(1);
            // LIVE tag visible inside the row (the visual cue for the
            // player — pulses next to the monster name).
            await expect(liveRow.locator('.top-header__task-row-live-tag')).toBeVisible();
            // Row text contains the monster name + the task killCount
            // (the row label is `${name} ×${killCount}` per TaskBadge.tsx
            // line 95). For Szczur: "Szczur ×10".
            await expect(liveRow).toContainText('Szczur');
            await expect(liveRow.locator('.top-header__task-row-progress')).toContainText('0/10');
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
