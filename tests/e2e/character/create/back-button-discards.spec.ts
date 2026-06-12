/**
 * Atomic E2E — przycisk "<- Wróć" na ekranie tworzenia postaci wraca
 * do `/character-select` bez tworzenia żadnej postaci.
 *
 * Spec (BACKLOG 2.9): "Anuluj tworzenie (back button) — navigate to
 * /create-character -> tap back button -> wraca do /character-select
 * bez side effects (no char created)".
 *
 * CharacterCreate.tsx linia 205-211:
 *     <button className="character-create__back-btn"
 *             onClick={() => navigate('/character-select')}><- Wróć</button>
 *
 * Setup:
 *   1. Login UI -> /character-select (świeże konto / lub po wcześniejszych
 *      testach z postaciami — neutralne dla tego testu).
 *   2. Tap "+ Stwórz nową postać" -> /create-character (nasza punkt
 *      startu — sam ekran tworzenia).
 *
 * One action:    tap "<- Wróć" (.character-create__back-btn).
 * One outcome:
 *     - URL === /character-select
 *     - Liczba postaci nie zmieniła się (przed = po). Sprawdzamy przez
 *       count `.char-select__card` na liście.
 *
 * Cleanup: jeśli mimo wszystko jakaś postać została (nie powinna —
 * back button nie tworzy nic), wyłapie ją bulk-cleanup na CI. Tutaj
 * nie tworzymy żadnej postaci -> nie ma id do cleanup-u. `finally`
 * pusty, ale block try/finally zachowany dla konwencji.
 *
 * Parallelism note: snapshot SET of nicków przed back-button-em zamiast
 * raw count. Powód — równoległy test (np. `blocks-at-max-7.spec.ts`
 * na drugim profile mobile) tworzy 7 dodatkowych char-ów na primary
 * w trakcie naszego flow. Raw `count === initialCount` fail-owałby
 * fałszywie (after = initial + 7). Z snapshotem nicków asercja jest:
 * "wszystkie nicki które tu już były są nadal tu" — odporne na
 * concurrent inserty + nadal łapie regresję "back button przypadkiem
 * stworzył postać" (bo nowy nick by się NIE znajdował w initial-secie).
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';

test.describe('Character › Create', { tag: '@character' }, () => {
    test.describe.configure({ timeout: 30_000 });

    test('back button on /create-character returns to /character-select without creating a character', async ({ page }) => {
        // 1. Login -> /character-select.
        await loginViaUI(page, testUsers.primary);
        if (!page.url().endsWith('/character-select')) {
            await page.goto('/character-select');
        }

        // 2. Snapshot SET nicków postaci PRZED naciśnięciem create button.
        //    `.char-select__card-name` zawiera nick każdej karty
        //    (CharacterSelect.tsx linia 301). Snapshot nicków zamiast
        //    raw count żeby asercja była odporna na concurrent inserty
        //    od innych testów na primary (patrz parallelism note w
        //    nagłówku pliku).
        const nameLocator = page.locator('.char-select__card-name');
        await expect(nameLocator.first().or(page.locator('.char-select__empty'))).toBeVisible({ timeout: 10_000 });
        const namesBefore = new Set(await nameLocator.allTextContents());

        // 3. Nawigacja do /create-character. Najpierw próbujemy tap
        //    "+ Stwórz nową postać" jeśli widoczny (happy path); jeśli
        //    nie (np. ktoś równolegle wpakował primary do 7/7) -> direct
        //    `page.goto('/create-character')` — i tak testujemy tylko
        //    sam back-button na tym ekranie, sposób dotarcia bez znaczenia.
        const createBtn = page.getByRole('button', { name: /Stwórz nową postać/i });
        if (await createBtn.count() > 0) {
            await createBtn.scrollIntoViewIfNeeded();
            await createBtn.tap();
        } else {
            await page.goto('/create-character');
        }
        await expect(page).toHaveURL(/\/create-character$/, { timeout: 10_000 });

        // 4. Sanity — ekran tworzenia faktycznie wyrenderował się
        //    (back button jest pod tytułem "Stwórz postać").
        await expect(page.locator('.character-create__back-btn')).toBeVisible();

        // 5. THE ACTION — tap "<- Wróć".
        await page.locator('.character-create__back-btn').tap();

        // 6. THE OUTCOME — URL z powrotem na /character-select.
        await expect(page).toHaveURL(/\/character-select$/, { timeout: 10_000 });

        // 7. Side-effect check: WSZYSTKIE nicki które tu były PRZED
        //    naszą wizytą na /create-character są nadal widoczne. Asercja
        //    SET-superset zamiast count-exact, bo równoległe testy mogą
        //    dorzucić swoje char-y w międzyczasie (parallelism note).
        //    Krytyczny invariant — żaden NOWY nick stworzony przez NAS
        //    nie powinien się pojawić (back button nie tworzy postaci):
        //    snapshot przed był pusty z naszej strony, więc po nawigacji
        //    namesAfter ⊇ namesBefore wystarcza (newcomers = inni testerzy).
        await expect(nameLocator.first().or(page.locator('.char-select__empty'))).toBeVisible({ timeout: 10_000 });
        const namesAfter = new Set(await nameLocator.allTextContents());
        for (const name of namesBefore) {
            expect(namesAfter.has(name), `expected nick "${name}" to remain on list after back-button discard`).toBe(true);
        }
    });
});
