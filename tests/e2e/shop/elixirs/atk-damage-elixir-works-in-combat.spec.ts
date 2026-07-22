
import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { seedGameSave, findUserIdByEmail } from '../../fixtures/seedGameSave';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { runCombatViaSkip, getCharacterSnapshot } from '../../fixtures/combatSim';
import { DMG_ELIXIR_TIER_MULT } from '../../fixtures/balance';

test.describe('Shop › Elixirs', { tag: '@shop' }, () => {
    test.describe.configure({ timeout: 90_000 });

    test('atk_dmg_25 buff active -> SKIP fight against rat resolves to victory + rewards land + multiplier reads 1.25', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            const created = await createCharacterViaApi({
                userEmail: testUsers.secondary.email,
                name: nick,
                class: 'Knight',
                overrides: { hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            const userId = await findUserIdByEmail(testUsers.secondary.email);
            await seedGameSave({
                characterId: createdId,
                userId,
                buffs: [
                    {
                        id: 'atk_dmg_25',
                        name: 'ATK DMG +25%',
                        icon: 'crossed-swords',
                        effect: 'atk_dmg_25',
                    },
                ],
            });

            await loginViaUI(page, testUsers.secondary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 10_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
            await expect(page.locator('.town__char-name')).toHaveText(nick, { timeout: 10_000 });

            const hasBuffOnEnter = await page.evaluate(async () => {
                const mod = await import('/src/stores/buffStore.ts');
                return (mod as {
                    useBuffStore: { getState: () => { hasBuff: (e: string) => boolean } };
                }).useBuffStore.getState().hasBuff('atk_dmg_25');
            });
            expect(hasBuffOnEnter).toBe(true);

            const multiplier = await page.evaluate(async () => {
                const mod = await import('/src/systems/combatElixirs.ts');
                return (mod as { getAtkDamageMultiplier: () => number }).getAtkDamageMultiplier();
            });
            expect(multiplier).toBe(DMG_ELIXIR_TIER_MULT.t25);

            const before = await getCharacterSnapshot(page);
            expect(before).not.toBeNull();
            const preXp = before!.xp;

            const result = await runCombatViaSkip(page, 'rat');

            expect(result.phase).toBe('victory');

            expect(result.earnedXp).toBeGreaterThan(0);

            expect(result.sessionKills.normal).toBeGreaterThanOrEqual(1);

            const after = await getCharacterSnapshot(page);
            expect(after).not.toBeNull();
            expect(after!.xp).toBeGreaterThan(preXp);

            const hasBuffOnExit = await page.evaluate(async () => {
                const mod = await import('/src/stores/buffStore.ts');
                return (mod as {
                    useBuffStore: { getState: () => { hasBuff: (e: string) => boolean } };
                }).useBuffStore.getState().hasBuff('atk_dmg_25');
            });
            expect(hasBuffOnExit).toBe(true);
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
