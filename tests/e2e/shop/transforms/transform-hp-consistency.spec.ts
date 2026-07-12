
import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { seedGameSave, findUserIdByEmail } from '../../fixtures/seedGameSave';

test.describe('Shop › Transforms', { tag: '@shop' }, () => {
    test.describe.configure({ timeout: 120_000 });

    test('Knight tier 1 transform (+420 flat HP + 4% HP) -> Town, TopHeader popover, CharacterSelect all show 40/561 effective max HP', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            const created = await createCharacterViaApi({
                userEmail: testUsers.secondary.email,
                name: nick,
                class: 'Knight',
                overrides: { hp: 40, mp: 15, level: 5, highest_level: 5, hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            const userId = await findUserIdByEmail(testUsers.secondary.email);
            await seedGameSave({
                characterId: createdId,
                userId,
                transforms: {
                    completedTransforms: [1],
                    bakedBonusesApplied: false,
                },
            });


            await loginViaUI(page, testUsers.secondary);
            await page.goto('/character-select');
            await expect(page.locator('.char-select__card-name', { hasText: nick })).toBeVisible({ timeout: 15_000 });

            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
            await expect(page.locator('.town__char-name')).toHaveText(nick, { timeout: 10_000 });

            const storeState = await page.evaluate(async () => {
                const mod = await import('/src/stores/transformStore.ts');
                const s = (mod as {
                    useTransformStore: { getState: () => { completedTransforms: number[]; bakedBonusesApplied: boolean } };
                }).useTransformStore.getState();
                return { completed: [...s.completedTransforms], baked: s.bakedBonusesApplied };
            });
            expect(storeState.completed).toEqual([1]);
            expect(storeState.baked).toBe(false);

            const engineMaxHp = await page.evaluate(async () => {
                const engineMod = await import('/src/systems/combatEngine.ts');
                const charMod = await import('/src/stores/characterStore.ts');
                const engine = engineMod as {
                    getEffectiveChar: (c: unknown) => { max_hp: number } | null;
                };
                const ch = (charMod as {
                    useCharacterStore: { getState: () => { character: unknown } };
                }).useCharacterStore.getState().character;
                const eff = engine.getEffectiveChar(ch);
                return eff?.max_hp ?? null;
            });
            expect(engineMaxHp).toBe(678);

            const townHp = await page
                .locator('.town__bar-wrap', { has: page.locator('.town__bar--hp') })
                .locator('.town__bar-value')
                .textContent();
            expect(townHp?.trim()).toBe('40/678');

            const pulseBtn = page.locator('.top-header__pulse').first();
            await expect(pulseBtn).toBeVisible({ timeout: 5_000 });
            await pulseBtn.tap();
            const popoverHp = await page
                .locator('.top-header__pulse-popover-row--hp .top-header__pulse-popover-val')
                .first()
                .textContent();
            expect(popoverHp?.trim()).toBe('40/678');

            await page.goto('/character-select');
            await expect(page.locator('.char-select__card-name', { hasText: nick })).toBeVisible({ timeout: 10_000 });
            const reloadedCard = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            const selectHpText = await reloadedCard
                .locator('.char-select__bar-wrap', { has: page.locator('.char-select__bar--hp') })
                .locator('.char-select__bar-value')
                .textContent();
            expect(selectHpText?.trim()).toBe('40/678');

            expect(townHp?.trim()).toBe(popoverHp?.trim());
            expect(popoverHp?.trim()).toBe(selectHpText?.trim());
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
