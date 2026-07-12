
import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { seedConsumables } from '../../fixtures/seedInventory';

test.describe('Combat › Death', { tag: '@combat' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('Death Protection elixir in consumables -> BuffPopover protection row', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: {
                    level: 10,
                    highest_level: 10,
                    hp_regen: 0,
                    mp_regen: 0,
                },
            });
            createdId = created.id;

            await seedConsumables({
                characterId: created.id,
                counts: { death_protection: 2 },
            });

            await loginViaUI(page, testUsers.primary);
            if (!page.url().endsWith('/character-select')) {
                await page.goto('/character-select');
            }
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 10_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });
            await expect(page.locator('.town__char-name')).toHaveText(nick);

            const buffsBtn = page.locator('.top-header__buffs-btn');
            await expect(buffsBtn).toBeVisible({ timeout: 10_000 });
            await expect(buffsBtn.locator('.top-header__buffs-count')).toHaveText('1');

            await buffsBtn.tap();
            const popover = page.locator('.buff-popover');
            await expect(popover).toBeVisible({ timeout: 5_000 });

            const dpRow = popover.locator('.buff-popover__row--protection', {
                hasText: 'Eliksir ochrony',
            });
            await expect(dpRow).toBeVisible();
            await expect(dpRow.locator('.buff-popover__row-name')).toHaveText('Eliksir ochrony');
            await expect(dpRow.locator('.buff-popover__row-time')).toHaveText('×2');

            const aolRow = popover.locator('.buff-popover__row--protection', {
                hasText: 'Amulet of Loss',
            });
            await expect(aolRow).toHaveCount(0);
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
