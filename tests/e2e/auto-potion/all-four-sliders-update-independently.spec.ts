/**
 * Atomic E2E — wszystkie 4 sliders (Flat HP / Flat MP / Pct HP / Pct MP)
 * w Auto-potion popup-ie reagują na zmianę value INDEPENDENTLY — zmiana
 * jednego slidera NIE rzutuje na inne, kazdy `.inventory__potion-value`
 * label aktualizuje sie tylko dla swojego slidera.
 *
 * Spec (BACKLOG.md punkt 11.5 — UI slider behavior, **adaptacja** z
 * "Auto-potion z różnym EQ" które wymaga special ring item, do
 * "slider drag behavior — verify value updates"): rozszerzenie 11.1
 * (tamten test sprawdza SAMĄ persistencję jednego slidera w popup
 * close+reopen cycle). Ten test pokrywa:
 *  1. Drag każdego z 4 sliderów na różną wartość.
 *  2. Verify ze odpowiadający `.inventory__potion-value` label
 *     pokazuje NOWĄ wartość per-slider.
 *  3. Verify że PRZY OKAZJI inne 3 slidery zachowały swoje defaults
 *     (zmiana nie spreaduje przez zlepione handlery).
 *
 * Powod istnienia tego testu: Inventory.tsx ~3577-3812 ma 4 niezależne
 * settings panels, każdy z osobnym `set...Threshold` handler-em ze
 * `settingsStore`. Regresja typu "developer pomylił setAutoPotionHpThreshold
 * vs setAutoPotionPctHpThreshold w copy-paste" byłaby silent — slider
 * by się ruszał ale UI label by się ruszał W ZŁYM panelu.
 *
 * ## Setup state
 *
 * Seed Knight (default settings → wszystkie 4 thresholds = 50% / 40%
 * z `settingsStore.ts` linia ~109). hp_regen=0/mp_regen=0 dla noise-less
 * UI (HP/MP nie tickują → asercje na header nie race-conduuje).
 *
 * ## Actions + asercje
 *
 * 1. Open Auto-potion popup, capture 4 default values (sanity że store
 *    wystartował z poprawnymi defaults).
 * 2. Drag slider #1 (Flat HP) na 30 → verify panel 1 pokazuje "30%",
 *    panele 2/3/4 zachowują defaults.
 * 3. Drag slider #2 (Flat MP) na 35 → verify panel 2 pokazuje "35%",
 *    panele 1/3/4 zachowują (panel 1 = 30 z poprzedniego kroku).
 * 4. Drag slider #3 (Pct HP) na 20 → verify panel 3 pokazuje "20%".
 * 5. Drag slider #4 (Pct MP) na 15 → verify panel 4 pokazuje "15%".
 * 6. KRYTYCZNA ASERCJA: wszystkie 4 panele pokazują ich docelowe
 *    wartości jednocześnie (cross-check że żaden handler nie nadpisał
 *    sąsiada).
 *
 * ## Why React-aware event dispatch (NIE slider.fill)
 *
 * Patrz `tests/e2e/auto-potion/threshold-persists-across-popup-cycle.spec.ts`:
 * Playwright `slider.fill(...)` na input[type=range] w mobile WebKit
 * czasem nie odpala React onChange (React tracker mechanism). Nadpisanie
 * value przez prototype setter + dispatch 'input' event jest safest
 * cross-browser. Helper inline'owany w `dispatchSliderValue()` żeby
 * test był self-contained (nie wymaga nowego fixtura).
 *
 * Cleanup: try/finally → cleanupCharacterById.
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../fixtures/testUsers';
import { loginViaUI } from '../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../fixtures/createCharacter';
import { cleanupCharacterById } from '../fixtures/cleanup';

test.describe('Auto-Potion › Settings', { tag: '@auto-potion' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('all 4 threshold sliders update independently — changing one does NOT mutate the others', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: { hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            // 1. Login + Town
            await loginViaUI(page, testUsers.primary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 10_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });

            // 2. /inventory → tap Auto-potion → popup
            await page.goto('/inventory');
            await expect(page.locator('.inventory__paperdoll-actions')).toBeVisible({ timeout: 10_000 });
            await page.getByRole('button', { name: /^auto-potion$/i }).tap();

            const popup = page.locator('.inventory__popup--potion');
            await expect(popup).toBeVisible({ timeout: 5_000 });

            // 3. 4 sliders mounted (one per setting block). settingsStore.ts
            //    linia 107-117: Flat HP/MP są domyślnie ENABLED (50%),
            //    Pct HP/MP są domyślnie DISABLED (40%, display "WYL").
            //    Bez enablowania Pct slider input ma `disabled` attribute
            //    → React onChange nie odpala → assertion na "20%" fail-uje.
            const sliders = popup.locator('input[type="range"]');
            await expect(sliders).toHaveCount(4);

            const panels = popup.locator('.inventory__potion-setting');
            await expect(panels).toHaveCount(4);

            // Helper: native setter + input event — patrn z
            // `threshold-persists-across-popup-cycle.spec.ts` żeby React
            // onChange odpalił na mobile WebKit (Playwright fill() na
            // input[type=range] jest tam niewiarygodne).
            const dispatchSliderValue = async (sliderIdx: number, val: number) => {
                await page.evaluate(({ idx, value }) => {
                    const sliders = document.querySelectorAll<HTMLInputElement>(
                        '.inventory__popup--potion input[type="range"]',
                    );
                    const slider = sliders[idx];
                    if (!slider) throw new Error(`Slider #${idx} not found`);
                    const nativeSetter = Object.getOwnPropertyDescriptor(
                        window.HTMLInputElement.prototype, 'value',
                    )?.set;
                    if (!nativeSetter) throw new Error('Cannot get native value setter');
                    nativeSetter.call(slider, String(value));
                    slider.dispatchEvent(new Event('input', { bubbles: true }));
                    slider.dispatchEvent(new Event('change', { bubbles: true }));
                }, { idx: sliderIdx, value: val });
            };

            // Helper: ENSURE checkbox at panelIdx is checked. Tap toggle
            // only if currently unchecked (settingsStore persists across
            // tests in workers=1 mode — Pct HP/MP might already be enabled
            // from a previous test). Idempotent.
            const ensureCheckboxCheckedAtPanel = async (panelIdx: number) => {
                const checkbox = panels.nth(panelIdx).locator('input[type="checkbox"].inventory__potion-checkbox');
                const isChecked = await checkbox.isChecked();
                if (!isChecked) {
                    // Tap parent label (input may be hidden under CSS;
                    // label "for" propagates click to input).
                    await panels.nth(panelIdx).locator('.inventory__potion-toggle').tap();
                    await expect(checkbox).toBeChecked({ timeout: 2_000 });
                }
            };

            // 4. Enable wszystkie 4 sloty (Flat HP/MP są domyślnie enabled,
            //    Pct HP/MP są domyślnie disabled). settingsStore PERSISTS
            //    across tests w workers=1 mode, więc używamy idempotent
            //    ensure-enable handlerów (NIE simple toggle który by
            //    odznaczył już-zaznaczony checkbox).
            await ensureCheckboxCheckedAtPanel(0);
            await ensureCheckboxCheckedAtPanel(1);
            await ensureCheckboxCheckedAtPanel(2);
            await ensureCheckboxCheckedAtPanel(3);

            // Sanity że wszystkie 4 są enabled (label != "WYL"). Format
            // labela = "${threshold}%". Sprawdzamy regex zamiast hardcoded
            // value bo threshold mógł być zmieniony przez poprzedni test.
            for (let i = 0; i < 4; i++) {
                await expect(panels.nth(i).locator('.inventory__potion-value'))
                    .toHaveText(/^\d+%$/);
            }

            // 5. Snapshot baseline (po enable). Wszystkie 4 powinny być
            //    enabled, więc value-label = `${threshold}%`.
            const baselineSlider1 = await sliders.nth(0).inputValue(); // Flat HP (50)
            const baselineSlider2 = await sliders.nth(1).inputValue(); // Flat MP (50)
            const baselineSlider3 = await sliders.nth(2).inputValue(); // Pct HP (40)
            const baselineSlider4 = await sliders.nth(3).inputValue(); // Pct MP (40)

            // 6. Drag slider #1 (Flat HP) na 30. Panele 2/3/4 zachowują defaults.
            await dispatchSliderValue(0, 30);
            await expect(panels.nth(0).locator('.inventory__potion-value')).toHaveText('30%');
            await expect(panels.nth(1).locator('.inventory__potion-value')).toHaveText(`${baselineSlider2}%`);
            await expect(panels.nth(2).locator('.inventory__potion-value')).toHaveText(`${baselineSlider3}%`);
            await expect(panels.nth(3).locator('.inventory__potion-value')).toHaveText(`${baselineSlider4}%`);

            // 7. Drag slider #2 (Flat MP) na 35. Panel 1 zachowuje 30.
            await dispatchSliderValue(1, 35);
            await expect(panels.nth(1).locator('.inventory__potion-value')).toHaveText('35%');
            await expect(panels.nth(0).locator('.inventory__potion-value')).toHaveText('30%');
            await expect(panels.nth(2).locator('.inventory__potion-value')).toHaveText(`${baselineSlider3}%`);
            await expect(panels.nth(3).locator('.inventory__potion-value')).toHaveText(`${baselineSlider4}%`);

            // 8. Drag slider #3 (Pct HP) na 20.
            await dispatchSliderValue(2, 20);
            await expect(panels.nth(2).locator('.inventory__potion-value')).toHaveText('20%');
            await expect(panels.nth(0).locator('.inventory__potion-value')).toHaveText('30%');
            await expect(panels.nth(1).locator('.inventory__potion-value')).toHaveText('35%');
            await expect(panels.nth(3).locator('.inventory__potion-value')).toHaveText(`${baselineSlider4}%`);

            // 9. Drag slider #4 (Pct MP) na 15.
            await dispatchSliderValue(3, 15);
            await expect(panels.nth(3).locator('.inventory__potion-value')).toHaveText('15%');

            // 10. KRYTYCZNA ASERCJA: wszystkie 4 docelowe wartości
            //     jednocześnie. Cross-check że żaden handler nie nadpisał
            //     sąsiada.
            await expect(panels.nth(0).locator('.inventory__potion-value')).toHaveText('30%');
            await expect(panels.nth(1).locator('.inventory__potion-value')).toHaveText('35%');
            await expect(panels.nth(2).locator('.inventory__potion-value')).toHaveText('20%');
            await expect(panels.nth(3).locator('.inventory__potion-value')).toHaveText('15%');

            // 11. Slider inputValue też się zgadza ze swoim labelem (sanity
            //     że controlled value === controlled label po React re-renderze).
            //     Bez tego asercje na label by mogły zielenieć z tle pre-render
            //     z poprzedniej iteracji, podczas gdy slider state jest pusty.
            expect(await sliders.nth(0).inputValue()).toBe('30');
            expect(await sliders.nth(1).inputValue()).toBe('35');
            expect(await sliders.nth(2).inputValue()).toBe('20');
            expect(await sliders.nth(3).inputValue()).toBe('15');

            // baselineSlider1 nie jest używane w asercjach — zachowane jako
            // czytelność (nazwa zmiennej dokumentuje co jest baseline-em).
            void baselineSlider1;
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
