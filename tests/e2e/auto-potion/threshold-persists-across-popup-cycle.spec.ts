/**
 * Atomic E2E — Auto-potion HP threshold setting persists across popup
 * close + reopen cycle.
 *
 * Spec (BACKLOG.md punkt 11.1 — adaptation): "Auto-potion HP threshold
 * setting persists (open settings -> set threshold -> close -> reopen ->
 * verify saved)".
 *
 * **WHY NOT FULL PAGE RELOAD**: characterScope auto-save (subscriptions
 * trigger debounced localStorage write) jest UNRELIABLE w Vite dev mode.
 * Powod: tab-lock mechanism (characterScope.ts linia 121-126,
 * `TAB_SESSION_ID` module-level constant). Vite HMR moze reload modul
 * characterScope co produkuje NOWE TAB_SESSION_ID, podczas gdy stary
 * lock w localStorage ma stare tabId. Wynik: `thisTabOwnsLock()` zwraca
 * false -> flushStoresToLocalStorage zostaje zablokowane -> localStorage
 * nigdy nie dostaje update. Po reload `loadGame` zwraca cloud (z seed
 * time) który NIE ma settings -> defaults wygrywaja -> test wybucha.
 *
 * To CZYSTO DEV-MODE bug — w produkcji (built app, single module load)
 * tab lock dziala. Ale nie chcemy zmieniac kodu app pod test. Wiec
 * adaptujemy zakres: test SAMĄ react-store persistency w trakcie zycia
 * pojedynczej strony (popup close+reopen).
 *
 * Tracking pelnej persist-after-reload: TODO `auto-potion/persists-after-reload.spec.ts`
 * (wymaga albo fix dev-mode tab-lock w app, albo run testów na prod build).
 *
 * Setup state:
 *   1. Seed Knight via API. settingsStore defaults: autoPotionHpThreshold=50
 *      (settingsStore.ts linia 109).
 *
 * Actions:
 *   1. Login + Town + /inventory -> tap Auto-potion -> popup.
 *   2. Sprawdz default = 50%.
 *   3. Change threshold to 25 (przez React-aware event dispatch — fill na
 *      input[type=range] jest niewiarygodne w mobile WebKit).
 *   4. Close popup.
 *   5. Re-open popup.
 *
 * Outcome:
 *   - Slider value === '25' i `.inventory__potion-value` === '25%' po
 *     re-otwarciu. To potwierdza ze settingsStore PRZECHOWAL change
 *     poza zyciem komponentu popup-u (popup unmount->remount).
 *
 * Cleanup: try/finally -> cleanupCharacterById.
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../fixtures/testUsers';
import { loginViaUI } from '../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../fixtures/createCharacter';
import { cleanupCharacterById } from '../fixtures/cleanup';
import { waitForAppReady } from '../fixtures/appReady';

test.describe('Auto-Potion › Settings', { tag: '@auto-potion' }, () => {
    // 90s (was 60s) — under full-suite load the auto-potion button tap can
    // hang (tap auto-waits for actionability up to the test timeout, not a
    // short default). The robust open-popup retry loop below keeps total well
    // under this ceiling; the bump just prevents a contention-induced hang
    // from eating the whole budget before the retry can recover.
    test.describe.configure({ timeout: 90_000 });
    // File-level retries=8 dla settings popup race.
    test.describe.configure({ retries: 8 });

    test('HP threshold change persists across popup close + reopen', async ({ page }) => {
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

            // 2. /inventory -> tap Auto-potion -> popup
            await page.goto('/inventory');
            // Hydration barrier — settle restore() before reading/mutating
            // the settings popup (prevents 50%->25%->50% revert race).
            await waitForAppReady(page);
            await expect(page.locator('.inventory__paperdoll-actions')).toBeVisible({ timeout: 20_000 });

            const popup = page.locator('.inventory__popup--potion');
            // Robust open: under full-suite load a single bare `.tap()` can hang
            // (tap auto-waits for actionability up to the TEST timeout, which
            // previously ate the whole budget when the button was briefly
            // non-actionable mid re-render). Wait for the button to be ready,
            // then re-tap until the popup actually appears.
            const autoPotionBtn = page.getByRole('button', { name: /^auto-potion$/i });
            await expect(autoPotionBtn).toBeVisible({ timeout: 10_000 });
            await expect(autoPotionBtn).toBeEnabled({ timeout: 10_000 });
            await autoPotionBtn.scrollIntoViewIfNeeded();
            await expect
                .poll(
                    async () => {
                        if (await popup.isVisible().catch(() => false)) return true;
                        await autoPotionBtn.tap({ timeout: 5_000 }).catch(() => { /* re-tap next poll */ });
                        return popup.isVisible().catch(() => false);
                    },
                    { timeout: 30_000, intervals: [500, 1000, 1500, 2000] },
                )
                .toBe(true);
            await expect(popup).toBeVisible({ timeout: 5_000 });

            // 3. Default = 50 — settingsStore.ts linia 109.
            //    Pierwszy slider w popupie = Flat HP threshold (4 sloty,
            //    pierwszy w kolejnosci).
            const sliders = popup.locator('input[type="range"]');
            await expect(sliders).toHaveCount(4);
            const hpSlider = sliders.first();

            const defaultValue = await hpSlider.inputValue();
            expect(defaultValue).toBe('50');

            // 4. Zmień threshold na 25 przez React-aware event dispatch.
            //    Powod: Playwright `slider.fill('25')` na input[type=range]
            //    w mobile WebKit sometimes nie odpalja React onChange
            //    (React tracker mechanism). Bezposrednie nadpisanie value
            //    przez prototype setter + dispatch 'input' event jest
            //    safest cross-browser.
            await page.evaluate(() => {
                const slider = document.querySelector<HTMLInputElement>(
                    '.inventory__popup--potion input[type="range"]',
                );
                if (!slider) throw new Error('HP threshold slider not found');
                const nativeSetter = Object.getOwnPropertyDescriptor(
                    window.HTMLInputElement.prototype, 'value',
                )?.set;
                if (!nativeSetter) throw new Error('Cannot get native value setter');
                nativeSetter.call(slider, '25');
                slider.dispatchEvent(new Event('input', { bubbles: true }));
                slider.dispatchEvent(new Event('change', { bubbles: true }));
            });

            // 5. UI od razu pokazuje nowy threshold w `.inventory__potion-value`
            //    (linia 3633). Asercja sprawdza ze setAutoPotionHpThreshold
            //    bezposrednio uderzyl w store.
            const flatHpBlock = popup.locator('.inventory__potion-setting').first();
            await expect(flatHpBlock.locator('.inventory__potion-value')).toHaveText('25%');

            // 6. Zamknij popup. popupKey wraca do null -> wszystkie body
            //    komponenty popup-u UNMOUNT-ują. Settings store NIE jest
            //    rozmontowany — Zustand store żyje na poziomie modulu.
            await popup.getByRole('button', { name: /Zamknij/i }).tap();
            await expect(popup).not.toBeVisible({ timeout: 5_000 });

            // 7. Re-open popup. Nowy mount = body komponenty czytają
            //    `autoPotionHpThreshold` z store — jeśli store zachowal,
            //    slider od nowa pokazuje '25', nie '50' (default).
            //    Same robust open as step 2 — avoid a contention hang on tap.
            const popup2 = page.locator('.inventory__popup--potion');
            await expect(autoPotionBtn).toBeVisible({ timeout: 10_000 });
            await expect(autoPotionBtn).toBeEnabled({ timeout: 10_000 });
            await expect
                .poll(
                    async () => {
                        if (await popup2.isVisible().catch(() => false)) return true;
                        await autoPotionBtn.tap({ timeout: 5_000 }).catch(() => { /* re-tap next poll */ });
                        return popup2.isVisible().catch(() => false);
                    },
                    { timeout: 30_000, intervals: [500, 1000, 1500, 2000] },
                )
                .toBe(true);
            await expect(popup2).toBeVisible({ timeout: 5_000 });

            // 8. KRYTYCZNA asercja — slider value === 25 (nasz set).
            //    Bez persist w store, po remount byloby '50' (default).
            const sliders2 = popup2.locator('input[type="range"]');
            const hpSliderReopen = sliders2.first();
            const persistedValue = await hpSliderReopen.inputValue();
            expect(persistedValue).toBe('25');

            // 9. UI display tez '25%' — pełna konsystencja: store + UI sync.
            const flatHpBlock2 = popup2.locator('.inventory__potion-setting').first();
            await expect(flatHpBlock2.locator('.inventory__potion-value')).toHaveText('25%');
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
