/**
 * Atomic E2E — `/leaderboard` Mastery tab pokazuje naszą seedowaną postać
 * z wysokim `mastery_points`.
 *
 * Spec (BACKLOG 5.11): "Rankingi: każda kategoria (test akcja → ranking
 * się aktualizuje → cleanup postaci → ranking się czyści)". Ten test
 * rozszerza pokrycie z LVL tab (5.11a w `level-tab-shows-seeded-character.spec.ts`)
 * o jedną z 30+ kategorii — Mastery.
 *
 * Test flow (kopia 5.11a):
 *   1. Seed postać z wysokim `mastery_points` (gwarantuje top spot).
 *   2. Open /leaderboard (default tab to LVL).
 *   3. Tap tab "Mastery" → ranking się przewija.
 *   4. Verify nasz wiersz na liście z wartością `Mastery 999`.
 *
 * **Defensive seeding**: production / local DB ma realnych graczy.
 * Seedujemy `mastery_points = 999` — wyższe niż realistic max
 * (Mastery max level = 25/monster × ~50 monsters w grze = ~1250 punktów
 * teoretyczny max gdyby ktoś wszystko max-out, ale w praktyce live
 * gracze ledwo przekraczają 10-20). Nasze 999 = niemal pewny #1.
 * Cleanup usuwa postać → leaderboard wraca do stanu pre-test
 * (Leaderboard.tsx czyta z `characters` table direct).
 *
 * Tab definition (Leaderboard.tsx linia 163):
 *   ```
 *   { key: 'mastery_points', label: 'Mastery', icon: '🌟',
 *     source: 'characters', characterColumn: 'mastery_points',
 *     order: 'desc', valueLabel: 'Mastery' }
 *   ```
 *
 * formatValue (linia 402):
 *   `${activeTabDef.valueLabel} ${entry.value.toLocaleString('pl-PL')}`
 *   → 'Mastery 999'
 *
 * Selektory:
 *  - `.leaderboard__tab` — pojedynczy tab button.
 *  - hasText "Mastery" (label) lub `.leaderboard__tab-label`.
 *  - `.leaderboard__list` — container z entries.
 *  - `.leaderboard__row` — pojedynczy wiersz rankingu.
 *  - `.leaderboard__row--me` — modifier dla nas (linia 469).
 *  - `.leaderboard__level` — span z formatValue text (linia 497).
 *
 * Cleanup: try/finally + cleanupCharacterById.
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { seedGameSave, findUserIdByEmail } from '../../fixtures/seedGameSave';
import { waitForAppReady } from '../../fixtures/appReady';
import { assertSeededRankingRow } from '../../fixtures/rankings';

test.describe('City › Rankings', { tag: '@city' }, () => {
    test.describe.configure({ timeout: 120_000 });

    test('Mastery tab shows seeded character with mastery_points=999', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            // 1. Seed Knight z wysokim mastery_points (gwarantuje #1).
            //    Mastery_points jest osobną kolumną w `characters` (per
            //    leaderboard_migration.sql linia 25), seedujemy ją PRZEZ
            //    `createCharacterViaApi.overrides.mastery_points`.
            //
            //    **WAŻNE**: musimy też seedować `masteries` slice w
            //    game_saves (krok 2), bo `useLeaderboardStatSync` hook
            //    (`src/hooks/useLeaderboardStatSync.ts` linia 49-66) odpala
            //    się przy każdym character switch i SETuje `mastery_points`
            //    na sumę `masteries[*].level`. Bez seedu masteries → suma=0
            //    → mastery_points reset do 0 PRZED tym jak leaderboard
            //    odpyta DB. Z masteries=999 hook ustawi mastery_points=999
            //    (zgodnie z naszą intencją).
            //
            //    `level=1` + `highest_level=1` — bo nie chcemy konfliktu z
            //    LVL ranking (5.11a seeduje level=500). Tu testujemy
            //    Mastery ranking osobno.
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: {
                    level: 1,
                    highest_level: 1,
                    mastery_points: 999,
                    hp_regen: 0,
                    mp_regen: 0,
                },
            });
            createdId = created.id;

            // 2. Seed masteries blob — wartość matchuje mastery_points z (1).
            //    `useLeaderboardStatSync` hook (uruchamiany na character switch)
            //    sumuje `masteries[*].level` i SETuje `characters.mastery_points`
            //    na tę sumę. `999` matchuje to co już mamy w characters row,
            //    więc hook PATCH-uje row na tę samą wartość (idempotent).
            //    Bez tego seedu hook by skasował nasze 999 ustawiając 0.
            //    Synthetic monster id `_e2e_mastery_seed` żeby nie kolidować
            //    z realnym `masteries.rat` z mastery_max test (5.3).
            const userId = await findUserIdByEmail(testUsers.primary.email);
            await seedGameSave({
                characterId: created.id,
                userId,
                masteries: { _e2e_mastery_seed: { level: 999 } },
            });

            // 2. Login + select character + go to /leaderboard
            await loginViaUI(page, testUsers.primary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 10_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });

            await page.goto('/leaderboard');
            // Hydration barrier — restore() settled so the seeded mastery_points
            // is in the cloud-synced state the leaderboard fetch reads.
            await waitForAppReady(page);

            // 3. Tap Mastery tab + assert seeded row. formatValue zwraca
            //    "Mastery 999" (pl-PL toLocaleString <1000 = bez separatora).
            //    Re-fetch poll helper absorbs full-suite DB contention
            //    (stale first read) and confirms the `--me` modifier.
            await assertSeededRankingRow(page, {
                tabLabel: /^Mastery$/,
                nick,
                value: /\b999\b/,
            });
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
