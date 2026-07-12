
import { test, expect } from '@playwright/test';
import { testUsers } from '../fixtures/testUsers';
import { loginViaUI } from '../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../fixtures/createCharacter';
import { cleanupCharacterById } from '../fixtures/cleanup';
import { waitForAppReady } from '../fixtures/appReady';

test.describe('Auto-Potion › Settings', { tag: '@auto-potion' }, () => {
    test.describe.configure({ timeout: 90_000 });
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

            await loginViaUI(page, testUsers.primary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 10_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });

            await page.goto('/inventory');
            await waitForAppReady(page);
            await expect(page.locator('.inventory__paperdoll-actions')).toBeVisible({ timeout: 20_000 });

            const popup = page.locator('.inventory__popup--potion');
            const autoPotionBtn = page.getByRole('button', { name: /^auto-potion$/i });
            await expect(autoPotionBtn).toBeVisible({ timeout: 10_000 });
            await expect(autoPotionBtn).toBeEnabled({ timeout: 10_000 });
            await autoPotionBtn.scrollIntoViewIfNeeded();
            await expect
                .poll(
                    async () => {
                        if (await popup.isVisible().catch(() => false)) return true;
                        await autoPotionBtn.tap({ timeout: 5_000 }).catch(() => { });
                        return popup.isVisible().catch(() => false);
                    },
                    { timeout: 30_000, intervals: [500, 1000, 1500, 2000] },
                )
                .toBe(true);
            await expect(popup).toBeVisible({ timeout: 5_000 });

            const sliders = popup.locator('input[type="range"]');
            await expect(sliders).toHaveCount(4);
            const hpSlider = sliders.first();

            const defaultValue = await hpSlider.inputValue();
            expect(defaultValue).toBe('50');

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

            const flatHpBlock = popup.locator('.inventory__potion-setting').first();
            await expect(flatHpBlock.locator('.inventory__potion-value')).toHaveText('25%');

            await popup.getByRole('button', { name: /Zamknij/i }).tap();
            await expect(popup).not.toBeVisible({ timeout: 5_000 });

            const popup2 = page.locator('.inventory__popup--potion');
            await expect(autoPotionBtn).toBeVisible({ timeout: 10_000 });
            await expect(autoPotionBtn).toBeEnabled({ timeout: 10_000 });
            await expect
                .poll(
                    async () => {
                        if (await popup2.isVisible().catch(() => false)) return true;
                        await autoPotionBtn.tap({ timeout: 5_000 }).catch(() => { });
                        return popup2.isVisible().catch(() => false);
                    },
                    { timeout: 30_000, intervals: [500, 1000, 1500, 2000] },
                )
                .toBe(true);
            await expect(popup2).toBeVisible({ timeout: 5_000 });

            const sliders2 = popup2.locator('input[type="range"]');
            const hpSliderReopen = sliders2.first();
            const persistedValue = await hpSliderReopen.inputValue();
            expect(persistedValue).toBe('25');

            const flatHpBlock2 = popup2.locator('.inventory__potion-setting').first();
            await expect(flatHpBlock2.locator('.inventory__potion-value')).toHaveText('25%');
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
