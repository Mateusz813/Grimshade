/**
 * Atomic E2E — leveling across a gold-milestone credits the SPENDABLE wallet.
 *
 * Regression for the 2026-06-21 player report: "wbiłem 10 poziom i pisało że
 * dostaję 1cc nagrody a jej nie dostałem" (hit level 10, the +1cc reward was
 * announced but never received).
 *
 * Root cause: `characterStore.addXp` credited the gold-milestone reward to
 * `character.gold` (the `characters` DB column), but the gold the player sees
 * and spends lives in `inventoryStore.gold` (the game_saves blob — what
 * TopHeader renders, what the shop spends, what task rewards credit via
 * `addGold`). So the "+1cc" announcement fired but the wallet never moved.
 *
 * Fix: milestone gold now flows through `inventoryStore.addGold`. This test
 * proves the end-to-end result the player cares about:
 *   1. A Knight one XP-tick below level 10 dings level 10.
 *   2. inventoryStore.gold gains exactly the milestone (10 × 10000 = 100000 = 1cc).
 *   3. The TopHeader wallet visibly shows the cc tier (formatGoldShort(100000)
 *      = "1,00 cc") — i.e. the player actually has the gold.
 *
 * ## Setup
 *
 * - Knight, level 9, xp 0, gold 0, highest_level 9 (so crossing level 10 is a
 *   genuinely-new milestone, not a re-level after death which is gated out).
 *
 * ## Why drive addXp via page.evaluate
 *
 * Same pattern as the offline-hunt + combat-sim specs: a rat gives 3 XP, far
 * too little to ding level 9→10 in a reasonable number of kills. We import the
 * real characterStore + levelSystem in-page and call the production `addXp`
 * with exactly `xpToNextLevel(9)` — the same code path a real level-up runs,
 * just without grinding kills.
 *
 * Cleanup: try/finally + cleanupCharacterById.
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';

test.describe('Chrome › TopHeader', { tag: '@chrome' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('crossing a gold milestone (lvl 10) credits the spendable wallet + shows 1cc', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            // 1. Seed Knight one tick below level 10 with an empty wallet.
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: { level: 9, highest_level: 9, xp: 0, gold: 0 },
            });
            createdId = created.id;

            // 2. Login -> pick character -> Town (stores hydrated).
            await loginViaUI(page, testUsers.primary);
            await page.goto('/character-select');
            await expect(page.locator('.char-select__card-name', { hasText: nick }))
                .toBeVisible({ timeout: 10_000 });
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });
            await expect(page.locator('.town__char-name')).toHaveText(nick);

            // 3. Baseline: wallet starts empty.
            const beforeGold = await page.evaluate(async () => {
                // @ts-expect-error — dev-time Vite URL not resolvable by tsc
                const invMod = await import('/src/stores/inventoryStore.ts');
                return (invMod as {
                    useInventoryStore: { getState: () => { gold: number } };
                }).useInventoryStore.getState().gold;
            });
            expect(beforeGold).toBe(0);

            // 4. Ding exactly level 9 -> 10 via the production addXp path.
            const result = await page.evaluate(async () => {
                // @ts-expect-error — dev-time Vite URL not resolvable by tsc
                const charMod = await import('/src/stores/characterStore.ts');
                // @ts-expect-error — dev-time Vite URL not resolvable by tsc
                const lvlMod = await import('/src/systems/levelSystem.ts');
                // @ts-expect-error — dev-time Vite URL not resolvable by tsc
                const invMod = await import('/src/stores/inventoryStore.ts');
                const charStore = (charMod as {
                    useCharacterStore: {
                        getState: () => {
                            character: { level: number; gold: number } | null;
                            addXp: (xp: number) => void;
                        };
                    };
                }).useCharacterStore;
                const xpToNextLevel = (lvlMod as {
                    xpToNextLevel: (level: number) => number;
                }).xpToNextLevel;
                const level = charStore.getState().character?.level ?? 0;
                charStore.getState().addXp(xpToNextLevel(level));
                const inv = (invMod as {
                    useInventoryStore: { getState: () => { gold: number } };
                }).useInventoryStore.getState();
                return {
                    newLevel: charStore.getState().character?.level ?? 0,
                    charColumnGold: charStore.getState().character?.gold ?? -1,
                    walletGold: inv.gold,
                };
            });

            // 5. Reached level 10, milestone gold landed in the SPENDABLE wallet,
            //    NOT the vestigial characters.gold column.
            expect(result.newLevel).toBe(10);
            expect(result.walletGold).toBe(100_000); // 10 × 10000 = 1cc
            expect(result.charColumnGold).toBe(0);

            // 6. The TopHeader wallet visibly shows the cc tier (formatGoldShort
            //    ramps the display; aria-label carries the exact value too).
            const goldValue = page.locator('.top-header__gold-value').first();
            await expect(goldValue).toContainText('cc', { timeout: 10_000 });
            const goldBtn = page.locator('.top-header__gold-btn').first();
            await expect(goldBtn).toHaveAttribute('aria-label', /100\D?000/, { timeout: 10_000 });
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
