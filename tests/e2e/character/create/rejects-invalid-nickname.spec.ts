/**
 * Atomic E2E — walidacja nicku przy tworzeniu postaci.
 *
 * Spec (`testyE2E.docx` punkt 2): "Sprawdz czy nie mozna wpisywac
 * znakow specjalnych w polu z nickiem postaci oraz czy validacja max
 * ilosc znakow dziala poprawnie"
 *
 * Zod schema w `CharacterCreate.tsx` linie 93-101:
 *   z.string().trim()
 *     .min(3, 'Min. 3 znaki')
 *     .max(18, 'Max. 18 znaków')
 *     .regex(/^[a-zA-Z0-9]+(?: [a-zA-Z0-9]+)?$/, 'Tylko litery, cyfry i max jedna spacja')
 *
 * 3 testy, każdy weryfikuje że konkretna invalid wartość renderuje
 * odpowiedni error message i NIE submituje formularza (postać nie
 * powstaje). Brak cleanup-u bo postać nie powstaje — ale defensywnie
 * dorzucamy `cleanupCharactersForEmail` w finally na wszelki wypadek
 * (np. test się crashuje po accidental submit).
 *
 * UWAGA: input HTML ma `maxLength=18` (CharacterCreate.tsx line 226),
 * więc fizycznie nie da się wpisać >18 znaków. Zod walidacja max=18
 * jest backup-em. Test "too long" więc weryfikuje że input rzeczywiście
 * obcina po 18 znakach (HTML attribute działa).
 */

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

    // Class trzeba wybrać żeby submit nie blokował się na "Wybierz klasę"
    await page.locator('.character-create__class-btn').filter({ hasText: 'Rycerz' }).tap();
};

test.describe('Character › Create › Validation', { tag: '@character' }, () => {
    test('rejects nickname shorter than 3 characters', async ({ page }) => {
        try {
            await goToCreatePage(page);

            await page.locator('.character-create__input').fill('Ab');
            await page.getByRole('button', { name: /Stwórz postać/i }).tap();

            // Form NIE submituje — zostajemy na /create-character
            await expect(page).toHaveURL(/\/create-character$/);
            // Error message dla name field
            await expect(page.getByText(/Min\. 3 znaki/i)).toBeVisible();
        } finally {
            // Defensive: jeśli regression zezwoli na submit z 'Ab', sprzątamy.
            // Per-name żeby nie tknąć postaci tworzonych przez inne testy.
            await cleanupCharacterByName(testUsers.primary.email, 'Ab');
        }
    });

    test('rejects nickname with special characters', async ({ page }) => {
        try {
            await goToCreatePage(page);

            // `@` nie matchuje `[a-zA-Z0-9]+(?: [a-zA-Z0-9]+)?`
            await page.locator('.character-create__input').fill('Test@Char');
            await page.getByRole('button', { name: /Stwórz postać/i }).tap();

            await expect(page).toHaveURL(/\/create-character$/);
            await expect(page.getByText(/Tylko litery, cyfry i max jedna spacja/i)).toBeVisible();
        } finally {
            // Defensive: gdyby kiedyś regression zezwoliła na @ w nicku
            await cleanupCharacterByName(testUsers.primary.email, 'Test@Char');
        }
    });

    test('input HTML maxLength caps nickname at 18 characters', async ({ page }) => {
        await goToCreatePage(page);

        const tooLong = 'A'.repeat(30);
        const input = page.locator('.character-create__input');
        await input.fill(tooLong);

        // HTML maxLength=18 (CharacterCreate.tsx line 226) obcina input value
        const value = await input.inputValue();
        expect(value.length).toBe(18);
        // Brak finally — test nie klika submit, więc żadna postać nie powstaje.
        // Defensive cleanup nie ma czego sprzątać.
    });
});
