
import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { seedGameSave, findUserIdByEmail } from '../../fixtures/seedGameSave';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { seedGuild } from '../../fixtures/seedGuild';
import { cleanupGuildsByLeaderIds } from '../../fixtures/guildCleanup';

test.describe('Combat › Loch', { tag: '@combat' }, () => {
    test.describe.configure({ timeout: 120_000 });

    test('smoke: /guild -> Loch tile renders guild boss stage without errors', async ({ page }) => {
        const nick = generateTestCharacterName();
        const tag = Math.random().toString(36).slice(2, 5).toUpperCase().replace(/[^A-Z0-9]/g, 'A');
        const guildName = `E2E Loch ${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

        let createdCharId: string | null = null;
        let guildId: string | null = null;

        try {
            const created = await createCharacterViaApi({
                userEmail: testUsers.secondary.email,
                name: nick,
                class: 'Knight',
                overrides: { level: 10, highest_level: 10, hp_regen: 0, mp_regen: 0 },
            });
            createdCharId = created.id;

            const userId = await findUserIdByEmail(testUsers.secondary.email);
            await seedGameSave({ characterId: createdCharId, userId });

            const guild = await seedGuild({
                name: guildName,
                tag,
                memberCharacterIds: [createdCharId],
            });
            guildId = guild.id;

            await loginViaUI(page, testUsers.secondary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 15_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
            await expect(page.locator('.town__char-name')).toHaveText(nick, { timeout: 10_000 });

            await page.getByRole('button', { name: /^Społeczność$/i }).tap();
            await expect(page).toHaveURL(/\/social$/, { timeout: 10_000 });
            await page.locator('.social__tile--gildia').tap();
            await expect(page).toHaveURL(/\/guild$/, { timeout: 10_000 });

            await expect(page.locator('.guild__home-banner')).toBeVisible({ timeout: 20_000 });

            await page.locator('.guild__nav-tile-label', { hasText: /^Loch$/i }).tap();

            await expect(page.locator('.guild__boss-stage')).toBeVisible({ timeout: 20_000 });

            await expect(page.locator('.guild__boss-preview-img')).toBeVisible({ timeout: 10_000 });
            await expect(page.locator('.guild__boss-preview-hpbar')).toBeVisible();

            await expect(page.locator('.guild__boss-info')).toBeVisible({ timeout: 10_000 });
        } finally {
            await cleanupGuildsByLeaderIds([createdCharId]);
            if (createdCharId) {
                await cleanupCharacterById(createdCharId);
            }
            void guildId;
        }
    });
});
