/**
 * Atomic E2E — `/leaderboard` "Ulepszenia" tab pokazuje naszą seedowaną
 * postać z high `item_upgrades_done`.
 *
 * Spec (BACKLOG 5.11): "Rankingi: każda kategoria". Rozszerzenie pokrycia
 * — Item Upgrades Done tab.
 *
 * Tab definition (Leaderboard.tsx linia 168):
 *   { key: 'item_upgrades_done', label: 'Ulepszenia', icon: '🔨',
 *     source: 'characters', characterColumn: 'item_upgrades_done',
 *     order: 'desc', valueLabel: 'Ulepsz' }
 *
 * Sort: `item_upgrades_done DESC, limit 100`. Format fallback formatValue
 * → `Ulepsz 999`.
 *
 * **Sync-hook SAFE**: hook NIE dotyka `item_upgrades_done` — kolumna
 * jest bumpowana wyłącznie przez `characterApi.bumpStat('item_upgrades_done')`
 * po sukcesie upgrade w `inventoryStore.enhanceItem`.
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

    test('Ulepszenia tab shows seeded character with item_upgrades_done=999', async ({ page }) => {
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
                    item_upgrades_done: 999,
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

            await assertSeededRankingRow(page, {
                tabLabel: /^Ulepszenia$/,
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
