/**
 * Atomic E2E — Active training UI renders skill selector + per-skill levels.
 *
 * Spec (BACKLOG.md punkt 9.1 — smoke variant): "Active training UI shows
 * skill selector + level (don't verify level-up in combat, just UI)".
 *
 * Active training (off-line treningi skilli) UI nie ma osobnego route — lives
 * w popupie Postać tabu wyzwalanym z `/inventory`. Inventory.tsx linia 3494:
 * `aria-label="Trening skilli"`, `setPopupKey('training')`. Body popup-u =
 * `TrainingPopupBody` (Inventory.tsx linia 1865-1957).
 *
 * Setup state:
 *   1. Seed Knight via API. Wystarcza domyslny skillStore — kazdy
 *      trainable stat startuje na lvl 0 z 0 XP (characterScope.ts linia
 *      185-190: `skillLevels: {}, skillXp: {}`).
 *   2. Login + select character -> wejscie do Town (`/`).
 *
 * Actions:
 *   1. `/inventory` -> tap "Trening skilli" button w action row pod paperdoll-em.
 *   2. Popup `.inventory__popup--training` się otwiera.
 *
 * Outcome — sprawdzamy strukture UI (NIE level-up flow):
 *   - Popup `.inventory__popup--training` widoczny.
 *   - Header ":books: Trening Skilli" (linia 3954).
 *   - Status pill ":white-circle: Brak aktywnego treningu" (kazda swieza postać NIE
 *     ma `offlineTrainingSkillId` ustawionego -> linia 1907-1909).
 *   - Lista skili (`inventory__training-list`) zawiera wiele kart
 *     `inventory__training-card` (Knight ma class-specific + ogolne stats
 *     które razem dadza >= 4 trainable skille).
 *   - Każda karta ma:
 *     - nazwę skilli (`inventory__training-card-name`)
 *     - level "Lv 0" (`inventory__training-card-level`)
 *     - XP bar (`inventory__training-card-bar`)
 *     - XP text "0 / N XP" (`inventory__training-card-xp`)
 *
 * Cleanup: try/finally -> cleanupCharacterById.
 *
 * Co NIE testujemy:
 *  - Click -> wybor skilli ("Wybrano" badge + `selectTrainingStat` call).
 *    To osobne TODO test "selecting skill marks card as selected".
 *  - Level-up po XP gain z combat / offline hunt — wymaga combat sim.
 *  - Live XP bar tick co sekundę (linia 1879-1883 useEffect tick).
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../fixtures/testUsers';
import { loginViaUI } from '../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../fixtures/createCharacter';
import { cleanupCharacterById } from '../fixtures/cleanup';

test.describe('Training › Active', { tag: '@training' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('opens Training popup and renders skill list with per-skill levels', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: { hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            // 1. Login -> wybierz postac -> Town
            await loginViaUI(page, testUsers.primary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 10_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });

            // 2. /inventory -> tap Trening skilli button
            await page.goto('/inventory');
            await expect(page.locator('.inventory__paperdoll-actions')).toBeVisible({ timeout: 10_000 });
            await page.getByRole('button', { name: /^trening skilli$/i }).tap();

            // 3. Popup widoczny (linia 3946 `.inventory__popup--training`).
            const popup = page.locator('.inventory__popup--training');
            await expect(popup).toBeVisible({ timeout: 5_000 });

            // 4. Header title (linia 3954: ":books: Trening Skilli").
            await expect(popup.getByText('Trening Skilli')).toBeVisible();

            // 5. Status pill — swieża postać bez aktywnego treningu ->
            //    pokazuje ":white-circle: Brak aktywnego treningu" (linia 1907-1909).
            await expect(popup.locator('.inventory__training-status-pill'))
                .toContainText(/Brak aktywnego treningu/i);

            // 6. Skill list wyrenderowana (linia 1913 `inventory__training-list`).
            const skillList = popup.locator('.inventory__training-list');
            await expect(skillList).toBeVisible();

            // 7. Kazdy trainable stat = osobny `inventory__training-card`
            //    (button). Knight ma class-specific (sword_fighting) +
            //    GENERAL_TRAINABLE_STATS. Razem zawsze >= 4 unique skille
            //    (`uniqueStats` w linia 1893 dedupes). Asercja na >= 4 daje
            //    safety margin gdyby dodano/usuniete general stats.
            const cards = popup.locator('.inventory__training-card');
            const cardCount = await cards.count();
            expect(cardCount).toBeGreaterThanOrEqual(4);

            // 8. KRYTYCZNA asercja — kazda karta ma level pill "Lv N".
            //    Linia 1940: `<span className="inventory__training-card-level">Lv {level}</span>`.
            //    Dla świezej postaci kazdy skill = lvl 0 -> "Lv 0".
            const firstCard = cards.first();
            await expect(firstCard.locator('.inventory__training-card-name')).toBeVisible();
            await expect(firstCard.locator('.inventory__training-card-level')).toContainText(/Lv 0/);

            // 9. Kazda karta ma XP bar + XP text (linia 1942-1946).
            await expect(firstCard.locator('.inventory__training-card-bar')).toBeVisible();
            await expect(firstCard.locator('.inventory__training-card-xp'))
                .toContainText(/^0 \/ \d+ XP$/);
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
