
import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { triggerPlayerDeath, getCharacterSnapshot } from '../../fixtures/combatSim';

test.describe('Combat › Death', { tag: '@combat' }, () => {
    test.describe.configure({ timeout: 90_000 });

    test('victory phase after death does not revive: level/xp penalty persists post-victory', async ({ page }) => {
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

            const afterDeath = await getCharacterSnapshot(page);
            expect(afterDeath).not.toBeNull();
            expect(afterDeath!.level).toBe(49);
            expect(afterDeath!.xp).toBe(51450);
            expect(afterDeath!.hp).toBe(afterDeath!.max_hp);

            const victoryResult = await page.evaluate(async () => {
                const combatMod = await import('/src/stores/combatStore.ts');
                const useCombatStore = (combatMod as {
                    useCombatStore: {
                        getState: () => {
                            phase: string;
                            setPhase: (p: string) => void;
                        };
                    };
                }).useCombatStore;

                const prePhase = useCombatStore.getState().phase;
                useCombatStore.getState().setPhase('victory');
                const postPhase = useCombatStore.getState().phase;

                return { prePhase, postPhase };
            });

            expect(victoryResult.postPhase).toBe('victory');

            const afterVictory = await getCharacterSnapshot(page);
            expect(afterVictory).not.toBeNull();

            expect(afterVictory!.level).toBe(49);

            expect(afterVictory!.xp).toBe(51450);

            expect(afterVictory!.hp).toBe(afterVictory!.max_hp);

            expect(afterVictory!.max_hp).toBe(afterDeath!.max_hp);
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
