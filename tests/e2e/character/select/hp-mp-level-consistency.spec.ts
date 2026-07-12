
import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';

test.describe('Character › Select', { tag: '@character' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('HP/MP/Level shown in CharacterSelect card matches Town card matches TopHeader popover', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: { hp: 40, mp: 15, level: 5, highest_level: 5, hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;
            expect(created.name).toBe(nick);

            await loginViaUI(page, testUsers.primary);
            await page.goto('/character-select');
            await expect(page.locator('.char-select__card-name', { hasText: nick })).toBeVisible({ timeout: 10_000 });

            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            const selectHpText = await card.locator('.char-select__bar-wrap', {
                has: page.locator('.char-select__bar--hp'),
            }).locator('.char-select__bar-value').textContent();
            const selectMpText = await card.locator('.char-select__bar-wrap', {
                has: page.locator('.char-select__bar--mp'),
            }).locator('.char-select__bar-value').textContent();
            const selectMeta = await card.locator('.char-select__card-meta').textContent();

            expect(selectHpText?.trim()).toMatch(/^\d+\/\d+$/);
            expect(selectMpText?.trim()).toMatch(/^\d+\/\d+$/);
            expect(selectMeta).toMatch(/Poziom 5/i);

            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });

            await expect(page.locator('.town__char-name')).toHaveText(nick);
            const townHp = await page.locator('.town__bar-wrap', {
                has: page.locator('.town__bar--hp'),
            }).locator('.town__bar-value').textContent();
            const townMp = await page.locator('.town__bar-wrap', {
                has: page.locator('.town__bar--mp'),
            }).locator('.town__bar-value').textContent();
            const townLevel = await page.locator('.town__char-level').textContent();

            const pulseTrigger = page.locator('.top-header__pulse').first();
            if (await pulseTrigger.count() > 0) {
                await pulseTrigger.tap();
                const popoverHp = await page.locator('.top-header__pulse-popover-row--hp .top-header__pulse-popover-val').first().textContent();
                const popoverMp = await page.locator('.top-header__pulse-popover-row--mp .top-header__pulse-popover-val').first().textContent();
                expect(popoverHp?.trim()).toBe(townHp?.trim());
                expect(popoverMp?.trim()).toBe(townMp?.trim());
            }

            expect(selectHpText?.trim()).toBe(townHp?.trim());
            expect(selectMpText?.trim()).toBe(townMp?.trim());
            expect(townLevel).toContain('5');
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
