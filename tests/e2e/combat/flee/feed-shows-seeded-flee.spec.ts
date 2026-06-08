/**
 * Atomic E2E — Deaths feed (`/deaths`) shows a directly-seeded FLEE row
 * with the correct verb modifier ("przegnał").
 *
 * Spec (BACKLOG.md punkt 13.24): "Ucieczka (flee): działa solo + party".
 * Wariant atomic — testuje TYLKO że:
 *
 *  - `character_deaths` row z `result='fled'` zainsertowany przez
 *    service_role pojawia się w globalnym feed-zie po nawigacji na
 *    `/deaths`.
 *  - Verb pokazuje się jako "przegnał" (NIE "zabił") z modifierem
 *    `.deaths__verb--fled` (NIE `.deaths__verb--killed`).
 *  - Item ma klasę `.deaths__item--fled` (NIE `.deaths__item--killed`).
 *
 * Powiązany 5.10 (`city/deaths/feed-shows-seeded-death.spec.ts`) testuje
 * killed-variant — ten plik to symetryczny fled-variant. Razem pokrywają
 * oba result-y kolumny `character_deaths.result` (`'killed'` / `'fled'`).
 *
 * **Pełny solo + party flee flow** (real combat with player tap "Uciekaj"
 * button) → osobna sesja gdy będzie napisany combat flow framework. To
 * jest wariant "API-seed-only" — pokrywa rendering layer w `/deaths`,
 * nie engine layer.
 *
 * **Schema caveat + workaround**: `result` column dodawany przez
 * `scripts/deaths_migration.sql`. Na obecnym env-zie (Supabase NANO instance)
 * migration NIE BYŁ odpalony — column `result` nie istnieje (verified
 * 2026-05-25 via service_role select).
 *
 * Workaround: zamiast polegać na column, seedujemy `source_name` z legacy
 * suffix-em `"(uciekłeś z gry)"`. Deaths.tsx `inferResult` (linia 73-77)
 * wykrywa ten suffix i zwraca `'fled'` nawet bez column `result`:
 *
 *   ```ts
 *   if (d.result) return d.result;
 *   if (LEAVE_SUFFIX_RE.test(d.source_name)) return 'fled';
 *   return 'killed';
 *   ```
 *
 * `cleanSourceName` (linia 72) strippuje suffix dla DISPLAY, więc
 * `.deaths__monster-name` pokazuje "Krypta Cesarza" — tylko inferencja
 * korzysta z full source_name z suffix-em.
 *
 * Gdy migration zostanie odpalony na env-zie + `result` column będzie
 * exist → seedDeath wpisze również `result='fled'` (linia 119 seedDeath.ts)
 * → `inferResult` zwróci 'fled' przez pierwszy if-branch zamiast drugi.
 * Test pozostanie zielony, pokrywa oba branche.
 *
 * Deterministycznie znajdujemy nasz flee-row przez unique character_name
 * (E2E{rand6} format).
 *
 * Cleanup: try/finally + cleanupCharacterById — `character_deaths` jest
 * w CHARACTER_CHILD_TABLES, więc kasowanie postaci kasuje też deaths.
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { seedDeath } from '../../fixtures/seedDeath';

test.describe('Combat › Flee', { tag: '@combat' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('seeded fled row appears in /deaths feed with "przegnał" verb', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            // 1. Seed Knight lvl 5. Nick jest unique (E2E{rand6}).
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: { level: 5, highest_level: 5 },
            });
            createdId = created.id;

            // 2. Insert FLED death row. source='dungeon' żeby pokryć też
            //    fled-from-dungeon scenariusz; source_name z LEGACY SUFFIX
            //    `(uciekłeś z gry)` żeby inferResult wykrył flee BEZ
            //    polegania na `result` column (która może nie istnieć
            //    na tym env-zie — patrz "Schema caveat" wyżej).
            //    `result: 'fled'` też przekazujemy — jeśli column exist
            //    używamy go (priority path inferResult), jeśli nie —
            //    seedDeath silently retry-uje bez result + fallback do
            //    suffix-detection robi resztę.
            await seedDeath({
                characterId: created.id,
                characterName: nick,
                characterClass: 'Knight',
                characterLevel: 5,
                source: 'dungeon',
                sourceName: 'Krypta Cesarza (uciekłeś z gry)',
                sourceLevel: 1,
                result: 'fled',
            });

            // 3. Login + nawigacja directly na `/deaths`. /deaths to globalna
            //    lista — nie potrzeba aktywnej postaci.
            await loginViaUI(page, testUsers.primary);
            await page.goto('/deaths');

            // 4. Feed lista widoczna.
            await expect(page.locator('.deaths__list')).toBeVisible({ timeout: 15_000 });

            // 5. Znajdź ITEM zawierający victim-name z naszym nickiem.
            //    Wzorzec same jak w 5.10 (feed-shows-seeded-death.spec.ts).
            const ourFleeRow = page.locator('.deaths__item', {
                has: page.locator('.deaths__victim-name', { hasText: nick }),
            });
            await expect(ourFleeRow).toBeVisible({ timeout: 10_000 });

            // 6. Sanity asercje — verify że to FLED variant, nie killed:
            //    a) `.deaths__item--fled` modifier na li (linia 366
            //       `deaths__item--${result}`).
            await expect(ourFleeRow).toHaveClass(/deaths__item--fled/);
            //    b) `.deaths__verb--fled` na verb span (linia 416).
            await expect(ourFleeRow.locator('.deaths__verb--fled')).toBeVisible();
            //    c) verb text "przegnał" (NIE "zabił"). Linia 421:
            //       `{isFled ? 'przegnał' : 'zabił'}`.
            await expect(ourFleeRow.locator('.deaths__verb-text')).toContainText('przegnał');
            //    d) `.deaths__verb--killed` NIE jest obecny.
            await expect(ourFleeRow.locator('.deaths__verb--killed')).toHaveCount(0);
            //    e) Source name "Krypta Cesarza" + level "Lvl 1".
            await expect(ourFleeRow.locator('.deaths__monster-name')).toContainText('Krypta Cesarza');
            await expect(ourFleeRow.locator('.deaths__monster-lvl')).toContainText('Lvl 1');
            //    f) Victim level "Lvl 5".
            await expect(ourFleeRow.locator('.deaths__victim-lvl')).toContainText('Lvl 5');
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
