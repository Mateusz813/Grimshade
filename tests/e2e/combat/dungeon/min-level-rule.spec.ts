
import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';

test.describe('Combat › Dungeon', { tag: '@combat' }, () => {
    test.describe.configure({ timeout: 90_000 });

    test('solo Knight lvl 5: dungeon_10 (minLvl=10) shows lock chip + no Wejdź; dungeon_1 (minLvl=1) shows Wejdź', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: { level: 5, highest_level: 5, hp_regen: 0, mp_regen: 0 },
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
            await expect(page.locator('.top-header')).toBeVisible({ timeout: 10_000 });

            await page.goto('/dungeon');
            await expect(page).toHaveURL(/\/dungeon$/, { timeout: 10_000 });
            await expect(page.locator('.dungeon__panel')).toBeVisible({ timeout: 15_000 });

            const dungeon1Card = page.locator('.dungeon__card', {
                has: page.locator('.dungeon__card-name', { hasText: 'Ruiny Starego Fortu' }),
            });
            await expect(dungeon1Card).toBeVisible({ timeout: 10_000 });
            await expect(dungeon1Card.locator('.dungeon__locked')).toHaveCount(0);
            await expect(dungeon1Card.locator('.dungeon__enter-btn')).toBeVisible();

            const dungeon10Card = page.locator('.dungeon__card', {
                has: page.locator('.dungeon__card-name', { hasText: 'Ruiny Strażnicy' }),
            });
            await expect(dungeon10Card).toBeVisible({ timeout: 10_000 });
            await expect(dungeon10Card.locator('.dungeon__locked')).toBeVisible();
            await expect(dungeon10Card.locator('.dungeon__locked')).toHaveText(/Wymaga Lvl 10/);
            await expect(dungeon10Card.locator('.dungeon__enter-btn')).toHaveCount(0);
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
