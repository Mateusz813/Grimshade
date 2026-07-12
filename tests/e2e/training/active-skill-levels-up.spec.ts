
import { test, expect } from '@playwright/test';
import { testUsers } from '../fixtures/testUsers';
import { loginViaUI } from '../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../fixtures/createCharacter';
import { cleanupCharacterById } from '../fixtures/cleanup';
import { seedGameSave } from '../fixtures/seedGameSave';
import { findUserIdByEmail } from '../fixtures/adminClient';
import { runCombatViaSkip } from '../fixtures/combatSim';

test.describe('Training › Active', { tag: '@training' }, () => {
    test.describe.configure({ timeout: 90_000 });

    test('skill_xp gain from combat ticks -> sword_fighting Lv 0 -> Lv 1 + popup updates', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: { level: 5, highest_level: 5, hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            const userId = await findUserIdByEmail(testUsers.primary.email);
            if (!userId) throw new Error('User lookup failed for primary');
            await seedGameSave({
                characterId: created.id,
                userId,
                skills: {
                    activeSkillSlots: [null, null, null, null],
                    unlockedSkills: {},
                    skillLevels: { sword_fighting: 0 },
                },
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

            await page.evaluate(async () => {
                const mod = await import('/src/stores/skillStore.ts');
                (mod as {
                    useSkillStore: {
                        getState: () => {
                            selectTrainingStat: (id: string | null) => void;
                        };
                    };
                }).useSkillStore.getState().selectTrainingStat('sword_fighting');
            });

            await page.goto('/inventory');
            await expect(page.locator('.inventory__paperdoll-actions')).toBeVisible({ timeout: 10_000 });
            await page.getByRole('button', { name: /^trening skilli$/i }).tap();
            const popup = page.locator('.inventory__popup--training');
            await expect(popup).toBeVisible({ timeout: 5_000 });

            const swordCard = popup.locator('.inventory__training-card', {
                has: page.locator('.inventory__training-card-name', { hasText: 'Walka Mieczem' }),
            });
            await expect(swordCard).toBeVisible({ timeout: 5_000 });
            await expect(swordCard.locator('.inventory__training-card-level')).toContainText(/^Lv 0$/);
            await expect(swordCard.locator('.inventory__training-card-xp')).toContainText(/^0 \/ 100 XP$/);

            const closeBtn = page.getByRole('button', { name: /zamknij/i }).first();
            if (await closeBtn.isVisible().catch(() => false)) {
                await closeBtn.tap();
            } else {
                await page.keyboard.press('Escape');
            }
            await expect(popup).toHaveCount(0, { timeout: 3_000 });

            const preFightState = await page.evaluate(async () => {
                const mod = await import('/src/stores/skillStore.ts');
                const s = (mod as {
                    useSkillStore: {
                        getState: () => {
                            skillLevels: Record<string, number>;
                            skillXp: Record<string, number>;
                        };
                    };
                }).useSkillStore.getState();
                return {
                    level: s.skillLevels['sword_fighting'] ?? 0,
                    xp: s.skillXp['sword_fighting'] ?? 0,
                };
            });
            expect(preFightState.level).toBe(0);
            expect(preFightState.xp).toBe(0);

            for (let i = 0; i < 3; i++) {
                const result = await runCombatViaSkip(page, 'rat');
                expect(result.phase).toBe('victory');
            }

            const postSkipState = await page.evaluate(async () => {
                const mod = await import('/src/stores/skillStore.ts');
                const s = (mod as {
                    useSkillStore: {
                        getState: () => {
                            skillLevels: Record<string, number>;
                            skillXp: Record<string, number>;
                        };
                    };
                }).useSkillStore.getState();
                return {
                    level: s.skillLevels['sword_fighting'] ?? 0,
                    xp: s.skillXp['sword_fighting'] ?? 0,
                };
            });
            expect(postSkipState.level).toBe(0);
            expect(postSkipState.xp).toBe(0);

            await page.evaluate(async () => {
                const mod = await import('/src/stores/skillStore.ts');
                const skillStore = (mod as {
                    useSkillStore: {
                        getState: () => {
                            addWeaponSkillXpFromAttack: (cls: string) => number;
                        };
                    };
                }).useSkillStore;
                for (let i = 0; i < 110; i++) {
                    skillStore.getState().addWeaponSkillXpFromAttack('Knight');
                }
            });

            const postXpState = await page.evaluate(async () => {
                const mod = await import('/src/stores/skillStore.ts');
                const s = (mod as {
                    useSkillStore: {
                        getState: () => {
                            skillLevels: Record<string, number>;
                            skillXp: Record<string, number>;
                        };
                    };
                }).useSkillStore.getState();
                return {
                    level: s.skillLevels['sword_fighting'] ?? 0,
                    xp: s.skillXp['sword_fighting'] ?? 0,
                };
            });
            expect(postXpState.level).toBe(1);
            expect(postXpState.xp).toBe(10);
            expect(postXpState.xp).toBeGreaterThan(preFightState.xp);
            expect(postXpState.level).toBeGreaterThan(preFightState.level);

            await page.getByRole('button', { name: /^trening skilli$/i }).tap();
            const popupReopened = page.locator('.inventory__popup--training');
            await expect(popupReopened).toBeVisible({ timeout: 5_000 });

            const swordCardReopened = popupReopened.locator('.inventory__training-card', {
                has: page.locator('.inventory__training-card-name', { hasText: 'Walka Mieczem' }),
            });
            await expect(swordCardReopened).toBeVisible({ timeout: 5_000 });
            await expect(swordCardReopened.locator('.inventory__training-card-level')).toContainText(/^Lv 1$/);
            await expect(swordCardReopened.locator('.inventory__training-card-xp')).toContainText(/^10 \/ 100 XP$/);
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
