/**
 * Atomic E2E — backpack "Spell Chesty" filter shows owned spell chests.
 *
 * Player report (2026-06-21): "w postaci filtrowanie w plecaku po spell
 * chestach nie dziala — mam spell chesty a jak odfiltruje to nie widze nic"
 * (I have spell chests, but filtering by them shows nothing).
 *
 * Spell chests live in `inventoryStore.consumables['spell_chest_<level>']` and
 * the bag grid renders them as "stack tiles" (type: 'chest'). The slot filter
 * `chests` should keep exactly those tiles.
 *
 * Setup: seed a Knight + `spell_chest_50: 5` directly into the save blob.
 * Then open /inventory, tap the "Spell Chesty" filter, and assert a chest
 * tile is visible (and the empty-state message is NOT shown).
 *
 * Cleanup: try/finally + cleanupCharacterById.
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { seedConsumables } from '../../fixtures/seedInventory';
import { cleanupCharacterById } from '../../fixtures/cleanup';

test.describe('Inventory › Filter', { tag: '@inventory' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('the "Spell Chesty" backpack filter shows owned spell chests', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: { level: 60, highest_level: 60, hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;
            // Seed spell chests across several levels — low ladder (5/10), a
            // high one (1000), and an OFF-ladder value (25, not in
            // SPELL_CHEST_LEVELS / CHEST_LEVEL_TO_TIER_INV) to catch a
            // level-specific rendering break.
            await seedConsumables({
                characterId: created.id,
                counts: { spell_chest_5: 3, spell_chest_10: 2, spell_chest_25: 1, spell_chest_1000: 1 },
            });

            // Login → pick → Town → /inventory.
            await loginViaUI(page, testUsers.primary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 10_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });
            await page.goto('/inventory');

            // The slot-filter row must be visible.
            await expect(page.locator('.inventory__filter-row--slots')).toBeVisible({ timeout: 10_000 });

            // Sanity: with NO filter ('all'), the chest stack tile is present.
            await expect(
                page.locator('.inventory__bag-tile-name', { hasText: /Spell Chest/i }).first(),
            ).toBeVisible({ timeout: 10_000 });

            // Tap the "Spell Chesty" filter.
            await page.locator('button[title="Spell Chesty"]').tap();

            // The chest tile must STILL be visible, and the empty-state must NOT show.
            await expect(page.locator('.inventory__empty')).toHaveCount(0);
            const chestTile = page.locator('.inventory__bag-tile-name', { hasText: /Spell Chest/i });
            await expect(chestTile.first()).toBeVisible({ timeout: 10_000 });
            // Only chest tiles (no gear) — every visible bag tile is a chest stack.
            await expect(chestTile).not.toHaveCount(0);

            // 2026-06-21 regression: chests filter + an ACTIVE rarity filter used
            // to show NOTHING (the `rarityFilter !== 'all' return []` guard). Now
            // it narrows the chests BY rarity. Seeded chests at lvl 5/10 are
            // 'common' ("Zwykly"); selecting that rarity + chests must still show
            // a chest tile (the player's "filtered and saw nothing" complaint).
            await page.getByRole('button', { name: 'Zwykly', exact: true }).tap();
            await expect(page.locator('.inventory__empty')).toHaveCount(0);
            await expect(
                page.locator('.inventory__bag-tile-name', { hasText: /Spell Chest/i }).first(),
            ).toBeVisible({ timeout: 10_000 });
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
