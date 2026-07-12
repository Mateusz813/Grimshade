
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { testUsers } from '../../../fixtures/testUsers';
import { createCharacterViaApi, generateTestCharacterName } from '../../../fixtures/createCharacter';
import { seedGameSave, findUserIdByEmail } from '../../../fixtures/seedGameSave';
import { openMultiContext } from '../../../fixtures/multiContext';
import { seedGuild } from '../../../fixtures/seedGuild';
import { cleanupGuildsByLeaderIds } from '../../../fixtures/guildCleanup';
import { getAdminClient } from '../../../fixtures/adminClient';

test.describe('Social › Guild', { tag: '@guild' }, () => {
    test.describe.configure({ timeout: 180_000 });

    test('multi-context: 2 members deal boss damage -> both rows in guild_boss_contributions', async ({ browser }) => {
        const primaryNick = generateTestCharacterName();
        const secondaryNick = generateTestCharacterName();
        const tag = Math.random().toString(36).slice(2, 5).toUpperCase().replace(/[^A-Z0-9]/g, 'A');
        const guildName = `E2E G ${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

        const primaryDamage = 50_000;
        const secondaryDamage = 30_000;

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

            const navToBoss = async (page: Page): Promise<void> => {
                await page.getByRole('button', { name: /^Społeczność$/i }).tap();
                await expect(page).toHaveURL(/\/social$/, { timeout: 10_000 });
                await page.locator('.social__tile--gildia').tap();
                await expect(page).toHaveURL(/\/guild$/, { timeout: 10_000 });
                await expect(page.locator('.guild__home-banner')).toBeVisible({ timeout: 20_000 });
                await page.locator('.guild__nav-tile-label', { hasText: /^Loch$/i }).tap();
                await expect(page.locator('.guild__boss-stage'))
                    .toBeVisible({ timeout: 20_000 });
            };
            await Promise.all([
                navToBoss(primaryPage),
                navToBoss(secondaryPage),
            ]);

            const driveDamage = async (
                page: Page,
                guildIdLocal: string,
                charId: string,
                charName: string,
                damage: number,
            ): Promise<void> => {
                await page.evaluate(async ({ guildIdLocal, charId, charName, damage }) => {
                    const guildMod = await import('/src/api/v1/guildApi.ts');
                    const guildSysMod = await import('/src/systems/guildSystem.ts');
                    const guildApi = (guildMod as {
                        guildApi: {
                            fetchOrCreateWeeklyBoss: (p: { guildId: string; bossTier: number }) => Promise<{ week_start: string; boss_current_hp: number }>;
                            applyBossDamage: (p: { guildId: string; weekStart: string; damage: number }) => Promise<unknown>;
                            addContribution: (p: { guildId: string; characterId: string; weekStart: string; damageAdd: number }) => Promise<unknown>;
                            logAttempt: (p: { guildId: string; characterId: string; characterName: string; damageDealt: number }) => Promise<unknown>;
                        };
                    }).guildApi;
                    const clampGuildBossTier = (guildSysMod as {
                        clampGuildBossTier: (t: number) => number;
                    }).clampGuildBossTier;
                    const boss = await guildApi.fetchOrCreateWeeklyBoss({
                        guildId: guildIdLocal,
                        bossTier: clampGuildBossTier(1),
                    });
                    await guildApi.applyBossDamage({
                        guildId: guildIdLocal,
                        weekStart: boss.week_start,
                        damage,
                    });
                    await guildApi.addContribution({
                        guildId: guildIdLocal,
                        characterId: charId,
                        weekStart: boss.week_start,
                        damageAdd: damage,
                    });
                    await guildApi.logAttempt({
                        guildId: guildIdLocal,
                        characterId: charId,
                        characterName: charName,
                        damageDealt: damage,
                    });
                }, { guildIdLocal, charId, charName, damage });
            };

            await driveDamage(primaryPage, guildId, primaryCharId, primaryNick, primaryDamage);
            await driveDamage(secondaryPage, guildId, secondaryCharId, secondaryNick, secondaryDamage);

            const admin = getAdminClient();
            const { data: contribRows, error: contribErr } = await admin
                .from('guild_boss_contributions')
                .select('character_id, total_damage')
                .eq('guild_id', guildId);
            expect(contribErr).toBeNull();
            const contribs = (contribRows ?? []) as Array<{
                character_id: string;
                total_damage: number;
            }>;
            expect(contribs).toHaveLength(2);
            const primaryContrib = contribs.find((c) => c.character_id === primaryCharId);
            const secondaryContrib = contribs.find((c) => c.character_id === secondaryCharId);
            expect(primaryContrib).toBeTruthy();
            expect(primaryContrib!.total_damage).toBe(primaryDamage);
            expect(secondaryContrib).toBeTruthy();
            expect(secondaryContrib!.total_damage).toBe(secondaryDamage);

            const { data: bossRows } = await admin
                .from('guild_boss_state')
                .select('boss_max_hp, boss_current_hp')
                .eq('guild_id', guildId);
            expect(bossRows ?? []).toHaveLength(1);
            const bossState = bossRows![0] as { boss_max_hp: number; boss_current_hp: number };
            const expectedHpAfter = bossState.boss_max_hp - primaryDamage - secondaryDamage;
            expect(bossState.boss_current_hp).toBe(expectedHpAfter);

            const { data: attemptRows } = await admin
                .from('guild_boss_attempts')
                .select('character_id, damage_dealt')
                .eq('guild_id', guildId);
            const attempts = (attemptRows ?? []) as Array<{
                character_id: string;
                damage_dealt: number;
            }>;
            expect(attempts).toHaveLength(2);
            const primaryAttempt = attempts.find((a) => a.character_id === primaryCharId);
            const secondaryAttempt = attempts.find((a) => a.character_id === secondaryCharId);
            expect(primaryAttempt?.damage_dealt).toBe(primaryDamage);
            expect(secondaryAttempt?.damage_dealt).toBe(secondaryDamage);

            const verifyOwnContribUI = async (page: Page, expectedDmg: number): Promise<void> => {
                await page.goto('/guild');
                await expect(page.locator('.guild__home-banner')).toBeVisible({ timeout: 15_000 });
                await page.locator('.guild__nav-tile-label', { hasText: /^Loch$/i }).tap();
                await expect(page.locator('.guild__boss-info')).toBeVisible({ timeout: 20_000 });
                const expectedFmt = expectedDmg.toLocaleString('pl-PL');
                await expect(page.locator('.guild__boss-info'))
                    .toContainText(expectedFmt, { timeout: 10_000 });
            };
            await verifyOwnContribUI(primaryPage, primaryDamage);
            await verifyOwnContribUI(secondaryPage, secondaryDamage);
        } finally {
            await cleanupGuildsByLeaderIds([primaryCharId, secondaryCharId]);
            if (handles) {
                await handles.cleanup({ primaryCharId, secondaryCharId });
            }
        }
    });
});
