/**
 * Atomic E2E — active training skill gains XP through combat-driven path
 * and the popup reflects the new level (BACKLOG 9.1 full coverage).
 *
 * Spec (BACKLOG.md punkt 9.1): "Active training: poziomy się wbijają na
 * wybranym skillu". Sibling test `active-skill-ui-renders.spec.ts` covers
 * the bare popup render on a fresh character (Lv 0 / 0 XP everywhere).
 * THIS test pins the level-up TRAJECTORY — combat happens, weapon-skill
 * XP accrues, level ticks up, popup re-renders with the new pill.
 *
 * Knight's primary weapon skill (per `CLASS_WEAPON_SKILL` in
 * `src/systems/skillSystem.ts` line 203) is **`sword_fighting`**. The
 * brief mentioned `shield_bash` but `shield_bash` is an ACTIVE skill
 * (slotted on action bar, cast manually / auto), not a TRAINABLE stat.
 * The Trening popup body lists `getTrainableStatsForClass('Knight')` =
 * `['sword_fighting', 'shielding', 'attack_speed', 'max_hp', 'max_mp',
 *  'hp_regen', 'mp_regen', 'defense', 'crit_chance', 'crit_dmg']` —
 * a flat union of class weapon skills + GENERAL_TRAINABLE_STATS. So we
 * pick `sword_fighting` (Knight's weapon skill), which is also the skill
 * that `addWeaponSkillXpFromAttack(Knight)` increments at line 404 of
 * `skillStore.ts`.
 *
 * ## XP math
 *
 * `skillXpToNextLevel(0)` returns **100** (skillSystem.ts line 8-11:
 * `if (skillLevel <= 0) return 100`). Every attack tick line at
 * combatEngine.ts line 1709 calls `addWeaponSkillXpFromAttack(class)`
 * → `addSkillXp(skillId, 1)`. So 110 simulated attacks → 110 XP →
 * `processSkillXp(0, 0, 110)` returns `{ newLevel: 1, remainingXp: 10 }`.
 * Popup re-renders: `Lv 1` + `10 / X XP` (X = `skillXpToNextLevel(1) =
 * ceil(100 * 1^1.8) = 100`).
 *
 * ## Pragmatic strategy (matches brief: "if exact XP threshold tricky,
 * just verify XP delta > 0 after fights")
 *
 * The combat-sim helpers (`runCombatViaSkip`, `killMonsterViaEngine`)
 * DO NOT call `addWeaponSkillXpFromAttack` — SKIP mode uses
 * `resolveInstantFight` which short-circuits attack-tick logic, and
 * `handleMonsterDeath` (live-combat path) doesn't run attack-ticks
 * either, just consumes the kill aftermath. Weapon-skill XP accrues
 * only via `doPlayerAttackTick` line 1709.
 *
 * To get authentic engine-driven XP without driving a real-time fight:
 * we invoke `addWeaponSkillXpFromAttack(Knight)` directly via
 * page.evaluate — that's the EXACT call site of the engine on every
 * attack tick. 110 calls simulates 110 attacks (a realistic mid-fight
 * skill-XP accrual; the player burns through 110 attacks killing
 * mid-tier mobs in a sustained hunt session).
 *
 * To honor "use combatSim to run multiple SKIP fights" we ALSO run 3
 * SKIP fights before the XP simulation — this exercises the full combat
 * loop (combatStore transitions, settingsStore speed flips, store
 * cleanup between fights) and proves the popup still works after combat
 * activity, not in isolation. The SKIP fights themselves don't grant
 * weapon-skill XP, but they prove the combat loop and the skill XP path
 * coexist cleanly in the same test scope.
 *
 * ## Assertions
 *
 * 1. Pre-state: Trening popup shows `sword_fighting` card with `Lv 0`
 *    + XP text `0 / 100 XP`.
 * 2. Run 3× SKIP fights via combatSim.runCombatViaSkip — proves combat
 *    loop runs without crashing the test fixture or polluting skill
 *    state.
 * 3. Snapshot skillLevels + skillXp BEFORE simulated XP grants — should
 *    still be 0 / 0 (SKIP doesn't grant weapon-skill XP).
 * 4. Invoke `addWeaponSkillXpFromAttack` 110× via page.evaluate.
 * 5. Snapshot skillLevels + skillXp AFTER — sword_fighting level === 1,
 *    XP === 10 (110 XP - 100 to level → 10 remainder).
 * 6. Re-open Trening popup (close + re-tap because popup body memoizes).
 *    Sword Fighting card now shows `Lv 1`.
 * 7. Defensive: XP delta > 0 fallback assertion per brief (already
 *    covered by exact-value assertions above, but documents that the
 *    test would catch ANY regression that zeros out XP gains).
 *
 * ## Cleanup
 *
 * try/finally + cleanupCharacterById. game_saves blob cascade nukes
 * skills slice on character delete.
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../fixtures/testUsers';
import { loginViaUI } from '../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../fixtures/createCharacter';
import { cleanupCharacterById } from '../fixtures/cleanup';
import { seedGameSave } from '../fixtures/seedGameSave';
import { findUserIdByEmail } from '../fixtures/adminClient';
import { runCombatViaSkip } from '../fixtures/combatSim';

test.describe('Training › Active', { tag: '@training' }, () => {
    test.describe.configure({ timeout: 90_000 });

    test('skill_xp gain from combat ticks → sword_fighting Lv 0 → Lv 1 + popup updates', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            // 1. Seed Knight lvl 5 on PRIMARY. Level 5 keeps things modest;
            //    higher level would mean `skillXpToNextLevel` doesn't change
            //    for the trainable stat but tests would take longer. We
            //    don't override skillLevels — sword_fighting starts at 0.
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: { level: 5, highest_level: 5, hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            // 2. Seed skills slice with `sword_fighting` chosen as the
            //    active training stat. The training stat is tracked on
            //    `useSkillStore.offlineTrainingSkillId`, but the schema
            //    in characterScope.ts persists it via the `skills`
            //    STORE_ENTRY (linia 191-198). We use seedGameSave's
            //    `skills` slot which only feeds activeSkillSlots/
            //    unlockedSkills/skillLevels, NOT offlineTrainingSkillId
            //    (which `selectTrainingStat` writes via UI flow).
            //    So we set offlineTrainingSkillId at runtime instead via
            //    `useSkillStore.setState` after hydration — cleaner than
            //    extending seedGameSave just for this one test.
            //
            //    The seed call below is technically optional (nothing in
            //    activeSkillSlots etc. needed) but it ensures the skills
            //    slice exists with the _entryOwner stamp so applyBlobToStores
            //    doesn't refuse to hydrate. Fresh characters get the
            //    defaults; we don't want hidden race conditions.
            const userId = await findUserIdByEmail(testUsers.primary.email);
            if (!userId) throw new Error('User lookup failed for primary');
            await seedGameSave({
                characterId: created.id,
                userId,
                skills: {
                    activeSkillSlots: [null, null, null, null],
                    unlockedSkills: {},
                    skillLevels: { sword_fighting: 0 },
                },
            });

            // 3. Login + character pick + Town hydration.
            await loginViaUI(page, testUsers.primary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 10_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
            await expect(page.locator('.town__char-name')).toHaveText(nick, { timeout: 10_000 });

            // 4. Set active training to sword_fighting via direct store
            //    mutation. UI equivalent: navigate /inventory → tap
            //    Trening → tap Sword Fighting card. We bypass to keep
            //    the test focused on the XP-accrual chain, not the
            //    select-card tap.
            await page.evaluate(async () => {
                // @ts-expect-error — dev-time Vite URL not resolvable by tsc
                const mod = await import('/src/stores/skillStore.ts');
                (mod as {
                    useSkillStore: {
                        getState: () => {
                            selectTrainingStat: (id: string | null) => void;
                        };
                    };
                }).useSkillStore.getState().selectTrainingStat('sword_fighting');
            });

            // 5. Open Trening popup + verify pre-state (Lv 0, 0 / 100 XP).
            await page.goto('/inventory');
            await expect(page.locator('.inventory__paperdoll-actions')).toBeVisible({ timeout: 10_000 });
            await page.getByRole('button', { name: /^trening skilli$/i }).tap();
            const popup = page.locator('.inventory__popup--training');
            await expect(popup).toBeVisible({ timeout: 5_000 });

            // Sword Fighting card — locate by its name text. SKILL_NAMES_PL
            // maps 'sword_fighting' → 'Walka Mieczem'. Card is a button.
            const swordCard = popup.locator('.inventory__training-card', {
                has: page.locator('.inventory__training-card-name', { hasText: 'Walka Mieczem' }),
            });
            await expect(swordCard).toBeVisible({ timeout: 5_000 });
            await expect(swordCard.locator('.inventory__training-card-level')).toContainText(/^Lv 0$/);
            await expect(swordCard.locator('.inventory__training-card-xp')).toContainText(/^0 \/ 100 XP$/);

            // 6. Close the popup so we can navigate elsewhere without UI
            //    overlap. Inventory popups use a modal pattern (`.inventory__popup`
            //    overlay container); pressing Escape or tapping the
            //    backdrop dismisses it. The PopupShell's close btn is
            //    `[aria-label="Zamknij"]` (Inventory.tsx popup chrome).
            const closeBtn = page.getByRole('button', { name: /zamknij/i }).first();
            if (await closeBtn.isVisible().catch(() => false)) {
                await closeBtn.tap();
            } else {
                // Fallback — press Escape
                await page.keyboard.press('Escape');
            }
            await expect(popup).toHaveCount(0, { timeout: 3_000 });

            // 7. Snapshot skill state pre-SKIP fights — should still be
            //    `level=0, xp=0` (no XP gained yet).
            const preFightState = await page.evaluate(async () => {
                // @ts-expect-error — dev-time Vite URL not resolvable by tsc
                const mod = await import('/src/stores/skillStore.ts');
                const s = (mod as {
                    useSkillStore: {
                        getState: () => {
                            skillLevels: Record<string, number>;
                            skillXp: Record<string, number>;
                        };
                    };
                }).useSkillStore.getState();
                return {
                    level: s.skillLevels['sword_fighting'] ?? 0,
                    xp: s.skillXp['sword_fighting'] ?? 0,
                };
            });
            expect(preFightState.level).toBe(0);
            expect(preFightState.xp).toBe(0);

            // 8. Run 3× SKIP fights — exercises the full combat loop
            //    around the skill-XP path. SKIP fights don't grant
            //    weapon-skill XP (resolveInstantFight bypasses
            //    addWeaponSkillXpFromAttack), so skillXp stays at 0 here.
            //    Proves the test fixture survives SKIP-fight noise +
            //    establishes that the combat scope isn't blocking
            //    skill-store mutations downstream.
            for (let i = 0; i < 3; i++) {
                const result = await runCombatViaSkip(page, 'rat');
                expect(result.phase).toBe('victory');
            }

            // 9. Snapshot post-SKIP — sword_fighting still 0/0 (SKIP doesn't
            //    grant weapon-skill XP). Critical regression: if a future
            //    refactor patches SKIP to award weapon XP too, this
            //    assertion would catch it and we'd update the test
            //    intentionally.
            const postSkipState = await page.evaluate(async () => {
                // @ts-expect-error — dev-time Vite URL not resolvable by tsc
                const mod = await import('/src/stores/skillStore.ts');
                const s = (mod as {
                    useSkillStore: {
                        getState: () => {
                            skillLevels: Record<string, number>;
                            skillXp: Record<string, number>;
                        };
                    };
                }).useSkillStore.getState();
                return {
                    level: s.skillLevels['sword_fighting'] ?? 0,
                    xp: s.skillXp['sword_fighting'] ?? 0,
                };
            });
            expect(postSkipState.level).toBe(0);
            expect(postSkipState.xp).toBe(0);

            // 10. Simulate 110 attack ticks: invoke `addWeaponSkillXpFromAttack`
            //     in a loop. This is the EXACT call site combatEngine.ts
            //     line 1709 makes on every player attack tick. 110 × 1 XP =
            //     110 XP total → processSkillXp(0, 0, 110) = { newLevel: 1,
            //     remainingXp: 10 }.
            //
            //     A real-time hunt session of 110 attacks @ 1.5s attack
            //     speed = 165s of combat. Driving that through Playwright
            //     would mean ~3 minutes of real-time + auto-fight chains +
            //     RNG variance. Direct loop = same code path, deterministic
            //     and ~10ms.
            await page.evaluate(async () => {
                // @ts-expect-error — dev-time Vite URL not resolvable by tsc
                const mod = await import('/src/stores/skillStore.ts');
                const skillStore = (mod as {
                    useSkillStore: {
                        getState: () => {
                            addWeaponSkillXpFromAttack: (cls: string) => number;
                        };
                    };
                }).useSkillStore;
                for (let i = 0; i < 110; i++) {
                    skillStore.getState().addWeaponSkillXpFromAttack('Knight');
                }
            });

            // 11. Snapshot post-XP — level === 1, xp === 10 (exact threshold
            //     math). This is the load-bearing assertion: it proves
            //     (a) addWeaponSkillXpFromAttack increments the right
            //     skillId for Knight (sword_fighting, not magic_level
            //     or some other), (b) processSkillXp correctly walks
            //     past the level-0 threshold of 100, (c) the leftover XP
            //     persists into skillXp['sword_fighting'] as remainder.
            const postXpState = await page.evaluate(async () => {
                // @ts-expect-error — dev-time Vite URL not resolvable by tsc
                const mod = await import('/src/stores/skillStore.ts');
                const s = (mod as {
                    useSkillStore: {
                        getState: () => {
                            skillLevels: Record<string, number>;
                            skillXp: Record<string, number>;
                        };
                    };
                }).useSkillStore.getState();
                return {
                    level: s.skillLevels['sword_fighting'] ?? 0,
                    xp: s.skillXp['sword_fighting'] ?? 0,
                };
            });
            // Brief permits "verify XP delta > 0" fallback. We assert
            // BOTH the exact level + the delta > 0 — fallback acts as
            // documentation that the contract is the level-up bump.
            expect(postXpState.level).toBe(1);
            expect(postXpState.xp).toBe(10);
            expect(postXpState.xp).toBeGreaterThan(preFightState.xp);
            expect(postXpState.level).toBeGreaterThan(preFightState.level);

            // 12. Re-open Trening popup → Sword Fighting card now shows
            //     `Lv 1` (was `Lv 0` pre-XP). Proves the popup body
            //     re-subscribes to skillStore after mutation — the
            //     TrainingPopupBody is `memo`-wrapped (Inventory.tsx
            //     line 1865) and reads via `useSkillStore((s) => s.skillLevels)`
            //     hook, so any skillLevels mutation triggers re-render
            //     once the popup remounts.
            await page.getByRole('button', { name: /^trening skilli$/i }).tap();
            const popupReopened = page.locator('.inventory__popup--training');
            await expect(popupReopened).toBeVisible({ timeout: 5_000 });

            const swordCardReopened = popupReopened.locator('.inventory__training-card', {
                has: page.locator('.inventory__training-card-name', { hasText: 'Walka Mieczem' }),
            });
            await expect(swordCardReopened).toBeVisible({ timeout: 5_000 });
            await expect(swordCardReopened.locator('.inventory__training-card-level')).toContainText(/^Lv 1$/);
            // XP text now `10 / 100 XP` — `skillXpToNextLevel(1) =
            // ceil(100 * 1^1.8) = 100`. The first `^` (post-level-up
            // threshold) happens to also be 100; subsequent levels grow.
            await expect(swordCardReopened.locator('.inventory__training-card-xp')).toContainText(/^10 \/ 100 XP$/);
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
