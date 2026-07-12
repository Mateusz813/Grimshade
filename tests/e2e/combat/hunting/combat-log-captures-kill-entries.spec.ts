
import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { runCombatViaSkip, getCombatSnapshot } from '../../fixtures/combatSim';

test.describe('Combat › Hunting', { tag: '@combat' }, () => {
    test.describe.configure({ timeout: 90_000 });

    test('SKIP fight populates sessionLog with system entries', async ({ page }) => {
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

            const pre = await getCombatSnapshot(page);
            expect(pre).not.toBeNull();
            const preLogCount = pre!.sessionLog.length;

            const result = await runCombatViaSkip(page, 'rat');
            expect(result.phase).toBe('victory');

            expect(result.sessionLog.length).toBeGreaterThan(preLogCount);

            const openLogEntry = result.sessionLog.find((l) =>
                /Walka z Szczur \(Poziom 1\) rozpoczęta/.test(l.text),
            );
            expect(openLogEntry).toBeDefined();
            expect(openLogEntry!.type).toBe('system');

            const systemEntries = result.sessionLog.filter((l) => l.type === 'system');
            expect(systemEntries.length).toBeGreaterThanOrEqual(1);
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
