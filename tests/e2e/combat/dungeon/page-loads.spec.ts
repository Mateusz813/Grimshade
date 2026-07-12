
import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';

test.describe('Combat › Dungeon', { tag: '@combat' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('smoke: /dungeon renders dungeon list panel without errors', async ({ page }) => {
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
            await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });

            await expect(page.locator('.top-header')).toBeVisible({ timeout: 10_000 });

            await page.goto('/dungeon');

            await expect(page).toHaveURL(/\/dungeon$/, { timeout: 10_000 });

            await expect(page.locator('.dungeon')).toBeVisible({ timeout: 10_000 });

            await expect(page.locator('.dungeon__panel')).toBeVisible({ timeout: 15_000 });

            await expect(page.locator('.dungeon__hub-filters')).toBeVisible();

            const cards = page.locator('.dungeon__card');
            await expect(cards.first()).toBeVisible({ timeout: 10_000 });
            const cardCount = await cards.count();
            expect(cardCount).toBeGreaterThanOrEqual(1);
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
