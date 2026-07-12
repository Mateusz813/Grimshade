
import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';

test.describe('Auth › Session', { tag: '@auth' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('cleared Supabase token -> navigating to /inventory redirects to /login', async ({ page }) => {
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

            await expect(page.locator('.town__char-name')).toHaveText(nick, { timeout: 10_000 });

            await page.evaluate(() => {
                const keys = Object.keys(window.localStorage);
                for (const k of keys) {
                    if (k.startsWith('sb-')) {
                        window.localStorage.removeItem(k);
                    }
                }
            });

            await page.goto('/inventory');

            await expect(page).toHaveURL(/\/login$/, { timeout: 15_000 });

            await expect(page.locator('input[type="email"]')).toBeVisible({ timeout: 5_000 });
            await expect(page.locator('input[type="password"]')).toBeVisible();
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
