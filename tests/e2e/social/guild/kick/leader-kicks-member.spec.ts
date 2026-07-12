
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

    test('multi-context: leader kicks member -> secondary loses guild membership + primary roster shrinks to 1', async ({ browser }) => {
        const primaryNick = generateTestCharacterName();
        const secondaryNick = generateTestCharacterName();
        const tag = Math.random().toString(36).slice(2, 5).toUpperCase().replace(/[^A-Z0-9]/g, 'A');
        const guildName = `E2E G ${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

        let primaryCharId: string | null = null;
        let secondaryCharId: string | null = null;
        let _guildId: string | null = null;
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
            _guildId = seededGuild.id;

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

            await expect(primaryPage.locator('.guild__home-level'))
                .toContainText(/Członkowie 2\/\d+/i, { timeout: 15_000 });
            const secondaryRowInPrimary = primaryPage.locator('.guild__member-row', {
                has: primaryPage.locator('.guild__member-name', { hasText: secondaryNick }),
            });
            await expect(secondaryRowInPrimary).toBeVisible();
            const kickBtn = secondaryRowInPrimary.locator('.guild__member-kick');
            await expect(kickBtn).toBeVisible();

            await kickBtn.tap();
            await expect(primaryPage.locator('.guild__modal-title', { hasText: /Wyrzuć gracza/i }))
                .toBeVisible({ timeout: 5_000 });
            const confirmKick = primaryPage.locator('.guild__btn-danger', { hasText: /^Wyrzuć$/i });
            await expect(confirmKick).toBeEnabled();
            await confirmKick.tap();

            await expect(primaryPage.locator('.guild__modal-title', { hasText: /Wyrzuć gracza/i }))
                .toBeHidden({ timeout: 10_000 });

            try {
                await expect(secondaryRowInPrimary).toBeHidden({ timeout: 45_000 });
                await expect(primaryPage.locator('.guild__home-level'))
                    .toContainText(/Członkowie 1\/\d+/i, { timeout: 5_000 });
            } catch {
                await primaryPage.goto('/guild');
                await expect(primaryPage.locator('.guild__home-banner')).toBeVisible({ timeout: 15_000 });
                await expect(secondaryRowInPrimary).toBeHidden({ timeout: 20_000 });
                await expect(primaryPage.locator('.guild__home-level'))
                    .toContainText(/Członkowie 1\/\d+/i, { timeout: 20_000 });
            }

            await secondaryPage.goto('/guild');
            await expect(secondaryPage.locator('.guild__list-create'))
                .toBeVisible({ timeout: 20_000 });
            await expect(secondaryPage.locator('.guild__home-banner'))
                .toBeHidden({ timeout: 10_000 });
        } finally {
            await cleanupGuildsByLeaderIds([primaryCharId, secondaryCharId]);
            if (handles) {
                await handles.cleanup({ primaryCharId, secondaryCharId });
            }
        }
    });
});
