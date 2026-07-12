
import { test, expect, type Page } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { openMultiContext } from '../../fixtures/multiContext';

const pickCharacterAndEnterTown = async (page: Page, nick: string): Promise<void> => {
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

const navToParty = async (page: Page): Promise<void> => {
    await page.getByRole('button', { name: /^Społeczność$/i }).tap();
    await expect(page).toHaveURL(/\/social$/, { timeout: 10_000 });
    await page.locator('.social__tile--party').tap();
    await expect(page).toHaveURL(/\/party$/, { timeout: 10_000 });
    await expect(page.locator('.party__intro-title, .party__roster').first())
        .toBeVisible({ timeout: 15_000 });
};

const readLastCombatEndAt = async (page: Page): Promise<number> => {
    return await page.evaluate(async (): Promise<number> => {
        const mod = await import('/src/stores/partyCombatSyncStore.ts');
        const state = (mod as {
            usePartyCombatSyncStore: { getState: () => { lastCombatEndAt: number } };
        }).usePartyCombatSyncStore.getState();
        return state.lastCombatEndAt;
    });
};

const readCombatPhase = async (page: Page): Promise<string> => {
    return await page.evaluate(async (): Promise<string> => {
        const mod = await import('/src/stores/combatStore.ts');
        return (mod as {
            useCombatStore: { getState: () => { phase: string } };
        }).useCombatStore.getState().phase;
    });
};

test.describe('Combat › Flee', { tag: '@combat' }, () => {
    test.describe.configure({ timeout: 180_000 });

    test('party leader stopCombat() publishes combat-end -> secondary receives broadcast', async ({ browser }) => {
        const primaryNick = generateTestCharacterName();
        const secondaryNick = generateTestCharacterName();
        const partyName = `Flee ${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

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

            handles = await openMultiContext(browser);
            const { primaryPage, secondaryPage } = handles;

            await Promise.all([
                pickCharacterAndEnterTown(primaryPage, primaryNick),
                pickCharacterAndEnterTown(secondaryPage, secondaryNick),
            ]);

            await Promise.all([
                navToParty(primaryPage),
                navToParty(secondaryPage),
            ]);

            await primaryPage
                .locator('.party__primary-btn', { hasText: /Stwórz nowe party/i })
                .tap();
            await expect(primaryPage.locator('.party__create-form'))
                .toBeVisible({ timeout: 5_000 });
            await primaryPage.locator('.party__field', { hasText: /Nazwa party/i })
                .locator('input').fill(partyName);
            const primarySubmitBtn = primaryPage.locator('.party__form-actions')
                .getByRole('button', { name: /^Utwórz$/i });
            await expect(primarySubmitBtn).toBeEnabled({ timeout: 10_000 });
            await primarySubmitBtn.tap();
            await expect(primaryPage.locator('.party__roster')).toBeVisible({ timeout: 15_000 });

            await secondaryPage.locator('.party__refresh-btn').tap();
            const partyCard = secondaryPage.locator('.party__card', {
                has: secondaryPage.locator('.party__card-name', { hasText: partyName }),
            });
            await expect(partyCard).toBeVisible({ timeout: 15_000 });
            const joinBtn = partyCard.locator('.party__primary-btn', { hasText: /^Dołącz$/i });
            await expect(joinBtn).toBeEnabled({ timeout: 10_000 });
            await joinBtn.tap();

            await expect(primaryPage.locator('.party__roster-meta'))
                .toContainText(/2\/4\s+graczy/i, { timeout: 45_000 });
            await expect(secondaryPage.locator('.party__roster-meta'))
                .toContainText(/2\/4\s+graczy/i, { timeout: 45_000 });

            await expect.poll(
                async () => {
                    return await secondaryPage.evaluate(async () => {
                        const mod = await import('/src/stores/partyCombatSyncStore.ts');
                        const state = (mod as {
                            usePartyCombatSyncStore: { getState: () => { partyId: string | null } };
                        }).usePartyCombatSyncStore.getState();
                        return state.partyId;
                    });
                },
                {
                    timeout: 45_000,
                    message: 'Waiting for secondary to subscribe to party-combat channel',
                },
            ).not.toBeNull();

            const preLastCombatEndAt = await readLastCombatEndAt(secondaryPage);

            await primaryPage.evaluate(async () => {
                const engineMod = await import('/src/systems/combatEngine.ts');
                const combatMod = await import('/src/stores/combatStore.ts');
                const engine = engineMod as { getAllMonsters: () => Array<{ id: string }> };
                const useCombatStore = (combatMod as {
                    useCombatStore: {
                        getState: () => {
                            initCombat: (m: unknown, hp: number, mp: number, rarity?: string) => void;
                        };
                    };
                }).useCombatStore;
                const rat = engine.getAllMonsters().find((m) => m.id === 'rat');
                if (!rat) throw new Error('[stage fight] rat monster not found');
                useCombatStore.getState().initCombat(rat, 120, 30, 'normal');
            });

            expect(await readCombatPhase(primaryPage)).toBe('fighting');

            await primaryPage.evaluate(async () => {
                const engineMod = await import('/src/systems/combatEngine.ts');
                const engine = engineMod as { stopCombat: () => void };
                engine.stopCombat();
            });

            await expect.poll(
                async () => {
                    const cur = await readLastCombatEndAt(secondaryPage);
                    return cur > preLastCombatEndAt;
                },
                {
                    timeout: 45_000,
                    message: `Waiting for secondary lastCombatEndAt to advance past ${preLastCombatEndAt}`,
                },
            ).toBe(true);

            expect(await readCombatPhase(primaryPage)).toBe('idle');
        } finally {
            if (handles) {
                await handles.cleanup({ primaryCharId, secondaryCharId });
            } else {
                const { cleanupCharacterById } = await import('../../fixtures/cleanup');
                const { getAdminClient } = await import('../../fixtures/adminClient');
                const idsToWipe = [primaryCharId, secondaryCharId].filter(
                    (id): id is string => id !== null,
                );
                if (idsToWipe.length > 0) {
                    try {
                        const admin = getAdminClient();
                        const idList = idsToWipe.map((id) => `"${id}"`).join(',');
                        await admin.from('parties').delete().or(`leader_id.in.(${idList})`);
                    } catch { }
                    await Promise.all(idsToWipe.map((id) => cleanupCharacterById(id)));
                }
            }
        }
    });
});
