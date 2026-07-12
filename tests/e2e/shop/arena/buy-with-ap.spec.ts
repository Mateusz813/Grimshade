
import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { seedGameSave, findUserIdByEmail } from '../../fixtures/seedGameSave';
import { cleanupCharacterById } from '../../fixtures/cleanup';

test.describe('Shop › Arena', { tag: '@shop' }, () => {
    test.describe.configure({ timeout: 90_000 });

    test('buying common arena stone (50 AP) shows toast, decreases AP, and adds stone to bag', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        const STARTING_AP = 10_000;

        try {
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: { gold: 0, hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            const userId = await findUserIdByEmail(testUsers.primary.email);
            await seedGameSave({
                characterId: created.id,
                userId,
                gold: 0,
            });

            await loginViaUI(page, testUsers.primary);
            if (!page.url().endsWith('/character-select')) {
                await page.goto('/character-select');
            }
            await expect(page.locator('.char-select__card-name', { hasText: nick })).toBeVisible({ timeout: 10_000 });
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });
            await expect(page.locator('.town__char-name')).toHaveText(nick);

            await page.evaluate(async (ap) => {
                const mod = await import('/src/stores/inventoryStore.ts');
                (mod as { useInventoryStore: { setState: (s: { arenaPoints: number }) => void } })
                    .useInventoryStore.setState({ arenaPoints: ap });
            }, STARTING_AP);

            await page.getByRole('button', { name: /^Sklep$/i }).tap();
            await expect(page).toHaveURL(/\/shop$/, { timeout: 10_000 });
            await expect(page.locator('.shop__tabs')).toBeVisible({ timeout: 10_000 });

            await page.getByRole('button', { name: 'Arena' }).tap();
            await expect(page.locator('.shop__panel--arena')).toBeVisible({ timeout: 5_000 });

            const apBanner = page.locator('.shop__arena-banner-value');
            await expect(apBanner).toContainText(/10[\s\xa0]?000/, { timeout: 5_000 });
            await expect(apBanner).toContainText(/AP/);

            const stoneCard = page.locator('.shop__card', {
                has: page.locator('.shop__card-name', { hasText: /^Kamień \(Common\)$/ }),
            }).first();
            await stoneCard.scrollIntoViewIfNeeded();
            await expect(stoneCard).toBeVisible();

            const priceText = await stoneCard.locator('.shop__card-price').textContent();
            expect(priceText).toMatch(/50\s*AP/i);

            await stoneCard.getByRole('button', { name: /^Kup$/i }).tap();

            await expect(page.locator('.shop__toast')).toContainText(/Kupiono:\s*Kamień\s*\(Common\)/i, { timeout: 5_000 });

            await expect(apBanner).toContainText(/9[\s\xa0]?950/, { timeout: 5_000 });

            await page.getByRole('button', { name: /^Postać$/i }).tap();
            await expect(page).toHaveURL(/\/inventory$/, { timeout: 10_000 });
            await expect(page.locator('.inventory')).toBeVisible({ timeout: 10_000 });

            const stoneTileName = page.locator('.inventory__bag-tile-name', { hasText: /Zwykly Kamien/i }).first();
            await expect(stoneTileName).toBeVisible({ timeout: 10_000 });
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
