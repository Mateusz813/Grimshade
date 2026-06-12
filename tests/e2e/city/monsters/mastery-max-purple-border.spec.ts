/**
 * Atomic E2E — Monster card otrzymuje class `combat__mcard--mastery-max`
 * (purple border + glow) gdy mastery dla tego potwora jest 25/25.
 *
 * Spec (BACKLOG.md punkt 5.3): "Mastery 25/25 -> purple border".
 *
 * Co testujemy:
 *  - Seed Knight + game_save z `mastery.masteries = { rat: { level: 25 } }`
 *    -> po hydration `useMasteryStore.masteries['rat'].level === 25`.
 *  - Nawigacja na `/monsters` -> karta Szczur (id='rat') ma DUAL klasy:
 *      - `combat__mcard` (base)
 *      - `combat__mcard--mastery-max` (purple border + glow + gradient bg)
 *    CSS: `Combat.scss` linia 408-416 — `border-color: rgba(#9c27b0, 0.6)`.
 *  - Mastery chip pokazuje "25/25" + ma class `combat__mcard-mastery--max`.
 *
 * Inne potwory (bez seeded mastery) NIE mają `--mastery-max` klasy —
 * to sanity check że selector trafia w nasz zamierzony potwór, nie w
 * pierwszą losową kartę.
 *
 * Setup:
 *  - Knight lvl 1 (Szczur jest UNLOCKED na lvl 1 — `getMonsterUnlockStatus`
 *    zwraca unlocked=true dla pierwszego potwora w sorted list).
 *  - `mastery.masteries.rat = { level: 25 }` — MAX_MASTERY_LEVEL z
 *    `src/stores/masteryStore.ts`. `masteryKills: {}` (po MAX nikt już
 *    nie tickuje killsów).
 *
 * Edge:
 *  - Mastery class jest stosowany TYLKO gdy `!locked && isMaxMasteryHere`
 *    (MonsterList.tsx linia 283) — gdyby Szczur był locked, kombo
 *    locked + max nie da `--mastery-max`. Świeży Knight lvl 1 ma Szczur
 *    odblokowany (no prereq), więc kombinacja działa.
 *
 * Cleanup: try/finally + cleanupCharacterById — game_saves jest w
 * CHARACTER_CHILD_TABLES, więc kasowanie postaci kasuje też seeded
 * mastery state.
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { seedGameSave, findUserIdByEmail } from '../../fixtures/seedGameSave';

test.describe('City › Monsters', { tag: '@city' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('mastery 25/25 on monster -> card has mastery-max class (purple border)', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            // 1. Seed Knight lvl 1 — Szczur (id='rat') jest UNLOCKED na lvl 1.
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: { hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            // 2. Seed game_save z mastery.masteries.rat.level=25 (MAX).
            //    Po hydration `useMasteryStore.getState().masteries['rat'].level === 25`,
            //    więc `MonsterList.tsx` linia 270 `isMaxMasteryHere = masteryLvl >= MASTERY_MAX_LEVEL`
            //    da true -> `combat__mcard--mastery-max` class wpada do `cardClass` array.
            const userId = await findUserIdByEmail(testUsers.primary.email);
            await seedGameSave({
                characterId: created.id,
                userId,
                masteries: { rat: { level: 25 } },
            });

            // 3. Login + select character + go to /monsters
            await loginViaUI(page, testUsers.primary);
            await page.goto('/character-select');
            const charCard = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(charCard).toBeVisible({ timeout: 10_000 });
            await charCard.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });

            await page.goto('/monsters');
            await expect(page.locator('.combat__hub-monsters')).toBeVisible({ timeout: 10_000 });

            // 4. Znajdź kartę Szczur. Sortowanie kart w MonsterList: po level
            //    asc (linia 39 `.slice().sort((a, b) => a.level - b.level)`),
            //    a Szczur jest level 1 -> ZAWSZE pierwsza karta. Match po
            //    exact-text regex `^Szczur$` żeby NIE matchować "Człowiek-Jaszczur"
            //    (lvl 12) który zawiera "Szczur" jako substring.
            const ratCard = page.locator('.combat__mcard', {
                has: page.locator('.combat__mcard-name', { hasText: /^Szczur$/ }),
            });
            await expect(ratCard).toBeVisible({ timeout: 10_000 });

            // 5. Hard assert: karta Szczura ma class `combat__mcard--mastery-max`.
            //    Playwright `toHaveClass` z regex matchuje partial — selektor
            //    łapie wszystkie 3 klasy z `cardClass` array:
            //    'combat__mcard combat__mcard--mastery-max' (locked=false, hasTask=false,
            //    isMaxMasteryHere=true).
            await expect(ratCard).toHaveClass(/combat__mcard--mastery-max/);

            // 6. Mastery chip "25/25" + class `combat__mcard-mastery--max`.
            //    Mastery chip jest w `.combat__mcard-mastery` (linia 311-316);
            //    text format = "{masteryLvl}/{MASTERY_MAX_LEVEL}" -> "25/25".
            const masteryChip = ratCard.locator('.combat__mcard-mastery');
            await expect(masteryChip).toContainText('25/25');
            await expect(masteryChip).toHaveClass(/combat__mcard-mastery--max/);

            // 7. Sanity: INNA karta (np. Pająk Jaskiniowy — drugi w liście)
            //    NIE ma `combat__mcard--mastery-max` (no seeded mastery).
            //    Pająk JEST locked (no mastery na poprzednim -> lock), więc
            //    bardziej generyczny check: karta ze stringiem "0/25" w
            //    mastery chip-ie NIE ma mastery-max class.
            //    Bierzemy 2-ą kartę z grid-a (która = Pająk Jaskiniowy bo sort by level).
            const secondCard = page.locator('.combat__mcard').nth(1);
            await expect(secondCard).not.toHaveClass(/combat__mcard--mastery-max/);
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
