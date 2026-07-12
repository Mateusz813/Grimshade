
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

            await loginViaUI(page, testUsers.primary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 10_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });

            await page.goto('/inventory');
            await expect(page.locator('.inventory__paperdoll-actions')).toBeVisible({ timeout: 20_000 });
            await page.getByRole('button', { name: /^auto-potion$/i }).tap();

            const popup = page.locator('.inventory__popup--potion');
            await expect(popup).toBeVisible({ timeout: 5_000 });

            const sliders = popup.locator('input[type="range"]');
            await expect(sliders).toHaveCount(4);

            const panels = popup.locator('.inventory__potion-setting');
            await expect(panels).toHaveCount(4);

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

            const ensureCheckboxCheckedAtPanel = async (panelIdx: number) => {
                const checkbox = panels.nth(panelIdx).locator('input[type="checkbox"].inventory__potion-checkbox');
                const isChecked = await checkbox.isChecked();
                if (!isChecked) {
                    await panels.nth(panelIdx).locator('.inventory__potion-toggle').tap();
                    await expect(checkbox).toBeChecked({ timeout: 2_000 });
                }
            };

            await ensureCheckboxCheckedAtPanel(0);
            await ensureCheckboxCheckedAtPanel(1);
            await ensureCheckboxCheckedAtPanel(2);
            await ensureCheckboxCheckedAtPanel(3);

            for (let i = 0; i < 4; i++) {
                await expect(panels.nth(i).locator('.inventory__potion-value'))
                    .toHaveText(/^\d+%$/);
            }

            const baselineSlider1 = await sliders.nth(0).inputValue();
            const baselineSlider2 = await sliders.nth(1).inputValue();
            const baselineSlider3 = await sliders.nth(2).inputValue();
            const baselineSlider4 = await sliders.nth(3).inputValue();

            await dispatchSliderValue(0, 30);
            await expect(panels.nth(0).locator('.inventory__potion-value')).toHaveText('30%');
            await expect(panels.nth(1).locator('.inventory__potion-value')).toHaveText(`${baselineSlider2}%`);
            await expect(panels.nth(2).locator('.inventory__potion-value')).toHaveText(`${baselineSlider3}%`);
            await expect(panels.nth(3).locator('.inventory__potion-value')).toHaveText(`${baselineSlider4}%`);

            await dispatchSliderValue(1, 35);
            await expect(panels.nth(1).locator('.inventory__potion-value')).toHaveText('35%');
            await expect(panels.nth(0).locator('.inventory__potion-value')).toHaveText('30%');
            await expect(panels.nth(2).locator('.inventory__potion-value')).toHaveText(`${baselineSlider3}%`);
            await expect(panels.nth(3).locator('.inventory__potion-value')).toHaveText(`${baselineSlider4}%`);

            await dispatchSliderValue(2, 20);
            await expect(panels.nth(2).locator('.inventory__potion-value')).toHaveText('20%');
            await expect(panels.nth(0).locator('.inventory__potion-value')).toHaveText('30%');
            await expect(panels.nth(1).locator('.inventory__potion-value')).toHaveText('35%');
            await expect(panels.nth(3).locator('.inventory__potion-value')).toHaveText(`${baselineSlider4}%`);

            await dispatchSliderValue(3, 15);
            await expect(panels.nth(3).locator('.inventory__potion-value')).toHaveText('15%');

            await expect(panels.nth(0).locator('.inventory__potion-value')).toHaveText('30%');
            await expect(panels.nth(1).locator('.inventory__potion-value')).toHaveText('35%');
            await expect(panels.nth(2).locator('.inventory__potion-value')).toHaveText('20%');
            await expect(panels.nth(3).locator('.inventory__potion-value')).toHaveText('15%');

            expect(await sliders.nth(0).inputValue()).toBe('30');
            expect(await sliders.nth(1).inputValue()).toBe('35');
            expect(await sliders.nth(2).inputValue()).toBe('20');
            expect(await sliders.nth(3).inputValue()).toBe('15');

            void baselineSlider1;
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
