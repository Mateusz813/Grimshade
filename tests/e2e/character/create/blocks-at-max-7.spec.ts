/**
 * Atomic E2E — przy 7/7 postaci na koncie przycisk "Stwórz nową
 * postać" jest UKRYTY (a nie tylko disabled).
 *
 * Spec (BACKLOG 2.8): "Max 7 postaci — seed 7 chars via API →
 * /character-select → assert 'Stwórz nową postać' button hidden or
 * disabled (text shows '7/7')".
 *
 * CharacterSelect.tsx linia 369:
 *     {characters.length < 7 && (<button ...>+ Stwórz nową postać (X/7)</button>)}
 *
 * Tzn. przy `length >= 7` button NIE jest renderowany — nie istnieje w
 * DOM. Asercja: `getByRole('button', { name: /Stwórz nową postać/ })`
 * musi mieć `count === 0`. Dodatkowo asercja że na liście jest dokładnie
 * 7 kart postaci (UI faktycznie zrenderowało nasze 7 seedów).
 *
 * Setup:
 *   1. Seed 7 postaci przez `createCharacterViaApi` (różne klasy, unikalne
 *      nicki) — sekwencyjnie, żeby zachować deterministyczną kolejność
 *      INSERT-ów i ułatwić cleanup w razie partial failure.
 *   2. Login UI flow → /character-select.
 *   3. Wait aż lista załaduje się (`.char-select__card` count == 7).
 *
 * One action:    żadnej — to test asercji STANU na liście, nie action-outcome.
 * One outcome:   przycisk "Stwórz nową postać" nie istnieje w DOM.
 *
 * Cleanup:       per-char `cleanupCharacterById` w finally (race-safe wobec
 *                innych testów na primary). Bulk `cleanupCharactersForEmail`
 *                byłby krótszy, ale skasowałby też char-y tworzone w
 *                równolegle przez inne testy z innego pliku.
 *
 * Parallelism note: workers=2 (1 per profile). Inne testy na primary
 * tworzą max 1 char w danym momencie → łącznie 7+1 = 8 chars w peaku.
 * 7-cap jest enforce-owany tylko w UI conditional (`length < 7`), NIE
 * w DB/RPC — `createCharacterViaApi` bypassuje przez service_role.
 * Stąd nawet jeśli inny test tworzy char-a w międzyczasie, asercja
 * "button hidden" trzyma się bo `8 < 7 === false`.
 *
 * DLATEGO asercja na liczbie kart to `count >= SEED_CLASSES.length`,
 * a NIE `count === SEED_CLASSES.length` — równolegle inny test może
 * dorzucić swoją 8-mą kartę. Liczy się tylko że nasze 7 + nasz button
 * hidden state są obecne; ekstra karty od innych testów są noise który
 * nie psuje invariantu który testujemy.
 *
 * Timeout 90s — seed 7 chars × ~1s każdy + login + render + cleanup
 * × 7 chars × ~0.5s. Default 30s za tight dla WebKit pod load-em.
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import {
    createCharacterViaApi,
    generateTestCharacterName,
    type CharacterClass,
} from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';

// Mix 7 różnych klas żeby każdy character miał inną klasę (sanity że
// API seed nie cierpi na constraint typu "max 1 per class") + lepsze
// debug w razie failu (na karcie widać klasę → łatwo skorelować z seed).
const SEED_CLASSES: ReadonlyArray<CharacterClass> = [
    'Knight',
    'Mage',
    'Cleric',
    'Archer',
    'Rogue',
    'Necromancer',
    'Bard',
];

test.describe('Character › Create', { tag: '@character' }, () => {
    test.describe.configure({ timeout: 90_000 });

    test('hides "Stwórz nową postać" button when account has 7/7 characters', async ({ page }) => {
        const createdIds: string[] = [];

        try {
            // 1. Seed 7 postaci sekwencyjnie. Sequential a nie Promise.all
            //    bo:
            //     • łatwiej zdebugować w razie failu (wiadomo na której pętli się sypnęło)
            //     • Supabase REST insert na free-tier potrafi rate-limit-ować
            //       7 jednoczesnych INSERT-ów (lekkie ryzyko 429)
            for (const cls of SEED_CLASSES) {
                const c = await createCharacterViaApi({
                    userEmail: testUsers.primary.email,
                    name: generateTestCharacterName(),
                    class: cls,
                });
                createdIds.push(c.id);
            }
            expect(createdIds).toHaveLength(7);

            // 2. Login UI flow → /character-select.
            //    loginViaUI akceptuje pos-login URL = /character-select LUB /
            //    (jeśli store ma aktywną postać). Po świeżym loginie store
            //    jest pusty → /character-select.
            await loginViaUI(page, testUsers.primary);
            if (!page.url().endsWith('/character-select')) {
                await page.goto('/character-select');
            }

            // 3. Wait aż lista załaduje się — minimum 7 naszych kart musi
            //    pojawić się w DOM. Polling przez `expect.poll` zamiast
            //    `toHaveCount` — bo równolegle inny test może wsadzić 8-mą
            //    postać i `toHaveCount(7)` by faila (parallelism note w
            //    nagłówku pliku).
            const cards = page.locator('.char-select__card');
            await expect.poll(async () => await cards.count(), { timeout: 15_000 })
                .toBeGreaterThanOrEqual(SEED_CLASSES.length);

            // 4. Główna asercja — przycisk "Stwórz nową postać" musi
            //    być NIE-zrenderowany. Code path (CharacterSelect.tsx
            //    linia 369): `{characters.length < 7 && (<button>...</button>)}`
            //    Przy length === 7 conditional jest false → button nie
            //    pojawia się w DOM w ogóle.
            const createBtn = page.getByRole('button', { name: /Stwórz nową postać/i });
            await expect(createBtn).toHaveCount(0);

            // 5. Sanity — przycisk "Wyloguj" na bottom-ie listy nadal jest,
            //    czyli view nie crash-ował tylko przez to że jest 7 postaci.
            //    (CharacterSelect.tsx linia 378-387 — button bez warunku.)
            await expect(page.getByRole('button', { name: /^wyloguj$/i })).toBeVisible();
        } finally {
            // Per-id cleanup — race-safe vs równoległe testy na primary
            // (bulk wipe by skasował char-y innego running testu).
            // `cleanupCharacterById` jest idempotent — jeśli char już
            // skasowany, zwraca `{ deleted: false, reason: 'not found' }`
            // bez rzucania błędu.
            for (const id of createdIds) {
                await cleanupCharacterById(id);
            }
        }
    });
});
