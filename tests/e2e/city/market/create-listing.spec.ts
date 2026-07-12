
import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { seedConsumables } from '../../fixtures/seedInventory';
import { getAdminClient } from '../../fixtures/adminClient';

test.describe('City › Market', { tag: '@city' }, () => {
    test.describe.configure({ timeout: 90_000 });

    test('list 1× Mały Eliksir HP for 100g shows row in My listings + decrements consumable + writes market_listings row', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            const created = await createCharacterViaApi({
                userEmail: testUsers.secondary.email,
                name: nick,
                class: 'Knight',
                overrides: { level: 25, highest_level: 25, hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            await seedConsumables({
                characterId: created.id,
                counts: { hp_potion_sm: 5 },
            });

            await loginViaUI(page, testUsers.secondary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 10_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });

            await page.goto('/market');
            await expect(page.locator('.market')).toBeVisible({ timeout: 15_000 });

            const sellTab = page.locator('.market__tab', { hasText: /^Sprzedawaj$/i });
            await expect(sellTab).toBeVisible({ timeout: 5_000 });
            await sellTab.tap();
            await expect(sellTab).toHaveClass(/market__tab--active/);

            const sellTile = page.locator('.market__sell-tile', {
                has: page.locator('.market__sell-tile-name', { hasText: 'Mały Eliksir HP' }),
            });
            await expect(sellTile).toBeVisible({ timeout: 10_000 });

            await expect(sellTile.locator('.market__sell-tile-qty')).toContainText('×5');

            await sellTile.tap();
            const modal = page.locator('.market__modal').last();
            await expect(modal).toBeVisible({ timeout: 5_000 });

            const priceInput = modal.locator('input[type="number"]').last();
            await priceInput.fill('100');

            const submitBtn = modal.locator('.market__modal-btn--confirm');
            await expect(submitBtn).toBeEnabled({ timeout: 3_000 });
            await submitBtn.tap();

            await expect(modal).toBeHidden({ timeout: 8_000 });
            await expect(page.locator('.market__toast'))
                .toContainText(/Wystawiono.*Mały Eliksir HP.*×1/i, { timeout: 5_000 });

            const myTab = page.locator('.market__tab', { hasText: /^Moje/i });
            await expect(myTab).toHaveClass(/market__tab--active/, { timeout: 5_000 });

            const myRow = page.locator('.market__row', {
                has: page.locator('.market__row-name', { hasText: 'Mały Eliksir HP' }),
            });
            await expect(myRow).toBeVisible({ timeout: 10_000 });
            await expect(myRow.locator('.market__row-cta')).toContainText(/Edytuj/i);

            const admin = getAdminClient();
            const { data: dbRow, error: dbErr } = await admin
                .from('market_listings')
                .select('id, price, quantity, item_id, kind')
                .eq('seller_id', created.id)
                .eq('item_id', 'hp_potion_sm')
                .single();
            if (dbErr) throw new Error(`[test 5.6] market_listings select failed: ${dbErr.message}`);
            expect(dbRow.price).toBe(100);
            expect(dbRow.quantity).toBe(1);
            expect(dbRow.kind).toBe('potion');
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
