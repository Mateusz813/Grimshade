
import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';

test.describe('Combat › Transform', { tag: '@combat' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('smoke: /transform renders transform list without errors', async ({ page }) => {
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

            await page.goto('/transform');

            await expect(page).toHaveURL(/\/transform$/, { timeout: 10_000 });

            await expect(page.locator('.transform')).toBeVisible({ timeout: 10_000 });

            await expect(page.locator('.transform__list')).toBeVisible({ timeout: 10_000 });

            const cards = page.locator('.transform__card');
            await expect(cards.first()).toBeVisible({ timeout: 10_000 });
            const cardCount = await cards.count();
            expect(cardCount).toBeGreaterThanOrEqual(1);

            await expect(page.locator('.transform__card-name').first()).toBeVisible({ timeout: 5_000 });
            await expect(page.locator('.transform__card-level-pill').first()).toBeVisible();
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
