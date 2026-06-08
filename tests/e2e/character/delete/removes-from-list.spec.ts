/**
 * Atomic E2E — kasowanie postaci usuwa ją z listy `/character-select`.
 *
 * Spec (`testyE2E.docx` punkt 4): "Sprawdz czy da sie skasowac postać"
 *
 * Flow:
 *  1. Seed postać przez API z unikalnym nickiem
 *  2. Login + nav do /character-select
 *  3. Znajdź kartę po nicku
 *  4. Tap trash icon 🗑️ → pokazuje się prompt "Na pewno?"
 *  5. Tap "Usuń" → kasuje postać przez DELETE /rest/v1/characters
 *  6. Wait + assert że karta zniknęła z listy
 *
 * Cleanup w finally — defensywnie na wypadek crashu PRZED kliknięciem
 * "Usuń". Jak test poszedł happy path, cleanup nic nie znajdzie
 * (idempotent — zwraca `{ deleted: false, reason: 'no characters' }`).
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';

test.describe('Character › Delete', { tag: '@character' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('tapping trash + confirming "Usuń" removes character card from /character-select', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            // 1. Seed postać
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Archer',
            });
            createdId = created.id;

            // 2. Login + nav
            await loginViaUI(page, testUsers.primary);
            await page.goto('/character-select');

            // 3. Znajdź NASZĄ kartę
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 10_000 });

            // 4. Tap trash icon → prompt się rozwija (`.char-select__confirm-wrap`)
            await card.locator('.char-select__delete-btn').tap();
            await expect(card.locator('.char-select__confirm-wrap')).toBeVisible();

            // 5. Tap "Usuń" w confirmation
            await card.locator('.char-select__delete-confirm-btn').tap();

            // 6. Karta znika — czekamy aż locator dosięga 0 elementów
            await expect(card).toHaveCount(0, { timeout: 10_000 });
            // Sanity: name też zniknął z DOM-u całej listy
            await expect(page.locator('.char-select__card-name', { hasText: nick })).toHaveCount(0);
        } finally {
            // Per-character cleanup po ID — idempotent. Jeśli test happy-path
            // już skasował przez UI, ten call zwraca 'not found' bez błędu.
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
