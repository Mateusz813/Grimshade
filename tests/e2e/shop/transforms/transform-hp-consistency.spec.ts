/**
 * Atomic E2E — Transform HP consistency across Town / TopHeader popover /
 * CharacterSelect for a Knight with tier 1 transform completed.
 *
 * Spec (BACKLOG 3.8): "Transform dający +HP → ta sama konsystencja"
 * (Town, TopHeader, CharacterSelect — i wszystkie inne widoki). Original
 * status ⚠️ partial because the seedGameSave fixture didn't yet support a
 * `transforms` slot — that was added in the 8.1 round (verified by the
 * `transforms: { completedTransforms: [1], bakedBonusesApplied: false }`
 * key on `seedGameSave` per fixtures/seedGameSave.ts line 206-215).
 * Now we can deterministically seed a tier-1 transform without needing
 * to walk through the transform completion combat flow.
 *
 * ## Math
 *
 * Knight class baseline (CLASS_BASE_STATS in createCharacter.ts line 65):
 *   max_hp = 120
 *
 * Knight tier 1 transform bonuses (transformSystem.ts line 221-236):
 *   flatHp = 420
 *   hpPercent = 4
 *
 * Effective max HP (mirrors getEffectiveChar logic in combatEngine.ts
 * line 800-811):
 *   rawMaxHp = baseMaxHp + eq.hp + tb.max_hp + getElixirHpBonus() + getTransformFlatHp()
 *            = 120 + 0 + 0 + 0 + 420
 *            = 540
 *   effMaxHp = floor(rawMaxHp × getElixirHpPctMultiplier() × getTransformHpPctMultiplier())
 *            = floor(540 × 1.0 × 1.04)
 *            = floor(561.6)
 *            = 561
 *
 * Town:                `.town__bar-value` → `${character.hp}/${effMaxHp}` → `40/561`
 * TopHeader popover:   `.top-header__pulse-popover-row--hp` → `40/561` (toLocaleString
 *                      adds no separator under 1000)
 * CharacterSelect:     `.char-select__bar-value` → `40/561`
 *   - CharSelect's `getEffectiveMaxStats` (CharacterSelect.tsx line 114)
 *     reads transforms via `getTransformMaxBonuses` (line 74) which calls
 *     `peekCharacterStore(charId, 'transforms')` reading from localStorage.
 *     Same calculation pipeline as engine: `(base+flat) × pctMul`.
 *
 * ## CRITICAL — legacy migration bypass
 *
 * `characterScope.ts` line 436-446 checks
 * `localStorage['tibia_transform_migration_v1_<charId>']`. Without the
 * marker the hydrator force-sets `bakedBonusesApplied: true` and runs
 * `migrateLegacyBakedBonuses` (which would MUTATE character.max_hp by
 * the seeded transform bonus, double-baking it into the stats).
 *
 * Solution: `page.addInitScript` sets the marker BEFORE the first
 * character pick, so the bakedBonusesApplied=false (seeded) survives
 * and `getLiveTransformBreakdown` returns active=true → transform flat
 * + % bonuses apply LIVE in every helper.
 *
 * Same caveat as the 8.1 expansion test
 * (`stats/popup-aggregates-with-transform.spec.ts` line 81-87).
 *
 * ## Why Knight tier 1 (not e.g. Mage tier 5)
 *
 * - Tier 1 = no time-based reasoning needed (the brief mentions
 *   "if transform expiry race blocks test, use tier=1 which is permanent").
 *   In the new live-apply model (post-Point-7 rewrite, transformBonuses.ts
 *   line 1-25), bonuses are derived from `completedTransforms[]` which
 *   is a persistent set — no expiresAt clock to race against.
 * - Knight = largest base HP (120) so the test name is unambiguous as a
 *   "+HP transform" demo. Other classes work identically (would be
 *   mechanical copy-paste of variants).
 * - flatHp=420 (largest in the per-class table at line 227) so the
 *   delta (120 → 561) is unambiguous in test output.
 *
 * ## Setup
 *
 *   1. Seed Knight lvl 5 on SECONDARY (suite on primary per task brief).
 *      hp=40, hp_regen=0, mp_regen=0 (CLAUDE.md TESTING — race-free).
 *   2. Seed game_saves with `transforms: { completedTransforms: [1],
 *      bakedBonusesApplied: false }` (see seedGameSave fixture line 375-383).
 *   3. `page.addInitScript` to set localStorage marker BEFORE character
 *      pick, bypassing legacy migration.
 *
 * ## Visit order — same as elixir consistency tests (3.5/3.6)
 *
 * /character-select → Wybierz (warms localStorage via switchToCharacter
 * → forceSaveCharacterData) → Town (asserts Town value + TopHeader popover
 * value) → /character-select (asserts CharSelect value with warmed
 * localStorage so getTransformMaxBonuses can peek it).
 *
 * Cleanup: try/finally + cleanupCharacterById (game_saves cascade kills
 * the transforms slice).
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { seedGameSave, findUserIdByEmail } from '../../fixtures/seedGameSave';

test.describe('Shop › Transforms', { tag: '@shop' }, () => {
    test.describe.configure({ timeout: 120_000 });

    test('Knight tier 1 transform (+420 flat HP + 4% HP) → Town, TopHeader popover, CharacterSelect all show 40/561 effective max HP', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            // 1. Seed Knight lvl 5 with hp=40 (under-max for visible delta)
            //    + zero regen (CLAUDE.md TESTING — race-free across multi-step
            //    assertions).
            const created = await createCharacterViaApi({
                userEmail: testUsers.secondary.email,
                name: nick,
                class: 'Knight',
                overrides: { hp: 40, mp: 15, level: 5, highest_level: 5, hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            // 2. Seed transforms slice in game_saves. `completedTransforms: [1]`
            //    = Knight tier 1 completed. `bakedBonusesApplied: false` means
            //    bonuses apply LIVE (per Point 7 rewrite in transformBonuses.ts
            //    line 1-25) instead of being pre-baked into character stats.
            const userId = await findUserIdByEmail(testUsers.secondary.email);
            await seedGameSave({
                characterId: createdId,
                userId,
                transforms: {
                    completedTransforms: [1],
                    bakedBonusesApplied: false,
                },
            });

            // 3. CRITICAL: set legacy-migration marker BEFORE any character
            //    pick. Without this, characterScope.ts line 436-446 forces
            //    bakedBonusesApplied=true + runs migrateLegacyBakedBonuses
            //    (which MUTATES character.max_hp by the seeded transform
            //    bonus, double-baking it into stats and breaking the math).
            //    `page.addInitScript` runs before every navigation's bundle
            //    initialization, so the marker is in place when characterScope
            //    inspects localStorage.
            await page.addInitScript((charId) => {
                try {
                    localStorage.setItem(`tibia_transform_migration_v1_${charId}`, '1');
                } catch { /* private mode / quota */ }
            }, createdId);

            // 4. Login → /character-select.
            await loginViaUI(page, testUsers.secondary);
            await page.goto('/character-select');
            await expect(page.locator('.char-select__card-name', { hasText: nick })).toBeVisible({ timeout: 15_000 });

            // 5. Tap "Wybierz" → Town. switchToCharacter → applyBlobToStores
            //    hydrates transforms slice into useTransformStore +
            //    forceSaveCharacterData writes blob to localStorage. After
            //    this step localStorage[`dungeon_rpg_save_char_${createdId}`]
            //    contains the seeded transforms slice — readable later by
            //    `peekCharacterStore`.
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
            await expect(page.locator('.town__char-name')).toHaveText(nick, { timeout: 10_000 });

            // 6. Sanity: useTransformStore is populated with the seeded
            //    transforms + bakedBonusesApplied=false. Without this gate,
            //    a legacy-migration regression (marker bypass failed) would
            //    silently leave bakedBonusesApplied=true and the live-apply
            //    path would skip transform bonuses entirely — every UI surface
            //    would show raw 40/120 and the test would pass-when-it-shouldn't.
            const storeState = await page.evaluate(async () => {
                // @ts-expect-error — dev-time Vite URL not resolvable by tsc
                const mod = await import('/src/stores/transformStore.ts');
                const s = (mod as {
                    useTransformStore: { getState: () => { completedTransforms: number[]; bakedBonusesApplied: boolean } };
                }).useTransformStore.getState();
                return { completed: [...s.completedTransforms], baked: s.bakedBonusesApplied };
            });
            expect(storeState.completed).toEqual([1]);
            expect(storeState.baked).toBe(false);

            // 7. Sanity: engine helper returns the expected effective max HP.
            //    Same helper Town/Combat/TopHeader feed from — proves the
            //    "live apply" path runs and the multiplier chain assembles
            //    the right value before any DOM rendering happens.
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
            // floor((120 + 0 + 0 + 0 + 420) × 1.0 × 1.04) = floor(561.6) = 561
            expect(engineMaxHp).toBe(561);

            // 8. Town: `.town__bar-value` shows `${hp}/${effMaxHp}` → "40/561".
            //    Town.tsx line 200-202: effMaxHp uses engineGetEffectiveChar.
            const townHp = await page
                .locator('.town__bar-wrap', { has: page.locator('.town__bar--hp') })
                .locator('.town__bar-value')
                .textContent();
            expect(townHp?.trim()).toBe('40/561');

            // 9. TopHeader pulse popover (`.top-header__pulse-popover-row--hp`).
            //    TopHeader.tsx line 193-194 reads getEffectiveChar(character).max_hp.
            //    pl-PL toLocaleString does NOT insert separator under 1000 →
            //    "40/561".
            const pulseBtn = page.locator('.top-header__pulse').first();
            await expect(pulseBtn).toBeVisible({ timeout: 5_000 });
            await pulseBtn.tap();
            const popoverHp = await page
                .locator('.top-header__pulse-popover-row--hp .top-header__pulse-popover-val')
                .first()
                .textContent();
            expect(popoverHp?.trim()).toBe('40/561');

            // 10. CharacterSelect: navigate back. `getEffectiveMaxStats`
            //     (CharacterSelect.tsx line 114) calls `getTransformMaxBonuses`
            //     (line 74) which reads `peekCharacterStore(charId, 'transforms')`
            //     → localStorage now has the warm save with transforms.
            //     Same math as engine: (120 + 0 + 0 + 0 + 420) × 1.04 = 561.6
            //     → floor = 561.
            await page.goto('/character-select');
            await expect(page.locator('.char-select__card-name', { hasText: nick })).toBeVisible({ timeout: 10_000 });
            const reloadedCard = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            const selectHpText = await reloadedCard
                .locator('.char-select__bar-wrap', { has: page.locator('.char-select__bar--hp') })
                .locator('.char-select__bar-value')
                .textContent();
            expect(selectHpText?.trim()).toBe('40/561');

            // 11. KRYTYCZNA ASERCJA: wszystkie 3 widoki ten sam string.
            //     Guards against helper-path divergence (one view applying
            //     the multiplier but another skipping it).
            expect(townHp?.trim()).toBe(popoverHp?.trim());
            expect(popoverHp?.trim()).toBe(selectHpText?.trim());
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
