
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { testUsers } from '../../../fixtures/testUsers';
import { createCharacterViaApi, generateTestCharacterName } from '../../../fixtures/createCharacter';
import { seedGameSave, findUserIdByEmail } from '../../../fixtures/seedGameSave';
import { openMultiContext } from '../../../fixtures/multiContext';
import { seedGuild } from '../../../fixtures/seedGuild';
import { cleanupGuildsByLeaderIds } from '../../../fixtures/guildCleanup';

test.describe('Social › Guild', { tag: '@guild' }, () => {
    test.describe.configure({ timeout: 120_000 });

    test('multi-context: primary writes guild chat message -> secondary receives it via Realtime', async ({ browser }) => {
        const primaryNick = generateTestCharacterName();
        const secondaryNick = generateTestCharacterName();
        const tag = Math.random().toString(36).slice(2, 5).toUpperCase().replace(/[^A-Z0-9]/g, 'A');
        const guildName = `E2E G ${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
        const message = `E2E msg ${Math.random().toString(36).slice(2, 8)}`;

        let primaryCharId: string | null = null;
        let secondaryCharId: string | null = null;
        let guildId: string | null = null;
        let handles: Awaited<ReturnType<typeof openMultiContext>> | null = null;

        try {
            const primaryCreated = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: primaryNick,
                class: 'Knight',
                overrides: { level: 10, highest_level: 10, hp_regen: 0, mp_regen: 0 },
            });
            primaryCharId = primaryCreated.id;
            const secondaryCreated = await createCharacterViaApi({
                userEmail: testUsers.secondary.email,
                name: secondaryNick,
                class: 'Mage',
                overrides: { level: 10, highest_level: 10, hp_regen: 0, mp_regen: 0 },
            });
            secondaryCharId = secondaryCreated.id;

            const primaryUserId = await findUserIdByEmail(testUsers.primary.email);
            const secondaryUserId = await findUserIdByEmail(testUsers.secondary.email);
            await seedGameSave({ characterId: primaryCharId, userId: primaryUserId });
            await seedGameSave({ characterId: secondaryCharId, userId: secondaryUserId });

            const seededGuild = await seedGuild({
                name: guildName,
                tag,
                memberCharacterIds: [primaryCharId, secondaryCharId],
            });
            guildId = seededGuild.id;

            handles = await openMultiContext(browser);
            const { primaryPage, secondaryPage } = handles;

            const pickCharacter = async (page: Page, nick: string): Promise<void> => {
                if (!page.url().endsWith('/character-select')) {
                    await page.goto('/character-select');
                }
                await expect(page.locator('.char-select__card-name', { hasText: nick }))
                    .toBeVisible({ timeout: 15_000 });
                const card = page.locator('.char-select__card', {
                    has: page.locator('.char-select__card-name', { hasText: nick }),
                });
                await card.getByRole('button', { name: /Wybierz/i }).tap();
                await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
                await expect(page.locator('.town__char-name')).toHaveText(nick);
            };
            await Promise.all([
                pickCharacter(primaryPage, primaryNick),
                pickCharacter(secondaryPage, secondaryNick),
            ]);

            const navToGuildHome = async (page: Page): Promise<void> => {
                await page.getByRole('button', { name: /^Społeczność$/i }).tap();
                await expect(page).toHaveURL(/\/social$/, { timeout: 10_000 });
                await page.locator('.social__tile--gildia').tap();
                await expect(page).toHaveURL(/\/guild$/, { timeout: 10_000 });
                await expect(page.locator('.guild__home-banner')).toBeVisible({ timeout: 20_000 });
                await expect(page.locator('.guild__home-name')).toContainText(guildName);
            };
            await Promise.all([
                navToGuildHome(primaryPage),
                navToGuildHome(secondaryPage),
            ]);

            const primaryChat = primaryPage.locator('.guild__chat .chat');
            const secondaryChat = secondaryPage.locator('.guild__chat .chat');
            await expect(primaryChat).toBeVisible({ timeout: 15_000 });
            await expect(secondaryChat).toBeVisible({ timeout: 15_000 });

            const primaryInput = primaryChat.locator('.chat__input');
            const primarySend = primaryChat.locator('.chat__send');
            await primaryInput.fill(message);
            await expect(primarySend).toBeEnabled();
            await primarySend.tap();

            await expect(primaryChat.locator('.chat__msg-text', { hasText: message }))
                .toBeVisible({ timeout: 10_000 });

            await expect(secondaryChat.locator('.chat__msg-text', { hasText: message }))
                .toBeVisible({ timeout: 45_000 });

            await expect(secondaryChat.locator('.chat__msg-name', { hasText: primaryNick }))
                .toBeVisible({ timeout: 10_000 });
        } finally {
            const channels = guildId ? [`guild_${guildId}`] : [];
            await cleanupGuildsByLeaderIds([primaryCharId, secondaryCharId], channels);
            if (handles) {
                await handles.cleanup({ primaryCharId, secondaryCharId });
            }
        }
    });
});
