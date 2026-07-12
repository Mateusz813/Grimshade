
import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';

test.describe('City › Monsters', { tag: '@city' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('tapping :package: info button opens drop modal for unlocked monster', async ({ page }) => {
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
            await page.goto('/monsters');

            await expect(page.locator('.combat__mcard').first()).toBeVisible({ timeout: 10_000 });

            const unlockedCard = page.locator('.combat__mcard:not(.combat__mcard--locked)').first();
            await expect(unlockedCard).toBeVisible({ timeout: 5_000 });

            const infoBtn = unlockedCard.locator('.combat__mcard-action--info');
            await expect(infoBtn).toBeEnabled();
            await infoBtn.tap();

            const modal = page.locator('.combat__drop-modal');
            await expect(modal).toBeVisible({ timeout: 5_000 });

            const variants = modal.locator('.combat__variant');
            await expect(variants.first()).toBeVisible();
            const variantCount = await variants.count();
            expect(variantCount).toBeGreaterThanOrEqual(5);

            const modalName = modal.locator('.combat__drop-modal-name');
            await expect(modalName).toBeVisible();
            const nameText = (await modalName.textContent())?.trim();
            expect(nameText && nameText.length > 0).toBeTruthy();

            await modal.locator('.combat__drop-modal-close').tap();
            await expect(modal).toHaveCount(0, { timeout: 5_000 });
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
