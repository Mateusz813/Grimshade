/**
 * Atomic E2E — `/leaderboard` "Zakupy" tab pokazuje naszą seedowaną
 * postać z high `market_items_bought` + `market_gold_spent`.
 *
 * Spec (BACKLOG 5.11): "Rankingi: każda kategoria". Rozszerzenie pokrycia
 * — Market Items Bought tab.
 *
 * Tab definition (Leaderboard.tsx linia 167):
 *   { key: 'market_items_bought', label: 'Zakupy', icon: 'shopping-cart',
 *     source: 'characters', characterColumn: 'market_items_bought',
 *     order: 'desc', valueLabel: 'Kupione' }
 *
 * Custom fetch branch as `market_items_sold` (Leaderboard.tsx linia
 * 211-243). Sort PRIMARY po `market_gold_spent DESC`. valueOverride:
 * `{count.toLocaleString('pl-PL')} · {formatGoldShort(gold)}`.
 *
 * **Sync-hook SAFE**: hook NIE dotyka tych kolumn.
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

    test('Zakupy tab shows seeded character with market_items_bought=999 + market_gold_spent=99999999', async ({ page }) => {
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
                    market_items_bought: 999,
                    market_gold_spent: 99999999,
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

            // valueOverride: `{count.toLocaleString('pl-PL')} · {formatGoldShort(gold)}`
            // -> "999 · …". Combined regex matches the 999 count token AND the
            // " · " separator. The re-fetch poll helper absorbs full-suite DB
            // contention (REST cache / eventual consistency stale first read),
            // replacing the old manual single re-tap block.
            await assertSeededRankingRow(page, {
                tabLabel: /^Zakupy$/,
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
