
import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { seedConsumables, seedInventoryItem } from '../../fixtures/seedInventory';
import { triggerPlayerDeath, getCharacterSnapshot } from '../../fixtures/combatSim';

test.describe('Combat › Death', { tag: '@combat' }, () => {
    test.describe.configure({ timeout: 90_000 });

    test('Knight lvl 50 with 3× AOL + 3 bag items dies -> items preserved, AOL count 3 -> 2, level NOT lost (AOL shields everything)', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            const created = await createCharacterViaApi({
                userEmail: testUsers.secondary.email,
                name: nick,
                class: 'Knight',
                overrides: {
                    level: 50,
                    highest_level: 50,
                    hp_regen: 0,
                    mp_regen: 0,
                },
            });
            createdId = created.id;

            await seedInventoryItem({
                characterId: created.id,
                itemId: 'iron_sword',
                rarity: 'common',
                itemLevel: 1,
            });
            await seedInventoryItem({
                characterId: created.id,
                itemId: 'iron_helmet',
                rarity: 'common',
                itemLevel: 1,
            });
            await seedInventoryItem({
                characterId: created.id,
                itemId: 'leather_armor',
                rarity: 'common',
                itemLevel: 1,
            });

            await seedConsumables({
                characterId: created.id,
                counts: { amulet_of_loss: 3 },
            });

            await loginViaUI(page, testUsers.secondary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 10_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
            await expect(page.locator('.town__char-name')).toHaveText(nick, { timeout: 10_000 });

            const before = await getCharacterSnapshot(page);
            expect(before).not.toBeNull();
            expect(before!.level).toBe(50);
            expect(before!.bagSize).toBe(3);

            const preState = await page.evaluate(async () => {
                const mod = await import('/src/stores/inventoryStore.ts');
                const inv = (mod as {
                    useInventoryStore: { getState: () => {
                        bag: Array<{ uuid: string; itemId: string }>;
                        consumables: Record<string, number>;
                    } };
                }).useInventoryStore.getState();
                return {
                    aolCount: inv.consumables['amulet_of_loss'] ?? 0,
                    bagUuids: inv.bag.map((i) => i.uuid),
                    bagItemIds: inv.bag.map((i) => i.itemId),
                };
            });
            expect(preState.aolCount).toBe(3);
            expect(preState.bagUuids).toHaveLength(3);
            expect(preState.bagItemIds.sort()).toEqual(['iron_helmet', 'iron_sword', 'leather_armor']);

            await triggerPlayerDeath(page, 'rat');

            const after = await getCharacterSnapshot(page);
            expect(after).not.toBeNull();
            expect(after!.level).toBe(50);
            expect(after!.hp).toBe(after!.max_hp);

            const postState = await page.evaluate(async () => {
                const mod = await import('/src/stores/inventoryStore.ts');
                const inv = (mod as {
                    useInventoryStore: { getState: () => {
                        bag: Array<{ uuid: string; itemId: string }>;
                        consumables: Record<string, number>;
                    } };
                }).useInventoryStore.getState();
                return {
                    aolCount: inv.consumables['amulet_of_loss'] ?? 0,
                    bagUuids: inv.bag.map((i) => i.uuid),
                    bagItemIds: inv.bag.map((i) => i.itemId),
                };
            });
            expect(postState.bagUuids).toHaveLength(3);
            expect(postState.bagUuids.sort()).toEqual(preState.bagUuids.sort());
            expect(postState.bagItemIds.sort()).toEqual(
                ['iron_helmet', 'iron_sword', 'leather_armor'],
            );

            expect(postState.aolCount).toBe(2);
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
