/**
 * Atomic E2E — `/leaderboard` "Sprzedaż" tab pokazuje naszą seedowaną
 * postać z high `market_items_sold` + `market_gold_earned`.
 *
 * Spec (BACKLOG 5.11): "Rankingi: każda kategoria". Rozszerzenie pokrycia
 * — Market Items Sold tab.
 *
 * Tab definition (Leaderboard.tsx linia 166):
 *   { key: 'market_items_sold', label: 'Sprzedaż', icon: '💰',
 *     source: 'characters', characterColumn: 'market_items_sold',
 *     order: 'desc', valueLabel: 'Sprzedane' }
 *
 * **Custom fetch branch** (Leaderboard.tsx linia 211-243): "Sprzedaż"
 * + "Zakupy" mają osobną ścieżkę bo sortują PRIMARY po
 * `market_gold_earned` (BIGINT, "kto NAJWIĘCEJ zarobił"), nie po
 * count. Po sort GOLD DESC → COUNT DESC → LEVEL DESC → CREATED_AT ASC.
 *
 * Display via `formatGoldShort` (`src/systems/goldFormat.ts`):
 *   `{count.toLocaleString('pl-PL')} · {formatGoldShort(gold)}`
 *   np. `999 · 999gp` (jeśli gold < 1k) lub `999 · 9.99M gp` etc.
 *
 * Seed: market_items_sold=999 (count) + market_gold_earned=99999999
 * (~100M = formatted ze suffixem M/k). Wysokie obie wartości żeby
 * GWARANTOWANIE wpaść w top spot po obu kryteriach sortu.
 *
 * **Sync-hook SAFE**: hook NIE dotyka tych column-ów.
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

    test('Sprzedaż tab shows seeded character with market_items_sold=999 + market_gold_earned=99999999', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            const created = await createCharacterViaApi({
                userEmail: testUsers.secondary.email,
                name: nick,
                class: 'Knight',
                overrides: {
                    level: 1,
                    highest_level: 1,
                    market_items_sold: 999,
                    market_gold_earned: 99999999,
                    hp_regen: 0,
                    mp_regen: 0,
                },
            });
            createdId = created.id;

            await loginViaUI(page, testUsers.secondary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 10_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });

            await page.goto('/leaderboard');
            await waitForAppReady(page);

            // valueOverride: `{count.toLocaleString('pl-PL')} · {formatGoldShort(gold)}`.
            // 999 toLocaleString w pl-PL = "999"; gold 99999999 przez
            // formatGoldShort → suffixed (gp/k/M itp.). Combined regex matches
            // the 999 count token AND the " · " separator. The re-fetch poll
            // helper absorbs full-suite DB contention (REST cache / eventual
            // consistency stale first read), replacing the manual re-tap block.
            await assertSeededRankingRow(page, {
                tabLabel: /^Sprzedaż$/,
                nick,
                value: /999[\s\S]*·/,
            });
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
