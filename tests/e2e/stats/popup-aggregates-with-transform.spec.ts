
import { test, expect } from '@playwright/test';
import { testUsers } from '../fixtures/testUsers';
import { loginViaUI } from '../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../fixtures/createCharacter';
import { cleanupCharacterById } from '../fixtures/cleanup';
import { seedEquippedItem } from '../fixtures/seedInventory';
import { seedGameSave, findUserIdByEmail } from '../fixtures/seedGameSave';

test.describe('Stats › Popup', { tag: '@stats' }, () => {
    test.describe.configure({ timeout: 90_000 });

    test('Max HP aggregates base + Eq + skill train + elixir + transform (flat + %)', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            const created = await createCharacterViaApi({
                userEmail: testUsers.secondary.email,
                name: nick,
                class: 'Knight',
                overrides: { level: 5, highest_level: 5, hp: 40, mp: 15, hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            const userId = await findUserIdByEmail(testUsers.secondary.email);
            await seedGameSave({
                characterId: created.id,
                userId,
                skills: {
                    skillLevels: { max_hp: 4 },
                },
                buffs: [
                    {
                        id: 'hp_boost_500',
                        name: '+500 Max HP',
                        icon: 'drop-of-blood',
                        effect: 'hp_boost_500',
                    },
                ],
                transforms: {
                    completedTransforms: [1],
                    bakedBonusesApplied: false,
                },
            });

            await seedEquippedItem({
                characterId: created.id,
                slot: 'helmet',
                itemId: 'heavy_helmet_lvl5_common',
                rarity: 'common',
                bonuses: { hp: 20 },
                itemLevel: 5,
                upgradeLevel: 0,
            });


            await loginViaUI(page, testUsers.secondary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 10_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });

            await page.goto('/inventory');
            await expect(page.locator('.inventory__paperdoll-actions')).toBeVisible({ timeout: 10_000 });
            await page.getByRole('button', { name: /^statystyki$/i }).tap();

            const statsPopup = page.locator('.inventory__popup--stats');
            await expect(statsPopup).toBeVisible({ timeout: 5_000 });

            const hpBox = statsPopup.locator('.inventory__stats-box', {
                has: page.locator('.inventory__stats-box-label', { hasText: /^Max HP$/ }),
            });
            await expect(hpBox.locator('.inventory__stats-box-value')).toHaveText('1239');

            await expect(hpBox).toContainText('Baza');
            await expect(hpBox).toContainText('232');
            await expect(hpBox).toContainText('Eq');
            await expect(hpBox).toContainText('+20');
            await expect(hpBox).toContainText('Trening');
            await expect(hpBox).toContainText('Eliksir');
            await expect(hpBox).toContainText('+500');
            await expect(hpBox).toContainText('TF flat');
            await expect(hpBox).toContainText('+420');
            await expect(hpBox).toContainText('TF %');
            await expect(hpBox).toContainText(/\+4%/);
            await expect(hpBox).toContainText(/\(47\)/);
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
