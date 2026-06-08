/**
 * Atomic E2E — login happy path.
 *
 * Setup state:  fresh anonymous browser context.
 * One action:   wypełnij formularz prawdziwymi credentials + tap submit.
 * One outcome:  URL === `/character-select` (router widzi nową
 *               session + brak character-a → redirect chain
 *               `/login → / → /character-select`).
 *
 * Dlaczego nie sprawdzamy że trafiamy bezpośrednio na Town:
 * konto `test@grimshade.pl` jest świeże i nie ma jeszcze postaci
 * stworzonej w `characters` table. Po loginie `useCharacterStore`
 * ładuje pustą listę → AppRouter `/` route widzi `character === null`
 * → `<Navigate to="/character-select" />`. To jest UPRAWNIONY happy
 * path "user-bez-postaci": pokazuje że logowanie + session bootstrap
 * + redirect router działają end-to-end.
 *
 * Jeśli właściciel kiedyś stworzy postać na koncie testowym (np. dla
 * combat-flow testów), ten test trzeba będzie zmienić na asercję
 * `/` (Town) zamiast `/character-select` — albo wycofać character
 * z konta przed test runem przez seed helper.
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';

test.describe('Auth › Login', { tag: '@auth' }, () => {
    test('happy path: valid credentials → /character-select', async ({ page }) => {
        await page.goto('/login');

        // Sanity — formularz wyrenderował się, zanim w niego klikniemy
        await expect(page.locator('input[type="email"]')).toBeVisible();
        await expect(page.locator('input[type="password"]')).toBeVisible();

        // Fill — `.fill()` jest semantycznie OK na mobile (zapisuje wartość,
        // emituje input event); na touch-screen-ach nie symulujemy keyboard.
        await page.locator('input[type="email"]').fill(testUsers.primary.email);
        await page.locator('input[type="password"]').fill(testUsers.primary.password);

        // Tap zamiast click — na profilu `iPhone 13` / `Pixel 7` Playwright
        // ma `hasTouch: true`, więc tap robi prawdziwy touchstart/touchend.
        // To jest dokładnie ta różnica o którą prosił właściciel
        // ("klik myszka a tap ekranu to lekka roznica"). Click też by
        // zadziałał (emulowany jako tap) ale explicit tap jest czytelniejszy.
        await page.getByRole('button', { name: /zaloguj/i }).tap();

        // Redirect chain `/login → / → /character-select` przez Supabase API call —
        // daję 15s żeby zmieścić sieć produkcyjnej Supabase.
        await expect(page).toHaveURL(/\/character-select$/, { timeout: 15_000 });

        // Sanity — strona faktycznie wyrenderowała coś po nawigacji,
        // nie jest pusta. Sprawdzamy że jest jakikolwiek główny element
        // (komponent CharacterSelect ma swój główny wrapper).
        await expect(page.locator('body')).not.toBeEmpty();
    });
});
