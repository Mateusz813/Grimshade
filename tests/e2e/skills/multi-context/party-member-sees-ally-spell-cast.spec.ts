
import { test, expect, type Page } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { seedGameSave, findUserIdByEmail } from '../../fixtures/seedGameSave';
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

const readActiveCharacterId = async (page: Page): Promise<string> => {
    const id = await page.evaluate(async () => {
        const mod = await import('/src/stores/characterStore.ts');
        const useCharacterStore = (mod as { useCharacterStore: { getState: () => { character: { id: string } | null } } }).useCharacterStore;
        return useCharacterStore.getState().character?.id ?? '';
    });
    if (!id) throw new Error('[party-member-sees-ally-spell-cast] activeCharacterId is empty — character not hydrated yet');
    return id;
};

const publishSpellCastFromPage = async (
    page: Page,
    args: { casterId: string; casterName: string; skillId: string; label: string; targetIdx: number; isDamageHit: boolean },
): Promise<void> => {
    await page.evaluate(async (a) => {
        const mod = await import('/src/stores/partyCombatSyncStore.ts');
        const usePartyCombatSyncStore = (mod as {
            usePartyCombatSyncStore: { getState: () => { publishSpellCast: (cast: typeof a) => void } };
        }).usePartyCombatSyncStore;
        usePartyCombatSyncStore.getState().publishSpellCast(a);
    }, args);
};

const waitForReceivedSpellCast = async (
    page: Page,
    args: { casterId: string; expectedSkillId: string; timeoutMs?: number },
): Promise<{ casterId: string; skillId: string }> => {
    const timeoutMs = args.timeoutMs ?? 45_000;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const got = await page.evaluate(async (a) => {
            const mod = await import('/src/stores/partyCombatSyncStore.ts');
            const usePartyCombatSyncStore = (mod as {
                usePartyCombatSyncStore: { getState: () => { lastSpellByCaster: Record<string, { casterId: string; skillId: string }> } };
            }).usePartyCombatSyncStore;
            return usePartyCombatSyncStore.getState().lastSpellByCaster[a.casterId] ?? null;
        }, args);
        if (got && got.skillId === args.expectedSkillId) return got;
        await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(
        `[waitForReceivedSpellCast] timeout after ${timeoutMs}ms — never received spell-cast for casterId=${args.casterId} skillId=${args.expectedSkillId}`,
    );
};

test.describe('Skills › Animations', { tag: '@skills' }, () => {
    test.describe.configure({ timeout: 120_000 });

    test('multi-context: party member receives ally `spell-cast` Realtime cue (both directions)', async ({ browser }) => {
        const primaryNick = generateTestCharacterName();
        const secondaryNick = generateTestCharacterName();
        const partyName = `SkillAnim ${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

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
            await seedGameSave({ characterId: primaryCharId, userId: primaryUserId });
            await seedGameSave({ characterId: secondaryCharId, userId: secondaryUserId });

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
            await expect(primaryPage.locator('.party__roster-meta'))
                .toContainText(/1\/4\s+graczy/i);

            await secondaryPage.locator('.party__refresh-btn').tap();
            const partyCard = secondaryPage.locator('.party__card', {
                has: secondaryPage.locator('.party__card-name', { hasText: partyName }),
            });
            await expect(partyCard).toBeVisible({ timeout: 15_000 });
            const joinBtn = partyCard.locator('.party__primary-btn', { hasText: /^Dołącz$/i });
            await expect(joinBtn).toBeEnabled({ timeout: 10_000 });
            await joinBtn.tap();

            await expect(secondaryPage.locator('.party__roster-meta'))
                .toContainText(/2\/4\s+graczy/i, { timeout: 45_000 });
            await expect(primaryPage.locator('.party__roster-meta'))
                .toContainText(/2\/4\s+graczy/i, { timeout: 45_000 });

            await primaryPage.waitForTimeout(1_000);

            const primaryActiveId = await readActiveCharacterId(primaryPage);
            const secondaryActiveId = await readActiveCharacterId(secondaryPage);
            expect(primaryActiveId).toBe(primaryCharId);
            expect(secondaryActiveId).toBe(secondaryCharId);

            await publishSpellCastFromPage(primaryPage, {
                casterId: primaryActiveId,
                casterName: primaryNick,
                skillId: 'fireball',
                label: 'Kula Ognia',
                targetIdx: 0,
                isDamageHit: true,
            });

            const receivedA = await waitForReceivedSpellCast(secondaryPage, {
                casterId: primaryActiveId,
                expectedSkillId: 'fireball',
                timeoutMs: 45_000,
            });
            expect(receivedA.skillId).toBe('fireball');
            expect(receivedA.casterId).toBe(primaryActiveId);

            await publishSpellCastFromPage(secondaryPage, {
                casterId: secondaryActiveId,
                casterName: secondaryNick,
                skillId: 'shield_bash',
                label: 'Uderzenie Tarczą',
                targetIdx: 0,
                isDamageHit: true,
            });

            const receivedB = await waitForReceivedSpellCast(primaryPage, {
                casterId: secondaryActiveId,
                expectedSkillId: 'shield_bash',
                timeoutMs: 45_000,
            });
            expect(receivedB.skillId).toBe('shield_bash');
            expect(receivedB.casterId).toBe(secondaryActiveId);
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
