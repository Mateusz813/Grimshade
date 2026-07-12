
import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { waitForAppReady } from '../../fixtures/appReady';
import { seedGameSave, type ISeedBagItem } from '../../fixtures/seedGameSave';
import { findUserIdByEmail } from '../../fixtures/adminClient';

test.describe('City › Deposit', { tag: '@city' }, () => {
    test.describe.configure({ timeout: 90_000 });
    test.describe.configure({ retries: 8 });

    test('put item -> moves to deposit panel; take item -> moves back to bag; counters tick in lockstep', async ({ page }) => {
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

            const userId = await findUserIdByEmail(testUsers.primary.email);
            if (!userId) throw new Error('User lookup failed for primary');
            const bagItems: ISeedBagItem[] = [];
            for (let i = 0; i < 3; i++) {
                bagItems.push({
                    uuid: `e2e-helm-${i}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                    itemId: 'iron_helmet',
                    rarity: 'common',
                    bonuses: {},
                    itemLevel: 1,
                });
            }
            await seedGameSave({
                characterId: created.id,
                userId,
                bagItems,
                depositItems: [],
            });

            await loginViaUI(page, testUsers.primary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 10_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });

            await page.goto('/deposit');
            await waitForAppReady(page);
            await expect(page.locator('.top-header')).toBeVisible({ timeout: 15_000 });
            await expect(page.locator('.deposit__title')).toContainText('Depozyt', { timeout: 10_000 });

            const panels = page.locator('.deposit__panel');
            await expect(panels).toHaveCount(2, { timeout: 5_000 });
            const bagPanel = panels.nth(0);
            const depositPanel = panels.nth(1);

            await expect(bagPanel.locator('.deposit__panel-count')).toContainText('3 / 1000', { timeout: 10_000 });
            await expect(depositPanel.locator('.deposit__panel-count')).toContainText('0 / 10000');

            const bagTiles = bagPanel.locator('.deposit__tile');
            const depositTiles = depositPanel.locator('.deposit__tile');
            await expect(bagTiles).toHaveCount(3, { timeout: 5_000 });
            await expect(depositTiles).toHaveCount(0, { timeout: 5_000 });

            await expect(depositPanel.locator('.deposit__empty')).toBeVisible();

            await expect.poll(async () => {
                return await page.evaluate(async () => {
                    const mod = await import('/src/stores/inventoryStore.ts');
                    const s = (mod as {
                        useInventoryStore: { getState: () => { bag: Array<unknown>; deposit: Array<unknown> } };
                    }).useInventoryStore.getState();
                    return `bag=${s.bag.length},deposit=${s.deposit.length}`;
                });
            }, { timeout: 10_000, intervals: [500, 500, 500] }).toBe('bag=3,deposit=0');

            await bagTiles.first().tap({ force: true });

            await expect(bagPanel.locator('.deposit__panel-count')).toContainText('2 / 1000', { timeout: 5_000 });
            await expect(depositPanel.locator('.deposit__panel-count')).toContainText('1 / 10000', { timeout: 5_000 });
            await expect(bagTiles).toHaveCount(2, { timeout: 5_000 });
            await expect(depositTiles).toHaveCount(1, { timeout: 5_000 });
            await expect(depositPanel.locator('.deposit__empty')).toHaveCount(0);

            await expect(depositTiles.first().locator('.deposit__tile-name'))
                .toContainText('Żelazny Hełm', { timeout: 3_000 });

            await depositTiles.first().tap({ force: true });

            await expect(bagPanel.locator('.deposit__panel-count')).toContainText('3 / 1000', { timeout: 5_000 });
            await expect(depositPanel.locator('.deposit__panel-count')).toContainText('0 / 10000', { timeout: 5_000 });
            await expect(bagTiles).toHaveCount(3, { timeout: 5_000 });
            await expect(depositTiles).toHaveCount(0, { timeout: 5_000 });
            await expect(depositPanel.locator('.deposit__empty')).toBeVisible();
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
