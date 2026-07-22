
import { test, expect } from '@playwright/test';
import { testUsers } from '../fixtures/testUsers';
import { loginViaUI } from '../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../fixtures/createCharacter';
import { cleanupCharacterById } from '../fixtures/cleanup';
import { seedEquippedItem } from '../fixtures/seedInventory';
import { seedGameSave, findUserIdByEmail } from '../fixtures/seedGameSave';
import { baseMaxHpFloor, scaleGearHp, TRAIN_HP_PER_LEVEL } from '../fixtures/balance';

const GEAR_HP = 20;
const TRAIN_LVL = 4;
const FLAT_ELIXIR_HP = 500;
const TF_FLAT_HP = 420;
const TF_HP_PCT = 4;
const BASE_HP = baseMaxHpFloor('Knight', 5);
const RAW_MAX_HP = BASE_HP + scaleGearHp(GEAR_HP) + TRAIN_LVL * TRAIN_HP_PER_LEVEL + FLAT_ELIXIR_HP + TF_FLAT_HP;
const EXPECTED_MAX_HP = Math.floor(RAW_MAX_HP * (1 + TF_HP_PCT / 100));

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
            await expect(hpBox.locator('.inventory__stats-box-value')).toHaveText(String(EXPECTED_MAX_HP));

            const breakdownRow = (label: string) => hpBox.locator('.inventory__stats-box-breakdown-row', {
                has: page.locator('.inventory__stats-box-breakdown-label', { hasText: new RegExp(`^${label}$`) }),
            }).locator('.inventory__stats-box-breakdown-value');

            await expect(breakdownRow('Baza')).toHaveText(String(BASE_HP));
            await expect(breakdownRow('Eq')).toHaveText(`+${scaleGearHp(GEAR_HP)}`);
            await expect(breakdownRow('Trening')).toHaveText(`+${TRAIN_LVL * TRAIN_HP_PER_LEVEL}`);
            await expect(breakdownRow('Eliksir')).toHaveText(`+${FLAT_ELIXIR_HP}`);
            await expect(breakdownRow('TF flat')).toHaveText(`+${TF_FLAT_HP}`);
            await expect(breakdownRow('TF %')).toHaveText(`+${TF_HP_PCT}% (${EXPECTED_MAX_HP - RAW_MAX_HP})`);
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
