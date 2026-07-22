
import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { seedGameSave, findUserIdByEmail } from '../../fixtures/seedGameSave';
import { runCombatViaSkip } from '../../fixtures/combatSim';
import { baseMaxHpFloor } from '../../fixtures/balance';

const HP_PCT_MULT = 1.25;
const EXPECTED_MAX_HP = Math.floor(baseMaxHpFloor('Knight', 5) * HP_PCT_MULT);

test.describe('Combat › Elixirs', { tag: '@combat' }, () => {
    test.describe.configure({ timeout: 90_000 });

    test('hp_pct_25 buff active -> /combat TopHeader popover shows boosted max HP + engine getEffectiveChar agrees + SKIP fight resolves', async ({ page }) => {
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
                buffs: [
                    {
                        id: 'hp_pct_25',
                        name: 'Max HP +25%',
                        icon: 'heart-on-fire',
                        effect: 'hp_pct_25',
                    },
                ],
            });

            await loginViaUI(page, testUsers.secondary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 15_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
            await expect(page.locator('.town__char-name')).toHaveText(nick, { timeout: 10_000 });

            const hasBuffAtTown = await page.evaluate(async () => {
                const mod = await import('/src/stores/buffStore.ts');
                return (mod as {
                    useBuffStore: { getState: () => { hasBuff: (e: string) => boolean } };
                }).useBuffStore.getState().hasBuff('hp_pct_25');
            });
            expect(hasBuffAtTown).toBe(true);

            await page.goto('/combat');
            await expect(page.locator('.combat__hub-monsters, .combat__hub-empty').first())
                .toBeVisible({ timeout: 10_000 });

            const pulseBtn = page.locator('.top-header__pulse').first();
            await expect(pulseBtn).toBeVisible({ timeout: 5_000 });
            await pulseBtn.tap();
            const popoverHp = await page
                .locator('.top-header__pulse-popover-row--hp .top-header__pulse-popover-val')
                .first()
                .textContent();
            expect(popoverHp?.trim()).toBe(`40/${EXPECTED_MAX_HP}`);

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
            expect(engineMaxHp).toBe(EXPECTED_MAX_HP);

            const multiplier = await page.evaluate(async () => {
                const mod = await import('/src/systems/combatElixirs.ts');
                return (mod as { getElixirHpPctMultiplier: () => number }).getElixirHpPctMultiplier();
            });
            expect(multiplier).toBe(1.25);

            const result = await runCombatViaSkip(page, 'rat');
            expect(result.phase).toBe('victory');
            expect(result.earnedXp).toBeGreaterThan(0);
            expect(result.sessionKills.normal).toBeGreaterThanOrEqual(1);

            const hasBuffAfter = await page.evaluate(async () => {
                const mod = await import('/src/stores/buffStore.ts');
                return (mod as {
                    useBuffStore: { getState: () => { hasBuff: (e: string) => boolean } };
                }).useBuffStore.getState().hasBuff('hp_pct_25');
            });
            expect(hasBuffAfter).toBe(true);
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
