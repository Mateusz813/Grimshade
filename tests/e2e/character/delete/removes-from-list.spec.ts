
import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';

test.describe('Character › Delete', { tag: '@character' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('tapping trash + confirming "Usuń" removes character card from /character-select', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Archer',
            });
            createdId = created.id;

            await loginViaUI(page, testUsers.primary);
            await page.goto('/character-select');

            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 10_000 });

            await card.locator('.char-select__delete-btn').tap();
            const modal = page.locator('.char-select__modal');
            await expect(modal).toBeVisible({ timeout: 5_000 });

            await modal.locator('.char-select__modal-input').fill(testUsers.primary.password);
            await modal.locator('.char-select__modal-delete').tap();

            await expect(card).toHaveCount(0, { timeout: 10_000 });
            await expect(page.locator('.char-select__card-name', { hasText: nick })).toHaveCount(0);
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
