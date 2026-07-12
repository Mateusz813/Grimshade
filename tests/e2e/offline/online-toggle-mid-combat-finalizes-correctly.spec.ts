
import { test, expect } from '@playwright/test';
import { testUsers } from '../fixtures/testUsers';
import { loginViaUI } from '../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../fixtures/createCharacter';
import { cleanupCharacterById } from '../fixtures/cleanup';
import { runCombatViaSkip, getCharacterSnapshot } from '../fixtures/combatSim';

test.describe('Offline › Sync', { tag: '@offline' }, () => {
    test.describe.configure({ timeout: 90_000 });

    test('combat staged offline survives online toggle + finalizes via SKIP -> phase=victory + rewards persist', async ({ page }) => {
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

            await loginViaUI(page, testUsers.secondary);
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
            const preXp = before!.xp;

            const avatarBtn = page.getByRole('button', { name: /menu postaci/i });
            await avatarBtn.tap();
            const modeToggle = page.locator('.avatar-menu__lang-toggle').nth(1);
            const offlineBtn = modeToggle.locator('.avatar-menu__lang-btn', { hasText: /^Offline$/ });
            await expect(offlineBtn).toBeVisible({ timeout: 5_000 });
            await offlineBtn.tap();

            const statusDot = page.locator('.top-header__status-dot');
            await expect(statusDot).toHaveClass(/top-header__status-dot--offline/, { timeout: 5_000 });

            const snapBeforeCombat = await page.evaluate(() =>
                sessionStorage.getItem('grimshade.offlineSnapshot'),
            );
            expect(snapBeforeCombat).not.toBeNull();

            await page.evaluate(async () => {
                const engineMod = await import('/src/systems/combatEngine.ts');
                const combatMod = await import('/src/stores/combatStore.ts');
                const engine = engineMod as {
                    getAllMonsters: () => Array<{ id: string; hp: number; level: number }>;
                };
                const useCombatStore = (combatMod as {
                    useCombatStore: {
                        getState: () => {
                            initCombat: (m: unknown, hp: number, mp: number, rarity?: string) => void;
                        };
                    };
                }).useCombatStore;
                const rat = engine.getAllMonsters().find((m) => m.id === 'rat');
                if (!rat) throw new Error('rat monster missing');
                useCombatStore.getState().initCombat(rat, 120, 15, 'normal');
            });

            const offlineCombatState = await page.evaluate(async () => {
                const mod = await import('/src/stores/combatStore.ts');
                const cs = (mod as {
                    useCombatStore: {
                        getState: () => {
                            phase: string;
                            monster: { id: string } | null;
                            playerCurrentHp: number;
                        };
                    };
                }).useCombatStore.getState();
                return {
                    phase: cs.phase,
                    monsterId: cs.monster?.id ?? null,
                    playerHp: cs.playerCurrentHp,
                };
            });
            expect(offlineCombatState.phase).toBe('fighting');
            expect(offlineCombatState.monsterId).toBe('rat');
            expect(offlineCombatState.playerHp).toBe(120);

            const onlineBtn = modeToggle.locator('.avatar-menu__lang-btn', { hasText: /^Online$/ });
            await onlineBtn.tap();
            await expect(statusDot).toHaveClass(/top-header__status-dot--online/, { timeout: 5_000 });

            const onlineCombatState = await page.evaluate(async () => {
                const mod = await import('/src/stores/combatStore.ts');
                const cs = (mod as {
                    useCombatStore: {
                        getState: () => {
                            phase: string;
                            monster: { id: string } | null;
                            playerCurrentHp: number;
                        };
                    };
                }).useCombatStore.getState();
                return {
                    phase: cs.phase,
                    monsterId: cs.monster?.id ?? null,
                    playerHp: cs.playerCurrentHp,
                };
            });
            expect(onlineCombatState.phase).toBe('fighting');
            expect(onlineCombatState.monsterId).toBe('rat');
            expect(onlineCombatState.playerHp).toBe(120);

            const result = await runCombatViaSkip(page, 'rat');
            expect(result.phase).toBe('victory');
            expect(result.earnedXp).toBeGreaterThan(0);
            expect(result.sessionKills.normal).toBeGreaterThanOrEqual(1);

            const after = await getCharacterSnapshot(page);
            expect(after).not.toBeNull();
            expect(after!.xp).toBeGreaterThan(preXp);

            await expect.poll(
                () => page.evaluate(() => sessionStorage.getItem('grimshade.offlineSnapshot')),
                { timeout: 10_000 },
            ).toBeNull();
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
