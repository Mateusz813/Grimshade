/**
 * Atomic E2E — HP/MP potions are LEVEL-GATED in the shop Potiony tab.
 *
 * Regression for the 2026-06-21 player report: "Moge na 14 lvl kupic wszystkie"
 * (at level 14 I can buy every potion). Per spec the tiers unlock by level:
 *   50  (sm)   → lvl 1
 *   150 (md)   → lvl 20
 *   400 (lg)   → lvl 50
 *   1000(mega) → lvl 100
 *   20% (great)→ lvl 200   (… 35%/50%/100% → 350/500/700)
 * and cannot be bought (nor drunk, nor alchemy-crafted) before that level.
 *
 * This test seeds a level-14 Knight with a HUGE gold pile so affordability is
 * NEVER the blocker — the ONLY reason a buy button is disabled is the level
 * gate. We then assert on the Potiony tab:
 *   - "Mały Eliksir HP" (50, lvl 1)   → buyable ("Kup"), card NOT locked.
 *   - "Eliksir HP" (150, lvl 20)      → locked: card has --locked, button "Lv 20".
 *   - "Silny Eliksir HP" (400, lvl 50)→ locked "Lv 50".
 *   - "Mega Eliksir HP" (1000, lvl100)→ locked "Lv 100".
 *   - "Wielki Eliksir HP" (20%, lvl200)→ locked "Lv 200".
 *
 * Cleanup: try/finally + cleanupCharacterById.
 */

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
            // 1. Seed Knight lvl 14. The SPENDABLE wallet lives in the
            //    game_saves blob (inventoryStore.gold) — NOT characters.gold —
            //    so seed it via seedGameSave so affordability is never the
            //    blocker (only the level gate is).
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: { level: 14, highest_level: 14, hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;
            const userId = await findUserIdByEmail(testUsers.primary.email);
            await seedGameSave({ characterId: created.id, userId, gold: 50_000_000 });

            // 2. Login → pick character → Town.
            await loginViaUI(page, testUsers.primary);
            await page.goto('/character-select');
            await expect(page.locator('.char-select__card-name', { hasText: nick }))
                .toBeVisible({ timeout: 10_000 });
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });

            // 3. Go to the shop, open the Potiony tab.
            await page.goto('/shop');
            await page.locator('.shop__tab[aria-label="Potiony"]').tap();
            await expect(page.locator('.shop__card-name', { hasText: 'Mały Eliksir HP' }))
                .toBeVisible({ timeout: 10_000 });

            const cardByName = (name: string): Locator =>
                page.locator('.shop__card', {
                    has: page.locator('.shop__card-name', { hasText: new RegExp(`^${name}$`) }),
                });

            // 4. Tier 1 (50 HP, lvl 1) — buyable, not locked.
            const sm = cardByName('Mały Eliksir HP');
            await expect(sm).not.toHaveClass(/shop__card--locked/);
            await expect(sm.locator('.shop__buy-btn')).toBeEnabled();
            await expect(sm.locator('.shop__buy-btn')).toContainText(/Kup/);

            // 5. Higher tiers — locked by level (disabled + "Lv N"), despite full wallet.
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

            // 6. ARENA shop (AP currency) sells the same potions via payloadId —
            //    they must be level-gated too (arena_hp_25 → hp_potion_great lvl
            //    200, arena_hp_100 → hp_potion_divine lvl 700).
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
