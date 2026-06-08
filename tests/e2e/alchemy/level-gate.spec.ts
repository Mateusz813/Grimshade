/**
 * Atomic E2E — Alchemia: niski-level postac NIE moze craft-ować recepty
 * powyzej wymaganego poziomu (level gate disable).
 *
 * Spec (BACKLOG.md punkt 10.1): "Alchemia: tylko na danym poziomie (level
 * gate)".
 *
 * Mechanika (Inventory.tsx linia 3832 + 3880-3892):
 *   - Per-recipe `levelTooLow = !!(character && conv.outputMinLevel &&
 *     character.level < conv.outputMinLevel)`.
 *   - Button "🧪 Przetworz" jest `disabled={!canConvert || levelTooLow}`.
 *   - Summary text gdy level too low: `Wymagany lvl ${conv.outputMinLevel}`.
 *
 * Wybor recepty: tier 2 HP = `hp_potion_md (4x) → hp_potion_lg` z
 * `outputMinLevel: 50` (patrz potionConversion.ts linia 60-65).
 *
 * Setup state:
 *   1. Seed Knight LEVEL 10 — ponizej outputMinLevel = 50 dla hp_potion_lg.
 *   2. Seed consumables: hp_potion_md × 20 — wystarczy zeby canConvert
 *      bylo TRUE (4× per batch, 20/4 = 5 batches), izolujac levelTooLow
 *      jako blocker. (Gdybysmy mieli < 4, button byl disabled przez
 *      `!canConvert`, a chcemy potwierdzic specyficznie levelTooLow.)
 *
 * Actions:
 *   1. /inventory → tap Auto-potion → popup.
 *   2. Tap Alchemia tab.
 *   3. Znajdz row dla hp_potion_md → hp_potion_lg ("Eliksir HP" →
 *      "Silny Eliksir HP"). To recepta tier 2 HP. Wewnatrz row sprawdzamy
 *      button "Przetworz" i summary text.
 *
 * Outcome:
 *   - Button "Przetworz" w tym row jest `disabled`.
 *   - Summary text w row mowi "Wymagany lvl 50".
 *
 * Cleanup: try/finally → cleanupCharacterById.
 *
 * Edge cases:
 *  - Tier 1 recepty (output_minLevel: 20) tez beda disabled bo level=10 < 20,
 *    ale to nie mieszamy tutaj — zostajemy przy tier 2 (hp_potion_md → lg).
 *  - Postac musi miec wystarczajaco wejsciowych potionow zeby canConvert
 *    bylo TRUE, inaczej disabled by zostalo od `!canConvert` a nie
 *    `levelTooLow` i ten test by nic specyficznego nie pokrywal.
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../fixtures/testUsers';
import { loginViaUI } from '../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../fixtures/createCharacter';
import { cleanupCharacterById } from '../fixtures/cleanup';
import { seedConsumables } from '../fixtures/seedInventory';

test.describe('Alchemy › Level Gate', { tag: '@alchemy' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('low-level character cannot convert to potion above required level', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            // 1. Knight lvl 10 — ponizej outputMinLevel=50 dla
            //    hp_potion_md → hp_potion_lg recepty (tier 2 HP).
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: { level: 10, highest_level: 10, hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            // 2. Seed 20× hp_potion_md → wystarczy na 5 batchey (4×5 = 20).
            //    canConvert = TRUE → button-disable wynika SPECYFICZNIE z
            //    levelTooLow, co testujemy.
            await seedConsumables({
                characterId: created.id,
                counts: { hp_potion_md: 20 },
            });

            // 3. Login → wybierz postac → Town
            await loginViaUI(page, testUsers.primary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 10_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });

            // 4. /inventory → Auto-potion popup → Alchemia tab
            await page.goto('/inventory');
            await expect(page.locator('.inventory__paperdoll-actions')).toBeVisible({ timeout: 10_000 });
            await page.getByRole('button', { name: /^auto-potion$/i }).tap();

            const popup = page.locator('.inventory__popup--potion');
            await expect(popup).toBeVisible({ timeout: 5_000 });
            await popup.getByRole('button', { name: /Alchemia/i }).tap();

            // 5. Znajdz row recepty tier 2 HP: input="Eliksir HP" →
            //    output="Silny Eliksir HP" (patrz potionConversion.ts linia
            //    60-65 — name_pl values). Row to `.inventory__alchemy-row`.
            //
            //    UWAGA: BEM dla input/output uzywa wspolnego prefix-u
            //    `.inventory__alchemy-row--hp` (HP recepty maja `--hp`,
            //    MP maja `--mp` — linia 3839 conv.family). Tier 2 HP to
            //    drugi row HP w grid-zie. Identyfikujemy go przez OUTPUT
            //    text "Silny Eliksir HP" (unique w grid — tylko 1 recepta
            //    ma taki output).
            const targetRow = popup.locator('.inventory__alchemy-row', {
                hasText: 'Silny Eliksir HP',
            });
            // Moga byc 2 rows ktore hasText: "Silny Eliksir HP" — tier 2
            // (md→lg, output=Silny) ORAZ tier 7 alt (lg→Mega, input=Silny).
            // Bierzemy pierwsza, ale weryfikujemy ze output to faktycznie
            // "Silny Eliksir HP" (nie input).
            await expect(targetRow.first()).toBeVisible({ timeout: 5_000 });
            // Filter do specyficznie rowu OUTPUT "Silny" (tier 2 HP).
            const tier2Row = targetRow.filter({
                hasNot: popup.locator('.inventory__alchemy-input .inventory__alchemy-name', {
                    hasText: 'Silny Eliksir HP',
                }),
            }).first();
            await expect(tier2Row).toBeVisible({ timeout: 5_000 });

            // 6. KRYTYCZNA asercja: button "Przetworz" w tym row jest disabled.
            //    (linia 3883-3892: disabled={!canConvert || levelTooLow}).
            const convertBtn = tier2Row.getByRole('button', { name: /Przetworz/i });
            await expect(convertBtn).toBeDisabled();

            // 7. Summary text mowi "Wymagany lvl 50" (linia 3880).
            //    To wyraznie wskazuje ze blockerem jest levelTooLow,
            //    nie 'Za malo' (brak potionow).
            await expect(tier2Row.locator('.inventory__alchemy-summary'))
                .toContainText(/Wymagany lvl 50/i);
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
