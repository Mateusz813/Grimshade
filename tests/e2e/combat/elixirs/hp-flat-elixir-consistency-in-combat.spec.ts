/**
 * Atomic E2E — HP consistency on `/combat` view with active `hp_boost_500`
 * buff (flat +500 Max HP).
 *
 * Spec (BACKLOG.md punkt 3.6 expansion): "Eliksir +500 HP — to samo"
 *
 * Parallel test to `hp-pct-elixir-consistency-in-combat.spec.ts` —
 * verifies the SAME consistency on /combat for the FLAT (not %-based)
 * elixir variant. Flat elixir adds bonus BEFORE % multipliers:
 *   raw = base + equip + training + flatElixir + flatTransform
 *   eff = floor(raw × pctElixir × pctTransform)
 *
 * Without active pct elixir / transform, eff = raw, so for flat-only:
 *   raw = 120 (Knight base) + 0 + 0 + 500 + 0 = 620
 *   eff = floor(620 × 1.0 × 1.0) = 620
 *
 * Pokrywa COMBAT view (3.6-combat slice). 3-view subset (Town, TopHeader
 * popover in Town, CharacterSelect) pokryte przez
 * `shop/elixirs/hp-flat-elixir-consistency-across-views.spec.ts`.
 *
 * ## Why test both pct + flat on /combat
 *
 * `getElixirHpBonus()` (flat) and `getElixirHpPctMultiplier()` (pct) are
 * SEPARATE codepaths in `combatElixirs.ts`:
 *   - flat: `if (b.hasBuff('hp_boost_500')) return 500;` (linia ~30)
 *   - pct:  `if (b.hasBuff('hp_pct_25')) return 1.25;` (linia ~36)
 *
 * A regression in one doesn't necessarily appear in the other. The pct
 * test (`hp-pct-elixir-consistency-in-combat.spec.ts`) catches multiplier
 * bugs; THIS test catches additive bonus bugs.
 *
 * ## Setup
 *
 * - Knight, level 5, hp=40, hp_regen=0, mp_regen=0.
 * - Buff `hp_boost_500` (effect `hp_boost_500`).
 * - SECONDARY account per task brief.
 *
 * Cleanup: try/finally + `cleanupCharacterById`.
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { seedGameSave, findUserIdByEmail } from '../../fixtures/seedGameSave';
import { runCombatViaSkip } from '../../fixtures/combatSim';

test.describe('Combat › Elixirs', { tag: '@combat' }, () => {
    test.describe.configure({ timeout: 90_000 });

    test('hp_boost_500 buff active → /combat TopHeader popover shows boosted max HP + engine getEffectiveChar agrees + SKIP fight resolves', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            // 1. Seed Knight lvl 5 on SECONDARY.
            const created = await createCharacterViaApi({
                userEmail: testUsers.secondary.email,
                name: nick,
                class: 'Knight',
                overrides: { hp: 40, mp: 15, level: 5, highest_level: 5, hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            // 2. Seed buff. effect `hp_boost_500` is read by
            //    `getElixirHpBonus` (combatElixirs.ts) → returns 500 when
            //    buff active. Pausable timerMode → no drain out-of-combat.
            const userId = await findUserIdByEmail(testUsers.secondary.email);
            await seedGameSave({
                characterId: createdId,
                userId,
                buffs: [
                    {
                        id: 'hp_boost_500',
                        name: '+500 Max HP',
                        icon: '🩸',
                        effect: 'hp_boost_500',
                    },
                ],
            });

            // 3. Login + Town hydration.
            await loginViaUI(page, testUsers.secondary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 15_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
            await expect(page.locator('.town__char-name')).toHaveText(nick, { timeout: 10_000 });

            // 4. Sanity: buff live in runtime store.
            const hasBuffAtTown = await page.evaluate(async () => {
                // @ts-expect-error — dev-time Vite URL not resolvable by tsc
                const mod = await import('/src/stores/buffStore.ts');
                return (mod as {
                    useBuffStore: { getState: () => { hasBuff: (e: string) => boolean } };
                }).useBuffStore.getState().hasBuff('hp_boost_500');
            });
            expect(hasBuffAtTown).toBe(true);

            // 5. Navigate to /combat directly (battle-hub UI flow covered
            //    by `battle/*` smoke tests; here we only care about the
            //    /combat HP rendering).
            await page.goto('/combat');
            await expect(page.locator('.combat__hub-monsters, .combat__hub-empty').first())
                .toBeVisible({ timeout: 10_000 });

            // 6. Open TopHeader popover, read HP.
            //    Expect `40/620` (Knight base 120 + 500 flat = 620).
            const pulseBtn = page.locator('.top-header__pulse').first();
            await expect(pulseBtn).toBeVisible({ timeout: 5_000 });
            await pulseBtn.tap();
            const popoverHp = await page
                .locator('.top-header__pulse-popover-row--hp .top-header__pulse-popover-val')
                .first()
                .textContent();
            expect(popoverHp?.trim()).toBe('40/620');

            // 7. Cross-check engine-level effective max HP.
            const engineMaxHp = await page.evaluate(async () => {
                // @ts-expect-error — dev-time Vite URL not resolvable by tsc
                const engineMod = await import('/src/systems/combatEngine.ts');
                // @ts-expect-error — dev-time Vite URL not resolvable by tsc
                const charMod = await import('/src/stores/characterStore.ts');
                const engine = engineMod as {
                    getEffectiveChar: (c: unknown) => { max_hp: number } | null;
                };
                const ch = (charMod as {
                    useCharacterStore: { getState: () => { character: unknown } };
                }).useCharacterStore.getState().character;
                const eff = engine.getEffectiveChar(ch);
                return eff?.max_hp ?? null;
            });
            expect(engineMaxHp).toBe(620);

            // 8. Verify flat bonus helper actually fires.
            const flatBonus = await page.evaluate(async () => {
                // @ts-expect-error — dev-time Vite URL not resolvable by tsc
                const mod = await import('/src/systems/combatElixirs.ts');
                return (mod as { getElixirHpBonus: () => number }).getElixirHpBonus();
            });
            expect(flatBonus).toBe(500);

            // 9. SKIP fight against rat — proves combat path tolerates flat
            //    bonus without breaking. If the flat 500 propagated through
            //    `playerCurrentHp` clamping as a string concat (e.g. 120+500
            //    became '120500'), the engine would NaN out on subsequent
            //    Math.min calls.
            const result = await runCombatViaSkip(page, 'rat');
            expect(result.phase).toBe('victory');
            expect(result.earnedXp).toBeGreaterThan(0);
            expect(result.sessionKills.normal).toBeGreaterThanOrEqual(1);

            // 10. Buff still alive post-fight.
            const hasBuffAfter = await page.evaluate(async () => {
                // @ts-expect-error — dev-time Vite URL not resolvable by tsc
                const mod = await import('/src/stores/buffStore.ts');
                return (mod as {
                    useBuffStore: { getState: () => { hasBuff: (e: string) => boolean } };
                }).useBuffStore.getState().hasBuff('hp_boost_500');
            });
            expect(hasBuffAfter).toBe(true);
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
