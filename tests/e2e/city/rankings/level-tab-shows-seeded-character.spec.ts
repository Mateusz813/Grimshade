/**
 * Atomic E2E — `/leaderboard` LVL tab pokazuje naszą seedowaną postać.
 *
 * Spec (BACKLOG 5.11): "Rankingi: każda kategoria (test akcja → ranking
 * się aktualizuje → cleanup postaci → ranking się czyści)". Pełny
 * E×N wariant (każda z 30+ kategorii: MLVL / Sword / Dagger / HP /
 * Crit / Arena / Gildie / Śmierci / Mastery / Daily / etc.) zostawiony
 * do kolejnej sesji. Ten test pokrywa SAM flow:
 *   1. Seed postaci z konkretną wartością rankingową.
 *   2. Open /leaderboard.
 *   3. Default tab to "LVL" — sprawdzamy że postać jest na liście.
 *
 * **Defensive seeding**: production / local DB ma realnych graczy,
 * leaderboard top-100. Żeby NASZA postać GWARANTOWANIE wpadła w top-100
 * LVL, seedujemy `level=500` — wystarczy nadlecieć każdego realnego
 * gracza w tej fazie projektu. Po teście cleanup usuwa postać →
 * leaderboard wraca do stanu pre-test (Leaderboard.tsx czyta z
 * `characters` table direct, delete = entry znika).
 *
 * Selektory:
 *  - `.leaderboard__list` — container z entries (Leaderboard.tsx linia 443).
 *  - `.leaderboard__row` — pojedynczy wiersz rankingu.
 *  - `.leaderboard__name` — text widget z nazwą postaci (linia 485).
 *
 * Domyślny tab po wejściu na /leaderboard to 'level' (linia 191:
 * `useState<LeaderboardTab>('level')`). Sort: `level.desc`, limit 100.
 *
 * Cleanup: try/finally + cleanupCharacterById — `Leaderboard.tsx`
 * czyta z `characters` table direct (komentarz w `tests/e2e/README.md`
 * sekcja "Rankingi"), więc delete postaci usuwa ją z rankingu automatycznie.
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

    test('LVL tab shows seeded character with level=500 in entries list', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            // 1. Seed Knight z bardzo wysokim levelem (500) żeby GWARANTOWANIE
            //    wpaść w top-100 rankingu LVL niezależnie od stanu prod DB.
            //    `highest_level` też 500 — gdyby ranking nagle przeskoczył na
            //    `highest_level` w przyszłości, nie potrzebowalibyśmy 2-go testu.
            //    Zero regen + gold 999999 (BACKLOG sugestia, używamy też w
            //    przyszłych gold-rank testach).
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: { level: 500, highest_level: 500, gold: 999999, hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

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
            // Hydration barrier — restore() settled so the seeded level=500 is
            // in the cloud-synced state the leaderboard fetch reads.
            await waitForAppReady(page);

            // 3. LVL is the DEFAULT tab (Leaderboard.tsx useState('level')).
            //    The helper still taps it (idempotent — keeps it active) and
            //    re-fetch-polls until "Lvl 500" (valueLabel='Lvl' + value) is
            //    visible on our row, absorbing full-suite DB contention, then
            //    asserts the `--me` modifier (match by character.id, not nick).
            await assertSeededRankingRow(page, {
                tabLabel: /^LVL$/,
                nick,
                value: /500/,
            });
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
