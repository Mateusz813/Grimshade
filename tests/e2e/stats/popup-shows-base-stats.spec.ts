/**
 * Atomic E2E — Stats popup (Postać › :bar-chart: Statystyki) renders base stats.
 *
 * Setup state:
 *   1. Seed Knight character via API z deterministycznymi base stats
 *      (`CLASS_BASE_STATS.Knight`: attack=10, defense=5, max_hp=120,
 *      max_mp=30, attack_speed=1.5, crit_chance=0.03, crit_damage=2.0).
 *   2. Login + select character -> wejście do Town (`/`).
 *
 * One action:   navigate to `/inventory` -> tap "Statystyki" w action row
 *               pod paperdoll (`aria-label="Statystyki"`, `setPopupKey('stats')`).
 * One outcome:  Stats popup się otwiera (`.inventory__popup--stats`)
 *               i zawiera section ":crossed-swords: Statystyki Walki" z StatBox-ami:
 *               - Atak — pokazuje 10 (base Knight)
 *               - Obrona — pokazuje 5 (base Knight)
 *               - Max HP — pokazuje 120 (base Knight)
 *               - Max MP — pokazuje 30 (base Knight)
 *
 * Cleanup:      try/finally -> `cleanupCharacterById(createdId)`.
 *
 * Co testujemy:
 *  - Stats popup w ogóle się otwiera po tap-nięciu ikonki Statystyki
 *  - Renderuje sekcję "Statystyki Walki" (znaczy że StatsPopupBody się
 *    zamontował i przeszedł early `if (!character) return null`)
 *  - Wartości bazowe (Atak, Obrona, Max HP, Max MP) są widoczne dla
 *    świeżej postaci bez EQ / treningu / transformów (eqStats=0,
 *    tBonuses=0, tBreakdown.active=false) -> effective = base.
 *
 * Nie sprawdzamy szczegółowo breakdown lines bo dla świeżej postaci
 * (no eq, no training, no transform) breakdown jest tylko `{ label: 'Baza' }`
 * — separate test później może covered pełne aggregację (8.1 z BACKLOG).
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../fixtures/testUsers';
import { loginViaUI } from '../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../fixtures/createCharacter';
import { cleanupCharacterById } from '../fixtures/cleanup';

test.describe('Stats › Popup', { tag: '@stats' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('opens Stats popup from Postać view and renders base combat stats', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            // 1. Seed Knight — known base stats (CLASS_BASE_STATS w createCharacter.ts):
            //    attack=10, defense=5, max_hp=120, max_mp=30.
            //    hp_regen=0 + mp_regen=0 żeby UI nie ruszało wartości w trakcie testu.
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: { hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            // 2. Login + wejście do Town przez postać
            await loginViaUI(page, testUsers.primary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 10_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });

            // 3. Postać tab -> /inventory. Inventory.tsx hostuje paperdoll +
            //    4-icon action row (Skille / Potion / Trening / Statystyki).
            await page.goto('/inventory');
            await expect(page.locator('.inventory__paperdoll-actions')).toBeVisible({ timeout: 10_000 });

            // 4. Tap "Statystyki" — aria-label = "Statystyki" (Inventory.tsx linia 3505).
            await page.getByRole('button', { name: /^statystyki$/i }).tap();

            // 5. Stats popup się otwiera — `.inventory__popup--stats`.
            const statsPopup = page.locator('.inventory__popup--stats');
            await expect(statsPopup).toBeVisible({ timeout: 5_000 });

            // 6. Section title ":crossed-swords: Statystyki Walki" musi być w popup-ie
            //    (potwierdza że StatsPopupBody się zmontował i przeszedł
            //    `if (!character) return null` guard).
            await expect(statsPopup.getByText('Statystyki Walki')).toBeVisible();

            // 7. Każdy StatBox renderuje `.inventory__stats-box-label` +
            //    `.inventory__stats-box-value`. Asercja na konkretne wartości
            //    Knight bazowych statów (no eq, no training, no transform).
            //    Selektor: stats-box wewnątrz popup-u który MA label "Atak" etc.
            const atakBox = statsPopup.locator('.inventory__stats-box', {
                has: page.locator('.inventory__stats-box-label', { hasText: /^Atak$/ }),
            });
            await expect(atakBox.locator('.inventory__stats-box-value')).toHaveText('10');

            const obronaBox = statsPopup.locator('.inventory__stats-box', {
                has: page.locator('.inventory__stats-box-label', { hasText: /^Obrona$/ }),
            });
            await expect(obronaBox.locator('.inventory__stats-box-value')).toHaveText('5');

            const hpBox = statsPopup.locator('.inventory__stats-box', {
                has: page.locator('.inventory__stats-box-label', { hasText: /^Max HP$/ }),
            });
            await expect(hpBox.locator('.inventory__stats-box-value')).toHaveText('120');

            const mpBox = statsPopup.locator('.inventory__stats-box', {
                has: page.locator('.inventory__stats-box-label', { hasText: /^Max MP$/ }),
            });
            await expect(mpBox.locator('.inventory__stats-box-value')).toHaveText('30');
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
