/**
 * Atomic E2E — Deaths feed (`/deaths`) shows a directly-seeded death row.
 *
 * Spec (BACKLOG.md punkt 5.10): "Śmierci: zgin w każdej walce + verify
 * w deaths feed" — wariant atomic. Pełna `E×8` (zgin w każdym typie
 * walki) wymagałaby realnie zabijania postaci przez 8 różnych combat
 * flow-ów (monster / dungeon / boss / transform / raid / arena / loch /
 * trainer), co jest masywne + flaky. Atomic wariant testuje TYLKO że:
 *
 *  - `character_deaths` row wstawiony bezpośrednio przez service_role
 *    pojawia się w globalnym feed-zie po nawigacji na `/deaths`.
 *
 * Reszta źródeł śmierci (E×8) → zostaje do osobnej sesji która zaimplementuje
 * dla każdego combat type-u (combat/death/*.spec.ts).
 *
 * Co testujemy:
 *  - Seed postać Knight przez API + insert 1 row do `character_deaths`
 *    z unique source_name (matching test character) — żeby selektor był
 *    deterministyczny w gloałnym feed-zie z setkami innych deaths.
 *  - Login + nawigacja na `/deaths` → lista się ładuje.
 *  - Filtr "Wszystkie" jest aktywny domyślnie (counter > 0).
 *  - Item z naszym character_name jest widoczny w `.deaths__list` →
 *    znajdujemy `.deaths__victim-name` zawierający nasz nick.
 *  - Zawiera "💀 zabił" verb (result='killed') + naszą klasę + level.
 *
 * Deterministycznie znajdujemy nasz death-row przez unique character_name
 * (E2E{rand6} format z `generateTestCharacterName()`) — nawet jeśli
 * feed ma 1000 innych wpisów, regex `^E2E[A-Z0-9]{6}$` matchuje wyłącznie
 * świeży seed.
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

test.describe('City › Deaths', { tag: '@city' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('seeded death row appears in /deaths feed', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            // 1. Seed Knight lvl 7 — nick jest unique (E2E{rand6}) więc
            //    łatwo go znaleźć w gloałnym feed-zie. Level/klasa snapshot-owane
            //    w `character_deaths` payload — nie joinowane liveowo
            //    z `characters` table, więc po pełnym cleanup-ie postać znika
            //    z feed-u dopiero jak skasujemy też ten row (cascade via FK).
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: { level: 7, highest_level: 7 },
            });
            createdId = created.id;

            // 2. Insert death row bezpośrednio. source='monster', source_name='Szczur'
            //    żeby pattern matchował realny in-game death.
            //    NIE wpisujemy `result` — DB schema na tym env-zie nie ma
            //    jeszcze tej kolumny (deaths_migration.sql nie odpalony).
            //    `inferResult` w Deaths.tsx (linia 73) wraca 'killed' gdy
            //    column undefined + source_name nie kończy się "(uciekłeś
            //    z gry)" → verb = "zabił" wyrenderowany bez problemu.
            await seedDeath({
                characterId: created.id,
                characterName: nick,
                characterClass: 'Knight',
                characterLevel: 7,
                source: 'monster',
                sourceName: 'Szczur',
                sourceLevel: 1,
            });

            // 3. Login + nawigacja DIRECTLY na `/deaths`. Nie wybieramy postaci
            //    bo `/deaths` to globalna lista — działa bez aktywnej postaci
            //    (Deaths.tsx nie korzysta z characterStore, tylko z deathsApi).
            await loginViaUI(page, testUsers.primary);
            await page.goto('/deaths');

            // 4. Spinner znika → feed widoczny. `.deaths__list` jest <ul>
            //    z `.deaths__item` per row. Czekamy na pierwszy item (jakikolwiek).
            //    Pamiętaj: globalny feed = inne postacie też tam są.
            //    NIE asertujemy że list.first to nasz row — szukamy po nicku.
            await expect(page.locator('.deaths__list')).toBeVisible({ timeout: 15_000 });

            // 5. Znajdź ITEM (deaths__item) zawierający victim-name z naszym nickiem.
            //    `.deaths__victim-name` jest jednoznacznym selektorem dla nicku —
            //    `:has()` matchuje tylko ten li które ma nasz nick wśród victim-names.
            const ourDeathRow = page.locator('.deaths__item', {
                has: page.locator('.deaths__victim-name', { hasText: nick }),
            });
            await expect(ourDeathRow).toBeVisible({ timeout: 10_000 });

            // 6. Sanity asercje na content row-a — wszystko snapshot-owane
            //    w `character_deaths` payload przy insercie.
            //    a) Source name "Szczur" + level (Lvl 1)
            await expect(ourDeathRow.locator('.deaths__monster-name')).toContainText('Szczur');
            await expect(ourDeathRow.locator('.deaths__monster-lvl')).toContainText('Lvl 1');
            //    b) Victim level "Lvl 7" (charcter_level w payload)
            await expect(ourDeathRow.locator('.deaths__victim-lvl')).toContainText('Lvl 7');
            //    c) Verb "zabił" (result='killed' → deaths__verb--killed)
            await expect(ourDeathRow.locator('.deaths__verb--killed')).toBeVisible();
            await expect(ourDeathRow.locator('.deaths__verb-text')).toContainText('zabił');
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
