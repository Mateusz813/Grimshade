
import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { runCombatViaSkip } from '../../fixtures/combatSim';

test.describe('Combat › Hunting', { tag: '@combat' }, () => {
    test.describe.configure({ timeout: 90_000 });

    test('three SKIP fights -> sessionKills.normal increments 0 -> 1 -> 2 -> 3', async ({ page }) => {
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

            const k1 = await runCombatViaSkip(page, 'rat');
            expect(k1.phase).toBe('victory');
            expect(k1.sessionKills.normal).toBe(1);

            const k2 = await runCombatViaSkip(page, 'rat');
            expect(k2.phase).toBe('victory');
            expect(k2.sessionKills.normal).toBe(2);

            const k3 = await runCombatViaSkip(page, 'rat');
            expect(k3.phase).toBe('victory');
            expect(k3.sessionKills.normal).toBe(3);

            expect(k1.earnedXp).toBeGreaterThan(0);
            expect(k2.earnedXp).toBeGreaterThan(0);
            expect(k3.earnedXp).toBeGreaterThan(0);
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
