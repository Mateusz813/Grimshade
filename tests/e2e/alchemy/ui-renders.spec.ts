
import { test, expect } from '@playwright/test';
import { testUsers } from '../fixtures/testUsers';
import { loginViaUI } from '../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../fixtures/createCharacter';
import { cleanupCharacterById } from '../fixtures/cleanup';

test.describe('Alchemy › UI', { tag: '@alchemy' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('Alchemia tab renders 14 conversion recipe rows', async ({ page }) => {
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
            await expect(page.locator('.inventory__paperdoll-actions')).toBeVisible({ timeout: 10_000 });
            await page.getByRole('button', { name: /^auto-potion$/i }).tap();

            const popup = page.locator('.inventory__popup--potion');
            await expect(popup).toBeVisible({ timeout: 5_000 });

            await popup.getByRole('button', { name: /Alchemia/i }).tap();

            await expect(popup.locator('.inventory__popup-tab--active'))
                .toContainText(/Alchemia/i);

            await expect(popup.locator('.inventory__alchemy-hint'))
                .toContainText(/Zamieniaj slabsze eliksiry/i);

            const grid = popup.locator('.inventory__alchemy-grid');
            await expect(grid).toBeVisible();

            await expect(grid.locator('.inventory__alchemy-row')).toHaveCount(14);

            await expect(grid.getByText('Maly Eliksir HP').first()).toBeVisible();
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
