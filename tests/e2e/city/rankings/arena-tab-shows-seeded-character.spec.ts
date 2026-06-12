/**
 * Atomic E2E — `/leaderboard` Arena tab pokazuje naszą seedowaną postać
 * z high arena_league + arena_league_points.
 *
 * Spec (BACKLOG 5.11): "Rankingi: każda kategoria". Rozszerzenie pokrycia
 * o tab Arena (`arena_league_points` ranking, sortowany po league rank
 * następnie LP).
 *
 * Test flow (analog 5.11 LVL + Mastery):
 *   1. Seed postać z `arena_league='legend'` (najwyższa liga, index 8 w
 *      ARENA_LEAGUES) + `arena_league_points=999` — gwarantuje top spot
 *      bo żaden realny gracz nie ma jeszcze legend rangi w fazie projektu.
 *   2. Open /leaderboard (default tab to LVL).
 *   3. Tap tab "Arena" -> ranking się przewija.
 *   4. Verify nasz wiersz na liście z wartością `Legend · 999 LP`.
 *
 * **Defensive seeding**: arena_league + arena_league_points to nowo
 * dodane kolumny (leaderboard_migration.sql linia 22-23) z domyślną
 * wartością 'bronze' + 0. Legend = #1 league, 999 LP w niej = niemal
 * pewny #1 ranking spot.
 *
 * Tab definition (Leaderboard.tsx linia 155):
 *   ```
 *   { key: 'arena_league', label: 'Arena', icon: 'stadium',
 *     source: 'characters', characterColumn: 'arena_league_points',
 *     order: 'desc', valueLabel: 'LP' }
 *   ```
 *
 * Custom sort logic (linia 284-301): NIE używa generic descending sort
 * po `arena_league_points` (mimo że tabDef definiuje `order: desc`), tylko
 * dedicated branch sortujący PIERWSZY po `LEAGUE_ORDER[arena_league]`
 * (legend > grand_master > ... > bronze) potem po LP. Bez tej logiki
 * gracz z bronze 999 LP bilby gracza z legend 100 LP — co byłoby błędne.
 *
 * Display format (linia 300):
 *   `${icon} ${LABEL} · ${LP} LP`
 *   np. `:high-voltage: Legend · 999 LP`
 *
 * formatValue (linia 402) ignoruje valueLabel gdy entry ma `valueOverride`
 * — używa override directly. Więc tekst w `.leaderboard__level` to całe
 * `:high-voltage: Legend · 999 LP`, NIE `LP 999`.
 *
 * Selektory:
 *  - `.leaderboard__tab` z hasText "Arena".
 *  - `.leaderboard__list` + `.leaderboard__row`.
 *  - `.leaderboard__level` z `:high-voltage: Legend · 999 LP`.
 *
 * Cleanup: try/finally + cleanupCharacterById.
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { waitForAppReady } from '../../fixtures/appReady';
import { assertSeededRankingRow } from '../../fixtures/rankings';

test.describe('City › Rankings', { tag: '@city' }, () => {
    test.describe.configure({ timeout: 120_000 });
    // File-level retries=8 dla leaderboard arena tab batch race
    // (cloud fetch + filter on character_name custom sort branch).
    test.describe.configure({ retries: 8 });

    test('Arena tab shows seeded character with legend league + 999 LP', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            // 1. Seed Knight z legendarną ligą + 999 LP.
            //    `arena_league='legend'` to index 8 w ARENA_LEAGUES (najwyższa).
            //    LEAGUE_ORDER w Leaderboard.tsx mapuje 'legend' -> 8 (most
            //    significant sort criterion).
            //    Bez seedu LP postać miałaby DEFAULT 'bronze' + 0 LP ->
            //    znikałaby pod tysiącami innych graczy.
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: {
                    level: 1,
                    highest_level: 1,
                    arena_league: 'legend',
                    arena_league_points: 999,
                    hp_regen: 0,
                    mp_regen: 0,
                },
            });
            createdId = created.id;

            // 2. Login + select + idź do /leaderboard
            await loginViaUI(page, testUsers.primary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 10_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });

            await page.goto('/leaderboard');
            // Hydration barrier — restore() settled so the seeded character
            // row is in the cloud-synced state the leaderboard fetch reads.
            await waitForAppReady(page);

            // 3. Tap Arena tab + assert seeded row. valueOverride format:
            //    `${icon} ${LABEL} · ${LP} LP` -> `:high-voltage: Legend · 999 LP` for
            //    'legend' + 999 LP. Combined regex matches BOTH the Legend
            //    label AND the 999 LP value in one pattern. The re-fetch poll
            //    helper absorbs full-suite DB contention (stale first read)
            //    and confirms the `--me` modifier.
            await assertSeededRankingRow(page, {
                tabLabel: /^Arena$/,
                nick,
                value: /Legend[\s\S]*999 LP/,
            });
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
