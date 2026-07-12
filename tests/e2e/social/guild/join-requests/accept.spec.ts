
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { testUsers } from '../../../fixtures/testUsers';
import { createCharacterViaApi, generateTestCharacterName } from '../../../fixtures/createCharacter';
import { seedGameSave, findUserIdByEmail } from '../../../fixtures/seedGameSave';
import { openMultiContext } from '../../../fixtures/multiContext';
import { cleanupGuildsByLeaderIds } from '../../../fixtures/guildCleanup';

test.describe('Social › Guild', { tag: '@guild' }, () => {
    test.describe.configure({ timeout: 120_000 });

    test('multi-context: primary founds guild -> secondary applies -> primary accepts -> both rosters show 2 members', async ({ browser }) => {
        const primaryNick = generateTestCharacterName();
        const secondaryNick = generateTestCharacterName();
        const tag = Math.random().toString(36).slice(2, 5).toUpperCase().replace(/[^A-Z0-9]/g, 'A');
        const guildName = `E2E G ${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

        let primaryCharId: string | null = null;
        let secondaryCharId: string | null = null;
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
            await seedGameSave({
                characterId: primaryCharId,
                userId: primaryUserId,
                gold: 2_000_000,
            });
            await seedGameSave({
                characterId: secondaryCharId,
                userId: secondaryUserId,
            });

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

            const navToGuild = async (page: Page): Promise<void> => {
                await page.getByRole('button', { name: /^Społeczność$/i }).tap();
                await expect(page).toHaveURL(/\/social$/, { timeout: 10_000 });
                await page.locator('.social__tile--gildia').tap();
                await expect(page).toHaveURL(/\/guild$/, { timeout: 10_000 });
            };
            await Promise.all([
                navToGuild(primaryPage),
                navToGuild(secondaryPage),
            ]);

            await expect(primaryPage.locator('.guild__list-create')).toBeVisible({ timeout: 15_000 });
            await primaryPage.locator('.guild__list-create').tap();
            await expect(primaryPage.locator('.guild__modal-title', { hasText: /Stwórz gildię/i }))
                .toBeVisible({ timeout: 5_000 });
            await primaryPage.locator('#guild-name').fill(guildName);
            await primaryPage.locator('#guild-tag').fill(tag);
            const primarySubmit = primaryPage.locator('.guild__btn-primary', { hasText: /Stwórz gildię/i });
            await expect(primarySubmit).toBeEnabled({ timeout: 10_000 });
            await primarySubmit.tap();

            await expect(primaryPage.locator('.guild__home-banner')).toBeVisible({ timeout: 15_000 });
            await expect(primaryPage.locator('.guild__home-name')).toContainText(guildName);

            await secondaryPage.goto('/guild');
            await expect(secondaryPage.locator('.guild__list-create')).toBeVisible({ timeout: 15_000 });

            const guildRow = secondaryPage.locator('.guild__list-row', {
                has: secondaryPage.locator('.guild__list-name', { hasText: guildName }),
            });
            await expect(guildRow).toBeVisible({ timeout: 15_000 });

            await guildRow.locator('.guild__list-apply').tap();
            await expect(secondaryPage.locator('.guild__modal-title', { hasText: /Aplikuj do gildii/i }))
                .toBeVisible({ timeout: 5_000 });
            const applyBtn = secondaryPage.locator('.guild__btn-primary', { hasText: /^Aplikuj$/i });
            await expect(applyBtn).toBeEnabled({ timeout: 10_000 });
            await applyBtn.tap();
            await expect(secondaryPage.locator('.guild__modal-title', { hasText: /Aplikuj do gildii/i }))
                .toBeHidden({ timeout: 10_000 });

            const requestsTile = primaryPage.locator('.guild__nav-tile-label', { hasText: /Prośby/i });
            await expect(requestsTile).toContainText(/\(1\)/, { timeout: 45_000 });
            await requestsTile.tap();

            const requestRow = primaryPage.locator('.guild__request-row', {
                has: primaryPage.locator('.guild__member-name', { hasText: secondaryNick }),
            });
            await expect(requestRow).toBeVisible({ timeout: 10_000 });
            const acceptBtn = requestRow.locator('.guild__btn-ok', { hasText: /Przyjmij/i });
            await expect(acceptBtn).toBeEnabled();
            await acceptBtn.tap();
            await expect(requestRow).toBeHidden({ timeout: 15_000 });

            await primaryPage.locator('.guild__nav-back', { hasText: /Gildia/i }).tap();
            await expect(primaryPage.locator('.guild__home-banner')).toBeVisible({ timeout: 10_000 });
            await expect(primaryPage.locator('.guild__home-level'))
                .toContainText(/Członkowie 2\/\d+/i, { timeout: 20_000 });
            await expect(primaryPage.locator('.guild__member-name', { hasText: secondaryNick }))
                .toBeVisible({ timeout: 15_000 });

            await secondaryPage.goto('/guild');
            await expect(secondaryPage.locator('.guild__home-banner')).toBeVisible({ timeout: 20_000 });
            await expect(secondaryPage.locator('.guild__home-name')).toContainText(guildName);
            await expect(secondaryPage.locator('.guild__home-level'))
                .toContainText(/Członkowie 2\/\d+/i, { timeout: 15_000 });
        } finally {
            await cleanupGuildsByLeaderIds([primaryCharId, secondaryCharId]);
            if (handles) {
                await handles.cleanup({ primaryCharId, secondaryCharId });
            }
        }
    });
});
