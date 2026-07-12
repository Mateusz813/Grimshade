
import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { runCombatViaSkip } from '../../fixtures/combatSim';

test.describe('Combat › Speed', { tag: '@combat' }, () => {
    test.describe.configure({ timeout: 90_000 });

    test('combat speed x4 restored after SKIP-resolved fight (combatSim restore contract)', async ({ page }) => {
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
                const mod = await import('/src/stores/settingsStore.ts');
                (mod as {
                    useSettingsStore: { getState: () => { setCombatSpeed: (s: string) => void } };
                }).useSettingsStore.getState().setCombatSpeed('x4');
            });

            const preSpeed = await page.evaluate(async () => {
                const mod = await import('/src/stores/settingsStore.ts');
                return (mod as {
                    useSettingsStore: { getState: () => { combatSpeed: string } };
                }).useSettingsStore.getState().combatSpeed;
            });
            expect(preSpeed).toBe('x4');

            const result = await runCombatViaSkip(page, 'rat');

            expect(result.phase).toBe('victory');

            const postSpeed = await page.evaluate(async () => {
                const mod = await import('/src/stores/settingsStore.ts');
                return (mod as {
                    useSettingsStore: { getState: () => { combatSpeed: string } };
                }).useSettingsStore.getState().combatSpeed;
            });
            expect(postSpeed).toBe('x4');
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
