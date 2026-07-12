
import { test, expect, type Locator } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { seedGameSave, findUserIdByEmail } from '../../fixtures/seedGameSave';
import { cleanupCharacterById } from '../../fixtures/cleanup';

test.describe('Shop › Potions', { tag: '@shop' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('Potiony tab gates HP potions by level — lvl 14 can only buy the 50-tier', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: { level: 14, highest_level: 14, hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;
            const userId = await findUserIdByEmail(testUsers.primary.email);
            await seedGameSave({ characterId: created.id, userId, gold: 50_000_000 });

            await loginViaUI(page, testUsers.primary);
            await page.goto('/character-select');
            await expect(page.locator('.char-select__card-name', { hasText: nick }))
                .toBeVisible({ timeout: 10_000 });
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });

            await page.goto('/shop');
            await page.locator('.shop__tab[aria-label="Potiony"]').tap();
            await expect(page.locator('.shop__card-name', { hasText: 'Mały Eliksir HP' }))
                .toBeVisible({ timeout: 10_000 });

            const cardByName = (name: string): Locator =>
                page.locator('.shop__card', {
                    has: page.locator('.shop__card-name', { hasText: new RegExp(`^${name}$`) }),
                });

            const sm = cardByName('Mały Eliksir HP');
            await expect(sm).not.toHaveClass(/shop__card--locked/);
            await expect(sm.locator('.shop__buy-btn')).toBeEnabled();
            await expect(sm.locator('.shop__buy-btn')).toContainText(/Kup/);

            const lockExpectations: Array<[string, string]> = [
                ['Eliksir HP', 'Lv 20'],
                ['Silny Eliksir HP', 'Lv 50'],
                ['Mega Eliksir HP', 'Lv 100'],
                ['Wielki Eliksir HP', 'Lv 200'],
            ];
            for (const [name, badge] of lockExpectations) {
                const c = cardByName(name);
                await expect(c, `${name} card should be locked`).toHaveClass(/shop__card--locked/);
                const btn = c.locator('.shop__buy-btn');
                await expect(btn, `${name} buy button disabled`).toBeDisabled();
                await expect(btn, `${name} shows ${badge}`).toContainText(badge);
            }

            await page.locator('.shop__tab[aria-label="Arena"]').tap();
            await expect(cardByName('Potion HP 25%')).toBeVisible({ timeout: 10_000 });
            const arenaLocks: Array<[string, string]> = [
                ['Potion HP 25%', 'Lv 200'],
                ['Potion HP 50%', 'Lv 500'],
                ['Potion HP 100%', 'Lv 700'],
                ['Potion MP 25%', 'Lv 200'],
            ];
            for (const [name, badge] of arenaLocks) {
                const c = cardByName(name);
                await expect(c, `arena ${name} card should be locked`).toHaveClass(/shop__card--locked/);
                const btn = c.locator('.shop__buy-btn');
                await expect(btn, `arena ${name} buy button disabled`).toBeDisabled();
                await expect(btn, `arena ${name} shows ${badge}`).toContainText(badge);
            }
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
