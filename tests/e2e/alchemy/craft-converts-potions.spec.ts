/**
 * Atomic E2E — Alchemy craft consumes inputs + produces stronger output.
 *
 * Spec (BACKLOG.md 10.2 full): "Alchemy crafts actual item". Smoke
 * variant (10.2) already covers grid rendering with 14 recipe rows. This
 * test exercises the FULL craft contract: tap ":test-tube: Przetworz" on a
 * specific recipe, watch input count decrement by `inputCount`, output
 * count increment by 1, and a toast appear.
 *
 * Source path (production):
 *   Inventory.tsx ~line 3826 — POTION_CONVERSIONS.map renders rows.
 *   Each row's ":test-tube: Przetworz" button fires `handlePotionConvert(
 *     conv.inputId, conv.outputId, conv.outputName, conv.inputCount,
 *     amount)` (line 3887).
 *   handlePotionConvert (Inventory.tsx ~line 2871) calls:
 *     inv.addConsumable(inputId, -totalNeeded);
 *     inv.addConsumable(outputId, batches);
 *     setAlchemyToast(`Przetworzono: +${batches} ${outputName}`);
 *
 * ## Recipe choice: HP tier 1 (5× sm -> 1× md)
 *
 * The lowest tier is the easiest setup: 5× hp_potion_sm + 1 batch =
 * minimum-cost test setup. Requires character level ≥ 20 (per
 * POTION_CONVERSIONS[0].outputMinLevel) so we seed a Knight at lvl 25
 * — same as 12.7 / 6.11 use, comfortable headroom.
 *
 * Why HP not MP: HP family is the first row in the grid (visual
 * positioning is deterministic) AND HP tier 1 requires the lowest
 * `outputMinLevel` (20). MP tier 1 (mp_sm -> mp_md) also requires
 * outputMinLevel=20 but HP being first row is a tiny convenience for
 * humans reading the test.
 *
 * ## Why SECONDARY account
 *
 * Suite runs concurrent on primary. Secondary is the parallel slot per
 * task brief.
 *
 * ## Setup
 *
 *  1. Seed Knight lvl 25 on SECONDARY.
 *  2. Seed `consumables: { hp_potion_sm: 10 }` (5 needed for 1 batch,
 *     headroom of 5 leftover to assert clean decrement math).
 *
 * ## Flow
 *
 *  1. Login -> /inventory -> tap "auto-potion" button -> popup opens.
 *  2. Tap ":test-tube: Alchemia" tab -> switches potionTab.
 *  3. Locate the first HP-family row (`.inventory__alchemy-row--hp` first
 *     match).
 *  4. Assert pre-state: input "Posiadasz: 10", output "Masz: 0", button
 *     enabled (canConvert=true because 10 ≥ 5).
 *  5. Tap ":test-tube: Przetworz" button.
 *  6. Assert post-state: input "Posiadasz: 5" (10 - 5 = 5), output
 *     "Masz: 1" (0 + 1 = 1), toast `.inventory__alchemy-toast` visible
 *     with text matching /Przetworzono.*1.*HP/i (toast template per
 *     Inventory.tsx line 2879).
 *
 * ## Cleanup: try/finally + cleanupCharacterById.
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../fixtures/testUsers';
import { loginViaUI } from '../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../fixtures/createCharacter';
import { cleanupCharacterById } from '../fixtures/cleanup';
import { seedConsumables } from '../fixtures/seedInventory';

test.describe('Alchemy › Craft', { tag: '@alchemy' }, () => {
    test.describe.configure({ timeout: 90_000 });

    test('tap Przetworz on HP tier 1 row consumes 5× sm + produces 1× md + shows toast', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            // 1. Seed Knight lvl 25 — clears HP tier 1 outputMinLevel=20.
            const created = await createCharacterViaApi({
                userEmail: testUsers.secondary.email,
                name: nick,
                class: 'Knight',
                overrides: { level: 25, highest_level: 25, hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            // 2. Seed 10× hp_potion_sm — 5 needed per batch, headroom of 5.
            await seedConsumables({
                characterId: created.id,
                counts: { hp_potion_sm: 10 },
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

            // 4. /inventory -> tap auto-potion -> popup with 2 tabs opens.
            await page.goto('/inventory');
            await expect(page.locator('.inventory__paperdoll-actions')).toBeVisible({ timeout: 10_000 });
            await page.getByRole('button', { name: /^auto-potion$/i }).tap();

            const popup = page.locator('.inventory__popup--potion');
            await expect(popup).toBeVisible({ timeout: 5_000 });

            // 5. Tap "Alchemia" tab (inside the popup to avoid label collision).
            await popup.getByRole('button', { name: /Alchemia/i }).tap();
            await expect(popup.locator('.inventory__popup-tab--active')).toContainText(/Alchemia/i);

            // 6. Locate HP tier 1 row — the FIRST `.inventory__alchemy-row--hp`
            //    in source order. POTION_CONVERSIONS first entry is HP
            //    tier 1 (potionConversion.ts line 50-56) so first hp row
            //    in DOM = HP tier 1 (5× sm -> 1× md).
            const grid = popup.locator('.inventory__alchemy-grid');
            await expect(grid).toBeVisible();
            const hpTier1Row = grid.locator('.inventory__alchemy-row--hp').first();
            await expect(hpTier1Row).toBeVisible();

            // 7. Pre-state assertions — input owned 10, output owned 0.
            //    Inventory.tsx line 3845 + 3856: "Posiadasz: {owned}" and
            //    "Masz: {outputOwned}". Anchor on the row to avoid
            //    cross-row pollution.
            await expect(hpTier1Row.locator('.inventory__alchemy-input .inventory__alchemy-owned'))
                .toContainText(/Posiadasz:\s*10/);
            await expect(hpTier1Row.locator('.inventory__alchemy-output .inventory__alchemy-owned'))
                .toContainText(/Masz:\s*0/);

            // 8. Button enabled (canConvert=true bo 10 ≥ inputCount=5).
            //    Per Inventory.tsx line 3885: disabled={!canConvert || levelTooLow}.
            const craftBtn = hpTier1Row.locator('.inventory__alchemy-btn');
            await expect(craftBtn).toBeVisible();
            await expect(craftBtn).toBeEnabled();
            await expect(craftBtn).toContainText(/Przetworz/i);

            // 9. CRAFT — tap Przetworz.
            await craftBtn.tap();

            // 10. Post-state assertions.
            //     Input dropped to 5 (10 - 5 = 5). Output grew to 1 (0 + 1).
            await expect(hpTier1Row.locator('.inventory__alchemy-input .inventory__alchemy-owned'))
                .toContainText(/Posiadasz:\s*5/, { timeout: 5_000 });
            await expect(hpTier1Row.locator('.inventory__alchemy-output .inventory__alchemy-owned'))
                .toContainText(/Masz:\s*1/, { timeout: 5_000 });

            // 11. Toast — Inventory.tsx line 2879:
            //     `Przetworzono: +${batches} ${outputName}` where
            //     outputName='Eliksir HP' for HP tier 1.
            //     Toast auto-dismisses after 2200ms (line 2880) so we
            //     don't dwell on it — `.toBeVisible` checks the snapshot.
            //     Anchor on popup to avoid grabbing other toasts.
            await expect(popup.locator('.inventory__alchemy-toast'))
                .toContainText(/Przetworzono.*1.*Eliksir HP/i, { timeout: 3_000 });
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
