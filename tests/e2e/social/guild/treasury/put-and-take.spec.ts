
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { testUsers } from '../../../fixtures/testUsers';
import { createCharacterViaApi, generateTestCharacterName } from '../../../fixtures/createCharacter';
import { seedGameSave, findUserIdByEmail, type ISeedBagItem } from '../../../fixtures/seedGameSave';
import { openMultiContext } from '../../../fixtures/multiContext';
import { seedGuild } from '../../../fixtures/seedGuild';
import { cleanupGuildsByLeaderIds } from '../../../fixtures/guildCleanup';
import { getAdminClient } from '../../../fixtures/adminClient';

test.describe('Social › Guild', { tag: '@guild' }, () => {
    test.describe.configure({ timeout: 180_000 });

    test('multi-context: primary deposits item -> secondary withdraws -> treasury logs show deposit + withdraw', async ({ browser }) => {
        const primaryNick = generateTestCharacterName();
        const secondaryNick = generateTestCharacterName();
        const tag = Math.random().toString(36).slice(2, 5).toUpperCase().replace(/[^A-Z0-9]/g, 'A');
        const guildName = `E2E G ${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

        const itemUuid = `treasury-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const seedItem: ISeedBagItem = {
            uuid: itemUuid,
            itemId: 'sword_of_beginnings',
            rarity: 'common',
            bonuses: {},
            itemLevel: 1,
        };
        const itemPolishName = 'Miecz Poczatku';

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
                class: 'Knight',
                overrides: { level: 10, highest_level: 10, hp_regen: 0, mp_regen: 0 },
            });
            secondaryCharId = secondaryCreated.id;

            const primaryUserId = await findUserIdByEmail(testUsers.primary.email);
            const secondaryUserId = await findUserIdByEmail(testUsers.secondary.email);
            await seedGameSave({
                characterId: primaryCharId,
                userId: primaryUserId,
                bagItems: [seedItem],
            });
            await seedGameSave({
                characterId: secondaryCharId,
                userId: secondaryUserId,
            });

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

            const navToTreasury = async (page: Page): Promise<void> => {
                await page.getByRole('button', { name: /^Społeczność$/i }).tap();
                await expect(page).toHaveURL(/\/social$/, { timeout: 10_000 });
                await page.locator('.social__tile--gildia').tap();
                await expect(page).toHaveURL(/\/guild$/, { timeout: 10_000 });
                await expect(page.locator('.guild__home-banner')).toBeVisible({ timeout: 20_000 });
                await page.locator('.guild__nav-tile-label', { hasText: /^Skarbiec$/i }).tap();
                await expect(page.locator('.guild__top-title', { hasText: /Skarbiec gildii/i }))
                    .toBeVisible({ timeout: 15_000 });
            };
            await Promise.all([
                navToTreasury(primaryPage),
                navToTreasury(secondaryPage),
            ]);

            const primaryBagCol = primaryPage.locator('.guild__treasury-col', {
                has: primaryPage.locator('.guild__treasury-title', { hasText: /Twój plecak/i }),
            });
            const primaryVaultCol = primaryPage.locator('.guild__treasury-col', {
                has: primaryPage.locator('.guild__treasury-title', { hasText: /Skarbiec gildii/i }),
            });
            const primaryBagRow = primaryBagCol.locator('.guild__treasury-row', {
                has: primaryPage.locator('.guild__treasury-name', { hasText: itemPolishName }),
            });
            await expect(primaryBagRow).toBeVisible({ timeout: 15_000 });

            await expect(primaryVaultCol.locator('.guild__treasury-empty'))
                .toBeVisible({ timeout: 5_000 });

            await primaryBagRow.locator('button', { hasText: /Włóż/ }).tap();

            await expect(primaryBagRow).toBeHidden({ timeout: 15_000 });

            const primaryVaultRow = primaryVaultCol.locator('.guild__treasury-row', {
                has: primaryPage.locator('.guild__treasury-name', { hasText: itemPolishName }),
            });
            await expect(primaryVaultRow).toBeVisible({ timeout: 15_000 });

            const secondaryVaultCol = secondaryPage.locator('.guild__treasury-col', {
                has: secondaryPage.locator('.guild__treasury-title', { hasText: /Skarbiec gildii/i }),
            });
            const secondaryBagCol = secondaryPage.locator('.guild__treasury-col', {
                has: secondaryPage.locator('.guild__treasury-title', { hasText: /Twój plecak/i }),
            });
            const secondaryVaultRow = secondaryVaultCol.locator('.guild__treasury-row', {
                has: secondaryPage.locator('.guild__treasury-name', { hasText: itemPolishName }),
            });
            await expect(secondaryVaultRow).toBeVisible({ timeout: 45_000 });

            await expect(secondaryBagCol.locator('.guild__treasury-empty'))
                .toBeVisible({ timeout: 5_000 });

            await secondaryVaultRow.locator('button', { hasText: /Wyciągnij/ }).tap();
            await expect(secondaryVaultRow).toBeHidden({ timeout: 15_000 });
            const secondaryBagRow = secondaryBagCol.locator('.guild__treasury-row', {
                has: secondaryPage.locator('.guild__treasury-name', { hasText: itemPolishName }),
            });
            await expect(secondaryBagRow).toBeVisible({ timeout: 15_000 });

            const admin = getAdminClient();
            const { data: treasuryRowsAfter } = await admin
                .from('guild_treasury_items')
                .select('id')
                .eq('guild_id', guildId);
            expect(treasuryRowsAfter ?? []).toHaveLength(0);

            const { data: logRows } = await admin
                .from('guild_treasury_logs')
                .select('action, character_id, character_name')
                .eq('guild_id', guildId);
            const logs = (logRows ?? []) as Array<{
                action: 'deposit' | 'withdraw';
                character_id: string;
                character_name: string;
            }>;
            expect(logs).toHaveLength(2);
            const depositLog = logs.find((l) => l.action === 'deposit');
            const withdrawLog = logs.find((l) => l.action === 'withdraw');
            expect(depositLog).toBeTruthy();
            expect(depositLog!.character_id).toBe(primaryCharId);
            expect(depositLog!.character_name).toBe(primaryNick);
            expect(withdrawLog).toBeTruthy();
            expect(withdrawLog!.character_id).toBe(secondaryCharId);
            expect(withdrawLog!.character_name).toBe(secondaryNick);
        } finally {
            await cleanupGuildsByLeaderIds([primaryCharId, secondaryCharId]);
            if (handles) {
                await handles.cleanup({ primaryCharId, secondaryCharId });
            }
        }
    });
});
