
import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';

test.describe('Combat › UI', { tag: '@combat' }, () => {
    test.describe.configure({ timeout: 90_000 });

    test('idle-hub speed + skill-mode + auto-fight chips remain tappable across x1 -> x2 -> x4 -> SKIP cycle', async ({ page }) => {
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
            await expect(page.locator('.top-header')).toBeVisible({ timeout: 10_000 });

            await page.goto('/combat');
            await expect(page).toHaveURL(/\/combat$/, { timeout: 10_000 });
            await expect(page.locator('.combat__hub')).toBeVisible({ timeout: 15_000 });

            const speedBtn = page.locator('button.combat__speed-btn');
            await expect(speedBtn).toBeVisible({ timeout: 10_000 });
            const skillModeBtn = page.locator('button.combat__mode-btn');
            const autoFightBtn = page.locator('button.combat__toggle-btn').first();
            await expect(skillModeBtn).toBeVisible();
            await expect(autoFightBtn).toBeVisible();

            const initialSpeedText = (await speedBtn.textContent())?.trim() ?? '';
            expect(['x1', 'x2', 'x4', 'SKIP']).toContain(initialSpeedText);

            const speedOrder = ['x1', 'x2', 'x4', 'SKIP'];
            let currentIdx = speedOrder.indexOf(initialSpeedText);
            if (currentIdx === -1) currentIdx = 0;

            for (let i = 0; i < 4; i++) {
                const expectedNextSpeed = speedOrder[(currentIdx + 1) % speedOrder.length];

                await expect(skillModeBtn).toBeVisible();
                await expect(skillModeBtn).toBeEnabled();
                await expect(autoFightBtn).toBeVisible();
                await expect(autoFightBtn).toBeEnabled();

                await expect(speedBtn).toBeVisible();
                await expect(speedBtn).toBeEnabled();

                await page.waitForTimeout(200);
                let advanced = false;
                for (let attempt = 1; attempt <= 5 && !advanced; attempt++) {
                    if (attempt > 1) await page.waitForTimeout(200);
                    await speedBtn.tap({ force: true });
                    try {
                        await expect(speedBtn).toHaveText(expectedNextSpeed, { timeout: 3_000 });
                        advanced = true;
                    } catch (err) {
                        if (attempt === 5) throw err;
                    }
                }

                currentIdx = (currentIdx + 1) % speedOrder.length;
            }

            await expect(speedBtn).toHaveText(initialSpeedText);
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
