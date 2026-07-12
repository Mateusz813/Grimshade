
import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { cleanupCharacterByName } from '../../fixtures/cleanup';

const goToCreatePage = async (page: import('@playwright/test').Page): Promise<void> => {
    await loginViaUI(page, testUsers.primary);
    if (!page.url().endsWith('/character-select')) {
        await page.goto('/character-select');
    }
    const createBtn = page.getByRole('button', { name: /Stwórz nową postać/i });
    await createBtn.scrollIntoViewIfNeeded();
    await createBtn.tap();
    await expect(page).toHaveURL(/\/create-character$/);

    await page.locator('.character-create__class-btn').filter({ hasText: 'Rycerz' }).tap();
};

test.describe('Character › Create › Validation', { tag: '@character' }, () => {
    test('rejects nickname shorter than 3 characters', async ({ page }) => {
        try {
            await goToCreatePage(page);

            await page.locator('.character-create__input').fill('Ab');
            await page.getByRole('button', { name: /Stwórz postać/i }).tap();

            await expect(page).toHaveURL(/\/create-character$/);
            await expect(page.getByText(/Min\. 3 znaki/i)).toBeVisible();
        } finally {
            await cleanupCharacterByName(testUsers.primary.email, 'Ab');
        }
    });

    test('rejects nickname with special characters', async ({ page }) => {
        try {
            await goToCreatePage(page);

            await page.locator('.character-create__input').fill('Test@Char');
            await page.getByRole('button', { name: /Stwórz postać/i }).tap();

            await expect(page).toHaveURL(/\/create-character$/);
            await expect(page.getByText(/Tylko litery, cyfry i max jedna spacja/i)).toBeVisible();
        } finally {
            await cleanupCharacterByName(testUsers.primary.email, 'Test@Char');
        }
    });

    test('input HTML maxLength caps nickname at 18 characters', async ({ page }) => {
        await goToCreatePage(page);

        const tooLong = 'A'.repeat(30);
        const input = page.locator('.character-create__input');
        await input.fill(tooLong);

        const value = await input.inputValue();
        expect(value.length).toBe(18);
    });
});
