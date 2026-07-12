
import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { seedGameSave, findUserIdByEmail, generateFillerBagItems } from '../../fixtures/seedGameSave';
import { killMonsterViaEngine, getCharacterSnapshot } from '../../fixtures/combatSim';

test.describe('Combat › Loot', { tag: '@combat' }, () => {
    test.describe.configure({ timeout: 90_000 });

    test('kill mob with bag at 1000/1000: bag stays at MAX, gold/XP still awarded', async ({ page }) => {
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
            await seedGameSave({
                characterId: created.id,
                userId,
                gold: 0,
                bagItems: generateFillerBagItems(1000),
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
            expect(before!.bagSize).toBe(1000);
            const preGold = before!.gold;
            const preXp = before!.xp;

            await killMonsterViaEngine(page, 'rat');

            const after = await getCharacterSnapshot(page);
            expect(after).not.toBeNull();

            expect(after!.bagSize).toBe(1000);

            expect(after!.gold).toBeGreaterThan(preGold);

            expect(after!.xp).toBeGreaterThan(preXp);
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
