/**
 * Atomic E2E — `/leaderboard` "DPS Solo" tab pokazuje naszą seedowaną
 * postać z high `best_dps5_solo`.
 *
 * Spec (BACKLOG 5.11): "Rankingi: każda kategoria". Rozszerzenie pokrycia
 * — DPS Solo tab (5-second DPS high-water mark dla solo combat).
 *
 * Tab definition (Leaderboard.tsx linia 170):
 *   { key: 'best_dps5_solo', label: 'DPS Solo', icon: '⚡',
 *     source: 'characters', characterColumn: 'best_dps5_solo',
 *     order: 'desc', valueLabel: 'DPS' }
 *
 * **Custom branch** (Leaderboard.tsx linia 244-283): DPS Solo + DPS Party
 * mają osobną ścieżkę bo używają `formatDpsCompact` (linia 38-42):
 *   `>=1M`: `(n/1_000_000).toFixed(2) + 'M'`
 *   `>=1k`: `(n/1_000).toFixed(2) + 'K'`
 *   else: `n.toLocaleString('pl-PL')`
 *
 * Format gotcha: `99999999 / 1M = 99.999999`, toFixed(2) → "100.00".
 * Seed używa `12345678` żeby format był deterministyczny "12.35M"
 * (12345678 / 1M = 12.345678 → toFixed(2) = "12.35").
 *
 * Display: `valueOverride = `DPS ${formatDpsCompact(dps)}`` (linia 280) →
 * "DPS 12.35M".
 *
 * **Sync-hook SAFE**: hook NIE dotyka kolumny.
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

    test('DPS Solo tab shows seeded character with best_dps5_solo=12345678 (12.35M)', async ({ page }) => {
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
                    best_dps5_solo: 12345678,
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

            // formatDpsCompact(12345678) → "12.35M". valueOverride = "DPS 12.35M".
            // Combined regex matches the DPS label AND the 12.35M value.
            await assertSeededRankingRow(page, {
                tabLabel: /^DPS Solo$/,
                nick,
                value: /DPS[\s\S]*12\.35M/,
            });
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
