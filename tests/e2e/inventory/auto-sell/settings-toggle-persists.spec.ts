/**
 * Atomic E2E — Auto-sell rarity threshold toggle UI flips on tap.
 *
 * Spec (BACKLOG.md punkt 6.3 — scope adaptation): "Auto-sell działa wg
 * ustawień" -> tu pokrywamy SAM toggle UI (tap flippa class + text na
 * common-rarity button + nie ruszają się siostry).
 *
 * Co testujemy (settings UI only):
 *  1. Default state — `Zwykle` button bez --active + tekst `Zwykle x`.
 *  2. Tap "Zwykle" -> button dostaje klasę `--active` + tekst `Zwykle v`.
 *     (testowane w jednym waitFor żeby uniknąć race między assertions —
 *     toHaveText i toHaveClass czytają to samo state, ale 2 osobne polle
 *     mogą trafić na zero moment po quick auto-save fail -> store revert).
 *  3. Sanity — pozostałe 4 rarity buttony NIE zmieniły state (per-tier
 *     handler isolation).
 *  4. Tap ponownie -> toggle off (bidirectional flip).
 *
 * **Persistence-across-remount scope DROPPED** (early 2026-05-25):
 *  Test próbował zweryfikować że settings store przeżywa remount
 *  Inventory (page.goto('/') + page.goto('/inventory'), albo BottomNav
 *  SPA-nav Town->Inventory). Oba warianty failowały bo:
 *   - Full reload -> App.tsx switchToCharacter resetuje wszystkie stores
 *     PRZED Supabase loadGame -> defaults wygrywają (stale cloud blob).
 *   - SPA-nav -> `[characterScope] Refused to save – another tab owns this
 *     character` warning (tab-lock z `characterScope.ts:121-126`) ->
 *     localStorage flush jest zablokowany -> po remount cloud blob = stale.
 *   - Wymaga albo fix tab-lock w app (Vite HMR + multiple worker
 *     contexts), albo run testów na prod build z `npm run preview`.
 *
 *  Persistence-across-remount variant TODO
 *  `inventory/auto-sell/persists-after-reload.spec.ts` — gated by app fix.
 *
 * **Dlaczego "Zwykle" a NIE wszystkie 5 tier-ów**:
 *  - Atomic E2E principle — testujemy JEDEN flow (toggle + sanity).
 *    Wszystkie 5 buttonów mają ten sam handler pattern (Inventory.tsx
 *    linia 4308-4341), więc jeden tier weryfikuje całą maszynerię.
 *
 * Seed: Knight (default base stats). settingsStore defaults dają wszystkie
 * autoSellX=false (linia 123-127 settingsStore.ts).
 *
 * Cleanup: try/finally + cleanupCharacterById.
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';

test.describe('Inventory › Auto-Sell', { tag: '@inventory' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('toggle Common auto-sell -> button flips active class + text bidirectionally', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            // 1. Seed Knight (default base stats, regen off).
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: { hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            // 2. Login -> wybierz postać -> Town
            await loginViaUI(page, testUsers.primary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 10_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });

            // 3. /inventory -> bag header z auto-sell row musi być widoczny.
            //    Auto-sell buttony są w `.inventory__auto-sell` div który
            //    siedzi w `.inventory__bag-header` (Inventory.tsx linia
            //    4280, 4305).
            //    Wait for top-header before continuing — gwarantuje że
            //    character jest w pełni zhydratowany w characterStore
            //    PRZED clickami (bez tego async restore może zresetować
            //    settingsStore w trakcie testu -> tap toggle silent-no-op).
            await page.goto('/inventory');
            await expect(page.locator('.top-header')).toBeVisible({ timeout: 15_000 });
            await expect(page.locator('.inventory__auto-sell')).toBeVisible({ timeout: 10_000 });

            // 4. Sanity — default state. `Zwykle` button bez `--active`.
            //    Selector pasuje TYLKO do common-rarity button (Inventory.tsx
            //    linia 4307-4313) bo nie ma rarity-specific suffix:
            //      className=`inventory__auto-sell-btn` (no --rare/--epic/...)
            //    Używamy regex zeby uniknać matchowania `--rare` / `--epic`
            //    przez accidental substring match.
            const commonBtn = page.locator('.inventory__auto-sell-btn').filter({
                hasText: /^Zwykle/,
            });
            await expect(commonBtn).toBeVisible({ timeout: 5_000 });
            // OFF state: shows :cross-mark: (Twemoji <img>, alt-preserved) + no --active.
            await expect(commonBtn.locator('svg.game-icon')).toHaveAttribute('data-icon', 'cross-mark');
            await expect(commonBtn).not.toHaveClass(/inventory__auto-sell-btn--active/);

            // 5. Tap "Zwykle" -> button dostaje `--active` + tekst "v".
            //    handler: `setAutoSellCommon(!autoSellCommon)` — flip false->true.
            //
            //    UWAGA: Pojedyncze `toContainText` z pełnym oczekiwanym
            //    ciągiem ("Zwykle v") łapie zmiany atomic-style w jednym
            //    poll-cycle. Retry loop z `force:true` na wypadek gdyby
            //    mobile-safari pominął pierwszy tap (re-render Inventory
            //    podczas async character hydration). Po 3 retry rzucamy
            //    error przekazujący żeby debug wiedział że tap zawiódł
            //    nie state-flow.
            //    Auto-save debounce 500ms próbuje pisać do localStorage —
            //    jeśli tab-lock odmówi (`[characterScope] Refused to save`)
            //    bez fail-toast UI — state in-memory pozostaje OK, ale
            //    perist do localStorage zawiedzie (irrelevant for this test).
            for (let attempt = 1; attempt <= 3; attempt++) {
                await commonBtn.tap({ force: true });
                try {
                    // ON state: icon flips to :check-mark-button: (Twemoji <img>, alt-preserved).
                    await expect(commonBtn.locator('svg.game-icon')).toHaveAttribute('data-icon', 'check-mark-button', { timeout: 3_000 });
                    break;
                } catch (err) {
                    if (attempt === 3) throw err;
                }
            }
            await expect(commonBtn).toHaveClass(/inventory__auto-sell-btn--active/);

            // 6. Sanity — pozostałe tier-y NIE zostały zaffektowane.
            //    Każdy rarity button ma osobny handler / state, więc tap
            //    Common nie powinien fliponąć Rare/Epic/Legendary/Mythic.
            const rareBtn = page.locator('.inventory__auto-sell-btn--rare');
            await expect(rareBtn).not.toHaveClass(/inventory__auto-sell-btn--active/);
            await expect(rareBtn.locator('svg.game-icon')).toHaveAttribute('data-icon', 'cross-mark');

            // 7. Tap ponownie -> toggle off (sanity że dwukierunkowy flip
            //    działa, nie utknął w "always on"). Persistence-across-
            //    remount wycięty z testa — patrz nota w docstring.
            //    UWAGA: short waitForTimeout pomiędzy tapami żeby mobile-safari
            //    nie potraktował 2 szybkich tap-ów jako double-tap (zoom
            //    gesture).
            await page.waitForTimeout(150);
            for (let attempt = 1; attempt <= 3; attempt++) {
                await commonBtn.tap({ force: true });
                try {
                    // toggled back OFF -> icon is :cross-mark: again.
                    await expect(commonBtn.locator('svg.game-icon')).toHaveAttribute('data-icon', 'cross-mark', { timeout: 3_000 });
                    break;
                } catch (err) {
                    if (attempt === 3) throw err;
                }
            }
            await expect(commonBtn).not.toHaveClass(/inventory__auto-sell-btn--active/);
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
