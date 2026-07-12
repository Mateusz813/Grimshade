
import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';

test.describe('City › Deposit', { tag: '@city' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('/deposit renders header + Plecak panel + Depozyt panel + empty states', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
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

            await page.goto('/deposit');

            await expect(page.locator('.deposit__title')).toContainText('Depozyt');

            const panels = page.locator('.deposit__panel');
            await expect(panels).toHaveCount(2);

            const panelTitles = panels.locator('.deposit__panel-title');
            await expect(panelTitles.nth(0)).toContainText('Plecak');
            await expect(panelTitles.nth(1)).toContainText('Depozyt');

            const bagCounter = panels.nth(0).locator('.deposit__panel-count');
            const depCounter = panels.nth(1).locator('.deposit__panel-count');
            await expect(bagCounter).toContainText('/ 1000');
            await expect(depCounter).toContainText('/ 10000');

            const emptyStates = page.locator('.deposit__empty');
            await expect(emptyStates).toHaveCount(2);
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
