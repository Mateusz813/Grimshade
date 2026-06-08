/**
 * Atomic E2E — `/leaderboard` "Crit DMG" tab pokazuje naszą seedowaną
 * postać z high `crit_damage`.
 *
 * Spec (BACKLOG 5.11): "Rankingi: każda kategoria". Rozszerzenie pokrycia
 * — Crit DMG tab (`crit_damage` column ranking).
 *
 * Tab definition (Leaderboard.tsx linia 149):
 *   { key: 'crit_damage', label: 'Crit DMG', icon: '💥',
 *     source: 'characters', characterColumn: 'crit_damage',
 *     order: 'desc', valueLabel: 'CritDmg' }
 *
 * Sort: `crit_damage DESC, limit 100`. Display: fallback formatValue
 * (linia 404) → `CritDmg <value.toLocaleString('pl-PL')>`.
 *
 * Knight base crit_damage = 2.0 (CLASS_BASE_STATS). Seed override
 * `crit_damage: 9.99` żeby GWARANTOWANIE wpaść w top-100. Knight max
 * crit_damage przez stat training jest poniżej 5.0 → 9.99 niemal pewny
 * #1.
 *
 * **WAŻNA UWAGA o asercji**: `crit_damage` jest `numeric` w DB → po
 * `Number(r[col])` = 9.99 dla seeda. `value.toLocaleString('pl-PL')` →
 * "9,99" (przecinek jako separator dziesiętny). Sprawdzamy oba warianty
 * "9.99" i "9,99" przez regex / asserting substring "9" z otoczeniem.
 * Najprościej: assert że pojawia się "CritDmg" + "9".
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

    test('Crit DMG tab shows seeded character with crit_damage=9.99', async ({ page }) => {
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
                    crit_damage: 9.99,
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

            // valueLabel='CritDmg' + value=9.99 → "CritDmg 9,99" (pl-PL) or
            // "CritDmg 9.99" (en-US). Combined regex matches the CritDmg label
            // AND the 9[.,]99 value (locale-agnostic decimal separator).
            await assertSeededRankingRow(page, {
                tabLabel: /^Crit DMG$/,
                nick,
                value: /CritDmg[\s\S]*9[.,]99/,
            });
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
