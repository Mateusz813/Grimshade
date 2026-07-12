
import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { seedGameSave, findUserIdByEmail } from '../../fixtures/seedGameSave';

test.describe('Shop › Elixirs', { tag: '@shop' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('mp_boost_500 buff -> CharacterSelect, Town, TopHeader popover show same effective max MP', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Mage',
                overrides: { hp: 50, mp: 80, level: 5, highest_level: 5, hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            const userId = await findUserIdByEmail(testUsers.primary.email);
            await seedGameSave({
                characterId: created.id,
                userId,
                buffs: [
                    {
                        id: 'mp_boost_500',
                        name: '+500 Max MP',
                        icon: 'large-blue-diamond',
                        effect: 'mp_boost_500',
                    },
                ],
            });

            await loginViaUI(page, testUsers.primary);
            await page.goto('/character-select');
            await expect(page.locator('.char-select__card-name', { hasText: nick })).toBeVisible({ timeout: 10_000 });

            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });
            await expect(page.locator('.town__char-name')).toHaveText(nick);

            const townMp = await page
                .locator('.town__bar-wrap', { has: page.locator('.town__bar--mp') })
                .locator('.town__bar-value')
                .textContent();
            expect(townMp?.trim()).toBe('80/732');

            const pulseBtn = page.locator('.top-header__pulse').first();
            await expect(pulseBtn).toBeVisible({ timeout: 5_000 });
            await pulseBtn.tap();
            const popoverMp = await page
                .locator('.top-header__pulse-popover-row--mp .top-header__pulse-popover-val')
                .first()
                .textContent();
            expect(popoverMp?.trim()).toBe('80/732');

            await page.goto('/character-select');
            await expect(page.locator('.char-select__card-name', { hasText: nick })).toBeVisible({ timeout: 10_000 });
            const reloadedCard = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            const selectMpText = await reloadedCard
                .locator('.char-select__bar-wrap', { has: page.locator('.char-select__bar--mp') })
                .locator('.char-select__bar-value')
                .textContent();
            expect(selectMpText?.trim()).toBe('80/732');

            expect(townMp?.trim()).toBe(popoverMp?.trim());
            expect(popoverMp?.trim()).toBe(selectMpText?.trim());
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
