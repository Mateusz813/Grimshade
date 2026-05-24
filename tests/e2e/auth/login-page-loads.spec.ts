/**
 * Atomic E2E — login page loads cleanly.
 *
 * Sample test demonstrujący "single-responsibility" pattern który
 * przyjęliśmy dla Grimshade E2E suite:
 *   1. Setup state (tu: nic — fresh anonymous session)
 *   2. ONE user action (navigate do /login)
 *   3. ONE assertion (formularz widoczny)
 *
 * To ma sens jako smoke test — łapie regresje typu "build broken,
 * white screen of death", "missing route", "JS exception przy
 * pierwszym renderze".
 *
 * Inne testy auth-flow w tym folderze będą równie atomic:
 *   - login-rejects-invalid-credentials.spec.ts
 *   - login-redirects-to-character-select-on-success.spec.ts
 *   - register-validates-email-format.spec.ts
 *   - logout-clears-session.spec.ts
 */

import { test, expect } from '@playwright/test';

test('login page renders email + password form', async ({ page }) => {
    await page.goto('/login');

    // Logo Grimshade jest na stronie loginu (img z alt="Grimshade")
    await expect(page.getByAltText('Grimshade')).toBeVisible();

    // Pola formularza muszą być widoczne. Login.tsx używa
    // <label> bez htmlFor + <input> bez id (TODO: dorzucić
    // accessibility w follow-up commit), więc selektujemy
    // po type attribute na razie.
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();

    // Przycisk "Zaloguj się" musi być na stronie
    await expect(page.getByRole('button', { name: /zaloguj/i })).toBeVisible();
});
