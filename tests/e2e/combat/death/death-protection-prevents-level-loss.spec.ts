
import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { seedConsumables } from '../../fixtures/seedInventory';
import { triggerPlayerDeath, getCharacterSnapshot } from '../../fixtures/combatSim';

test.describe('Combat › Death', { tag: '@combat' }, () => {
    test.describe.configure({ timeout: 90_000 });

    test('Knight lvl 50 with 2× death_protection dies -> level stays 50, 1 protection consumed', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
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

            await seedConsumables({
                characterId: created.id,
                counts: { death_protection: 2 },
            });

            await loginViaUI(page, testUsers.primary);
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

            const preConsumableCount = await page.evaluate(async () => {
                const mod = await import('/src/stores/inventoryStore.ts');
                const inv = (mod as {
                    useInventoryStore: { getState: () => { consumables: Record<string, number> } };
                }).useInventoryStore.getState();
                return inv.consumables['death_protection'] ?? 0;
            });
            expect(preConsumableCount).toBe(2);

            await triggerPlayerDeath(page, 'rat');

            const after = await getCharacterSnapshot(page);
            expect(after).not.toBeNull();

            expect(after!.level).toBe(50);

            expect(after!.xp).toBe(before!.xp);

            expect(after!.hp).toBe(after!.max_hp);

            const postConsumableCount = await page.evaluate(async () => {
                const mod = await import('/src/stores/inventoryStore.ts');
                const inv = (mod as {
                    useInventoryStore: { getState: () => { consumables: Record<string, number> } };
                }).useInventoryStore.getState();
                return inv.consumables['death_protection'] ?? 0;
            });
            expect(postConsumableCount).toBe(1);
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
