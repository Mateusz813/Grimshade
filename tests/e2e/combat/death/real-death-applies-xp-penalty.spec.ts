
import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { triggerPlayerDeath, getCharacterSnapshot } from '../../fixtures/combatSim';

test.describe('Combat › Death', { tag: '@combat' }, () => {
    test.describe.configure({ timeout: 90_000 });

    test('Knight lvl 50 dies without protection -> level drops to 49, xp lands ~half into lvl 49', async ({ page }) => {
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

            await triggerPlayerDeath(page, 'rat');

            const after = await getCharacterSnapshot(page);
            expect(after).not.toBeNull();

            expect(after!.level).toBe(49);

            expect(after!.xp).toBe(51450);

            expect(after!.hp).toBe(after!.max_hp);
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
