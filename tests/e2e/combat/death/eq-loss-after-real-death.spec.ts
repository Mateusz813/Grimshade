
import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { seedInventoryItem, seedInventoryResources } from '../../fixtures/seedInventory';
import { triggerPlayerDeath, getCharacterSnapshot } from '../../fixtures/combatSim';

test.describe('Combat › Death', { tag: '@combat' }, () => {
    test.describe.configure({ timeout: 120_000 });

    test('Knight lvl 50 no protection + 20 bag items dies -> exactly 1 item lost, gold unchanged, level drops', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            const created = await createCharacterViaApi({
                userEmail: testUsers.secondary.email,
                name: nick,
                class: 'Knight',
                overrides: {
                    level: 100,
                    highest_level: 100,
                    hp_regen: 0,
                    mp_regen: 0,
                },
            });
            createdId = created.id;

            const itemIds = [
                'iron_sword', 'iron_helmet', 'leather_armor',
                'iron_sword', 'iron_helmet', 'leather_armor',
                'iron_sword', 'iron_helmet', 'leather_armor',
                'iron_sword', 'iron_helmet', 'leather_armor',
                'iron_sword', 'iron_helmet', 'leather_armor',
                'iron_sword', 'iron_helmet', 'leather_armor',
                'iron_sword', 'iron_helmet',
            ];
            for (const itemId of itemIds) {
                await seedInventoryItem({
                    characterId: created.id,
                    itemId,
                    rarity: 'common',
                    itemLevel: 1,
                });
            }

            await seedInventoryResources({
                characterId: created.id,
                gold: 100,
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
            expect(before!.level).toBe(100);
            expect(before!.bagSize).toBe(20);
            expect(before!.gold).toBe(100);

            const preUuids = await page.evaluate(async () => {
                const mod = await import('/src/stores/inventoryStore.ts');
                const inv = (mod as {
                    useInventoryStore: { getState: () => {
                        bag: Array<{ uuid: string; itemId: string }>;
                    } };
                }).useInventoryStore.getState();
                return inv.bag.map((i) => i.uuid);
            });
            expect(preUuids).toHaveLength(20);

            await triggerPlayerDeath(page, 'rat');

            const after = await getCharacterSnapshot(page);
            expect(after).not.toBeNull();

            expect(after!.level).toBe(99);

            expect(after!.hp).toBe(after!.max_hp);

            expect(after!.bagSize).toBe(19);

            const postUuids = await page.evaluate(async () => {
                const mod = await import('/src/stores/inventoryStore.ts');
                const inv = (mod as {
                    useInventoryStore: { getState: () => {
                        bag: Array<{ uuid: string; itemId: string }>;
                    } };
                }).useInventoryStore.getState();
                return inv.bag.map((i) => i.uuid);
            });
            expect(postUuids).toHaveLength(19);
            const preSet = new Set(preUuids);
            for (const uuid of postUuids) {
                expect(preSet.has(uuid)).toBe(true);
            }

            expect(after!.gold).toBe(100);
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
