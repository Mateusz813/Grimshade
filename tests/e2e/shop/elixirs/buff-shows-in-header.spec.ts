
import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { seedConsumables } from '../../fixtures/seedInventory';
import { cleanupCharacterById } from '../../fixtures/cleanup';

test.describe('Shop › Elixirs', { tag: '@shop' }, () => {
    test.describe.configure({ timeout: 90_000 });

    test('using xp_boost elixir -> buff appears in TopHeader dropdown with name + countdown', async ({ page }) => {
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

            await seedConsumables({
                characterId: created.id,
                counts: { xp_boost: 5 },
            });

            await loginViaUI(page, testUsers.primary);
            if (!page.url().endsWith('/character-select')) {
                await page.goto('/character-select');
            }
            await expect(page.locator('.char-select__card-name', { hasText: nick })).toBeVisible({ timeout: 10_000 });
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });
            await expect(page.locator('.town__char-name')).toHaveText(nick);

            await expect(page.locator('.top-header__buffs-btn')).toHaveCount(0);

            await page.getByRole('button', { name: /^Postać$/i }).tap();
            await expect(page).toHaveURL(/\/inventory$/, { timeout: 10_000 });
            await expect(page.locator('.inventory')).toBeVisible({ timeout: 10_000 });

            const elixirTile = page.locator('.inventory__bag-tile', {
                has: page.locator('.inventory__bag-tile-name', { hasText: /^Dopalacz XP$/ }),
            }).first();
            await expect(elixirTile).toBeVisible({ timeout: 10_000 });

            await elixirTile.tap({ force: true });

            await expect(page.locator('.inventory__popup--use-potion')).toBeVisible({ timeout: 5_000 });

            const activateBtn = page.locator('.inventory__use-potion-btn--use', {
                hasText: /Aktywuj buff/i,
            });
            await expect(activateBtn).toBeVisible();
            await activateBtn.tap();

            await expect(page.locator('.inventory__popup--use-potion')).toHaveCount(0, { timeout: 5_000 });

            const buffsBtn = page.locator('.top-header__buffs-btn');
            await expect(buffsBtn).toBeVisible({ timeout: 5_000 });
            await expect(buffsBtn.locator('.top-header__buffs-count')).toHaveText('1');

            await buffsBtn.tap();
            const popover = page.locator('.buff-popover');
            await expect(popover).toBeVisible({ timeout: 5_000 });

            const buffRow = popover.locator('.buff-popover__row').first();
            await expect(buffRow).toBeVisible();
            await expect(buffRow.locator('.buff-popover__row-name')).toContainText(/XP/i);

            await expect(buffRow.locator('.buff-popover__row-time'))
                .toHaveText(/^\s*(1h\s*00m|59m\s*\d{2}s)\s*$/, { timeout: 5_000 });
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
