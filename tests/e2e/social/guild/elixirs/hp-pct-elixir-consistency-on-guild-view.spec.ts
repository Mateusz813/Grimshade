
import { test, expect } from '@playwright/test';
import { testUsers } from '../../../fixtures/testUsers';
import { loginViaUI } from '../../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../../fixtures/cleanup';
import { seedGameSave, findUserIdByEmail } from '../../../fixtures/seedGameSave';
import { seedGuild } from '../../../fixtures/seedGuild';
import { cleanupGuildsByLeaderIds } from '../../../fixtures/guildCleanup';

test.describe('Social › Guild › Elixirs', { tag: '@guild' }, () => {
    test.describe.configure({ timeout: 90_000 });

    test('hp_pct_25 buff active -> /guild TopHeader popover shows boosted max HP + engine getEffectiveChar agrees', async ({ page }) => {
        const nick = generateTestCharacterName();
        const tag = Math.random().toString(36).slice(2, 5).toUpperCase().replace(/[^A-Z0-9]/g, 'A');
        const guildName = `E2E G ${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

        let createdId: string | null = null;
        let guildId: string | null = null;

        try {
            const created = await createCharacterViaApi({
                userEmail: testUsers.secondary.email,
                name: nick,
                class: 'Knight',
                overrides: { hp: 40, mp: 15, level: 10, highest_level: 10, hp_regen: 0, mp_regen: 0 },
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

            const seededGuild = await seedGuild({
                name: guildName,
                tag,
                memberCharacterIds: [createdId],
            });
            guildId = seededGuild.id;

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

            await page.getByRole('button', { name: /^Społeczność$/i }).tap();
            await expect(page).toHaveURL(/\/social$/, { timeout: 10_000 });
            await page.locator('.social__tile--gildia').tap();
            await expect(page).toHaveURL(/\/guild$/, { timeout: 10_000 });

            await expect(page.locator('.guild__home-name, .guild__members').first())
                .toBeVisible({ timeout: 15_000 });

            const pulseBtn = page.locator('.top-header__pulse').first();
            await expect(pulseBtn).toBeVisible({ timeout: 5_000 });
            await pulseBtn.tap();
            const popoverHp = await page
                .locator('.top-header__pulse-popover-row--hp .top-header__pulse-popover-val')
                .first()
                .textContent();
            expect(popoverHp?.trim()).toBe('40/377');

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
            expect(engineMaxHp).toBe(377);

            const multiplier = await page.evaluate(async () => {
                const mod = await import('/src/systems/combatElixirs.ts');
                return (mod as { getElixirHpPctMultiplier: () => number }).getElixirHpPctMultiplier();
            });
            expect(multiplier).toBe(1.25);
        } finally {
            if (guildId !== null) {
                await cleanupGuildsByLeaderIds([createdId]);
            }
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
