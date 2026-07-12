
import { test, expect, type Page } from '@playwright/test';
import { testUsers } from '../../../fixtures/testUsers';
import { createCharacterViaApi, generateTestCharacterName } from '../../../fixtures/createCharacter';
import { seedGameSave, findUserIdByEmail } from '../../../fixtures/seedGameSave';
import { openMultiContext } from '../../../fixtures/multiContext';

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

test.describe('Social › Party › Elixirs', { tag: '@party' }, () => {
    test.describe.configure({ timeout: 180_000 });

    test('primary hp_pct_25 buff -> secondary sees primary boosted HP in Town party row via usePartyPresence broadcast', async ({ browser }) => {
        const primaryNick = generateTestCharacterName();
        const secondaryNick = generateTestCharacterName();
        const partyName = `Pres ${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

        let primaryCharId: string | null = null;
        let secondaryCharId: string | null = null;
        let handles: Awaited<ReturnType<typeof openMultiContext>> | null = null;

        try {
            const primaryCreated = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: primaryNick,
                class: 'Knight',
                overrides: { hp: 40, mp: 15, level: 10, highest_level: 10, hp_regen: 0, mp_regen: 0 },
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
                buffs: [
                    {
                        id: 'hp_pct_25',
                        name: 'Max HP +25%',
                        icon: 'heart-on-fire',
                        effect: 'hp_pct_25',
                    },
                ],
            });
            await seedGameSave({
                characterId: secondaryCharId,
                userId: secondaryUserId,
            });

            handles = await openMultiContext(browser);
            const { primaryPage, secondaryPage } = handles;

            await Promise.all([
                pickCharacterAndEnterTown(primaryPage, primaryNick),
                pickCharacterAndEnterTown(secondaryPage, secondaryNick),
            ]);

            const hasBuffPrimary = await primaryPage.evaluate(async () => {
                const mod = await import('/src/stores/buffStore.ts');
                return (mod as {
                    useBuffStore: { getState: () => { hasBuff: (e: string) => boolean } };
                }).useBuffStore.getState().hasBuff('hp_pct_25');
            });
            expect(hasBuffPrimary).toBe(true);

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

            await Promise.all([
                primaryPage.getByRole('button', { name: /^Miasto$/i }).tap(),
                secondaryPage.getByRole('button', { name: /^Miasto$/i }).tap(),
            ]);
            await expect(primaryPage).toHaveURL(/\/$/, { timeout: 10_000 });
            await expect(secondaryPage).toHaveURL(/\/$/, { timeout: 10_000 });
            await expect(primaryPage.locator('.town__char-name')).toHaveText(primaryNick, { timeout: 10_000 });
            await expect(secondaryPage.locator('.town__char-name')).toHaveText(secondaryNick, { timeout: 10_000 });

            const stripHeader = secondaryPage.locator('.town__party-strip-header');
            await expect(stripHeader).toBeVisible({ timeout: 10_000 });
            await stripHeader.tap();
            await expect(secondaryPage.locator('.town__party-strip--expanded'))
                .toBeVisible({ timeout: 5_000 });

            const primaryRow = secondaryPage.locator('.town__party-row', {
                has: secondaryPage.locator('.town__party-row-name', { hasText: primaryNick }),
            });
            await expect(primaryRow).toBeVisible({ timeout: 45_000 });
            const hpText = primaryRow.locator('.town__party-hp-text');
            await expect(hpText).toHaveText('40/377', { timeout: 45_000 });

            const presenceMaxHp = await secondaryPage.evaluate(async (charId) => {
                const mod = await import('/src/stores/partyPresenceStore.ts');
                const store = (mod as {
                    usePartyPresenceStore: { getState: () => { byMember: Record<string, { maxHp: number }> } };
                }).usePartyPresenceStore.getState();
                return store.byMember[charId]?.maxHp ?? null;
            }, primaryCharId);
            expect(presenceMaxHp).toBe(377);
        } finally {
            if (handles) {
                await handles.cleanup({ primaryCharId, secondaryCharId });
            }
        }
    });
});
