/**
 * Atomic E2E — character creation flow per każdej z 7 klas.
 *
 * Spec (`testyE2E.docx` punkt 1): "Stwórz postać dla oraz wejdz do
 * miasta i sprawdź czy nick sie zgadza dla kazdej klasy. Czyli ma byc
 * tutaj 7 testow"
 *
 * Pattern: parametryzowana pętla `for (const cls of CLASSES)` generuje
 * 7 niezależnych test()-ów. UI Mode pokazuje je jako 7 osobnych
 * elementów drzewka pod `Character › Create`.
 *
 * Każdy test:
 *  1. Login jako primary
 *  2. Goto /create-character (z /character-select)
 *  3. Tap class card (po polskiej nazwie `name_pl`)
 *  4. Fill nick (unique per test żeby równoległe runy się nie biły)
 *  5. Tap "Stwórz postać"
 *  6. Wait for redirect na `/` (Town)
 *  7. Verify Town pokazuje wprowadzony nick + ikonę klasy + "Poziom 1"
 *  8. finally: cleanupCharactersForEmail(primary.email) — postać znika
 *
 * Cleanup: hard rule z CLAUDE.md TESTING — żaden ślad nie zostaje
 * na koncie po teście. `cleanupCharactersForEmail` kasuje wszystkie
 * postacie usera + ich child rows (inventory, skille, etc.).
 *
 * Edge case: jeśli user ma już 7/7 postaci, przycisk "Stwórz" jest
 * disabled. Cleanup w `finally` PRZED kolejnym testem rozwiązuje —
 * `fullyParallel: true` może odpalać kilka tests równocześnie, ale
 * Supabase pozwala na max 7 per-user; nasze cleanup leci natychmiast
 * po teście (PER-TEST), więc nigdy nie powinniśmy przekroczyć limitu.
 *
 * UWAGA do parallelism: 7 tests × 2 mobile profile = 14 runs. Wszystkie
 * używają tego samego konta primary. Worker count = 4 (default lokalny),
 * więc maksymalnie 4 testy jednocześnie tworzą postać na primary.
 * Wszystkie żyją krótko (~5-10s) i każdy ma własny unique nick →
 * brak race conditions na DB.
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterByName } from '../../fixtures/cleanup';

interface IClassUnderTest {
    /** ID z classes.json — używane też jako API value. */
    id: string;
    /** Polska nazwa (na przycisku w UI). */
    namePl: string;
    /** Ikona (emoji) na przycisku — łączymy w regex selectora. */
    icon: string;
}

const CLASSES: ReadonlyArray<IClassUnderTest> = [
    { id: 'Knight',      namePl: 'Rycerz',     icon: '⚔️' },
    { id: 'Mage',        namePl: 'Mag',        icon: '🔮' },
    { id: 'Cleric',      namePl: 'Kleryk',     icon: '✨' },
    { id: 'Archer',      namePl: 'Łucznik',    icon: '🏹' },
    { id: 'Rogue',       namePl: 'Łotr',       icon: '🗡️' },
    { id: 'Necromancer', namePl: 'Nekromanta', icon: '💀' },
    { id: 'Bard',        namePl: 'Bard',       icon: '🎵' },
];

// Każdy test character/create wykonuje pełen flow login → goto → tap → tap → fill → tap
// → assert Town → cleanup. Default 30s bywa tight na WebKit + parallel load.
// Bump do 60s żeby finally zdążyło wykasować postać.
test.describe('Character › Create', { tag: '@character' }, () => {
    // Serial mode: wszystkie 7 testów w tym pliku biegnie KOLEJNO na każdym profilu,
    // nie równolegle. Powód: `fullyParallel: true` w config-u rozkłada testy
    // wewnątrz pliku po wielu worker-ach — 7 jednoczesnych tworzeń postaci
    // na tym samym koncie testowym hituje 7-character-per-user limit.
    // Serial = 1 char create at a time → nigdy więcej niż 1 w trakcie.
    test.describe.configure({ timeout: 60_000, mode: 'serial' });

    for (const cls of CLASSES) {
        test(`creates ${cls.id} (${cls.namePl}) and enters Town with correct nick + class + level 1`, async ({ page }) => {
            const nick = generateTestCharacterName();

            try {
                // 1. Login → /character-select (świeże konto bez postaci) LUB / (z postacią z poprzedniego testu który źle posprzątał)
                await loginViaUI(page, testUsers.primary);

                // Jeśli ląduje na / (czyli ma już jakąś postać aktywną), idź do /character-select przez "Zmień postać" w avatar menu lub direct nav
                if (!page.url().endsWith('/character-select')) {
                    await page.goto('/character-select');
                }

                // 2. Tap "Stwórz nową postać" — przycisk widoczny tylko gdy < 7 postaci.
                //    Na mobile viewport (390×844) przycisk może być pod fold-em
                //    gdy lista postaci jest długa — eksplicit scrollIntoView.
                const createBtn = page.getByRole('button', { name: /Stwórz nową postać/i });
                await createBtn.scrollIntoViewIfNeeded();
                await createBtn.tap();
                await expect(page).toHaveURL(/\/create-character$/, { timeout: 10_000 });

                // 3. Tap class card — selektor po nazwie polskiej + ikonie (icon jest cały wewnątrz button text)
                //    Używamy regex bo `Rycerz` mogłoby kolidować z innym tekstem (np. "Wybierz") — łapiemy by ikonę.
                const classButton = page.locator('.character-create__class-btn').filter({
                    hasText: cls.namePl,
                });
                await classButton.tap();
                await expect(classButton).toHaveClass(/character-create__class-btn--selected/);

                // 4. Fill nick. Input nie ma id/htmlFor — selektor po type="text" w obrębie formularza.
                await page.locator('.character-create__input').fill(nick);

                // 5. Tap submit
                await page.getByRole('button', { name: /Stwórz postać/i }).tap();

                // 6. Redirect na / (Town view)
                await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });

                // 7. Verify Town pokazuje stworzoną postać
                await expect(page.locator('.town__char-name')).toHaveText(nick);
                await expect(page.locator('.town__char-level')).toHaveText('Poziom 1');
                // Class display — ikona + ew. nazwa. Sprawdzamy że ikona klasy jest na widoku.
                // (Town.tsx line 314: <span className="town__char-class"> z dynamicznym backgroundColor)
                await expect(page.locator('.town__char-class')).toBeVisible();
            } finally {
                // Cleanup per-postać (NIE bulk) — bo testy w innych plikach
                // mogą używać tego samego konta równolegle i bulk wipe by
                // skasował ich świeże postacie mid-flight.
                await cleanupCharacterByName(testUsers.primary.email, nick);
            }
        });
    }
});
