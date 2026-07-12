
import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { seedEquippedItem } from '../../fixtures/seedInventory';

test.describe('Inventory › Equip', { tag: '@inventory' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('paperdoll shows --filled state for slot that has an equipped item', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: { level: 5, highest_level: 5, hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            await seedEquippedItem({
                characterId: created.id,
                slot: 'helmet',
                itemId: 'iron_helmet',
                rarity: 'common',
                itemLevel: 5,
            });

            await loginViaUI(page, testUsers.primary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 10_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });

            await page.goto('/inventory');

            await expect(page.locator('.inventory__paperdoll')).toBeVisible({ timeout: 10_000 });
            await expect(page.locator('.inventory__doll-slot')).toHaveCount(12);

            const helmetSlot = page.locator('.inventory__doll-slot--helmet');
            await expect(helmetSlot).toHaveClass(/inventory__doll-slot--filled/);
            await expect(helmetSlot).not.toHaveClass(/inventory__doll-slot--empty/);

            const mainHandSlot = page.locator('.inventory__doll-slot--mainHand');
            await expect(mainHandSlot).toHaveClass(/inventory__doll-slot--empty/);
            await expect(mainHandSlot).not.toHaveClass(/inventory__doll-slot--filled/);
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
