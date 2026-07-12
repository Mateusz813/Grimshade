
import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { seedGameSave, findUserIdByEmail } from '../../fixtures/seedGameSave';
import { openMultiContext } from '../../fixtures/multiContext';
import type { Page } from '@playwright/test';

test.describe('Social › Friends', { tag: '@social' }, () => {
    test.describe.configure({ timeout: 120_000 });

    test('multi-context: primary types secondary nick -> searches -> adds friend via UI', async ({ browser }) => {
        const primaryNick = generateTestCharacterName();
        const secondaryNick = generateTestCharacterName();

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

            await primaryPage.getByRole('button', { name: /^Społeczność$/i }).tap();
            await expect(primaryPage).toHaveURL(/\/social$/, { timeout: 10_000 });
            await primaryPage.locator('.social__tile--znajomi').tap();
            await expect(primaryPage).toHaveURL(/\/friends$/, { timeout: 10_000 });

            const friendsTab = primaryPage.locator('.friends__tab--active');
            await expect(friendsTab).toBeVisible({ timeout: 10_000 });
            await expect(friendsTab).toContainText(/Znajomi\s*\(0\)/, { timeout: 10_000 });

            const searchInput = primaryPage.locator('.friends__add-input');
            await searchInput.tap();
            await searchInput.fill(secondaryNick);
            const searchBtn = primaryPage.locator('.friends__add-btn');
            await expect(searchBtn).toBeEnabled();
            await searchBtn.tap();

            const lookupResult = primaryPage.locator('.friends__lookup-result');
            await expect(lookupResult).toBeVisible({ timeout: 10_000 });
            await expect(lookupResult.locator('.friends__lookup-name'))
                .toHaveText(secondaryNick);
            await expect(lookupResult.locator('.friends__lookup-meta'))
                .toContainText(/Lv\s*10/i);
            await expect(lookupResult.locator('.friends__lookup-meta'))
                .toContainText(/Mage/i);

            const addBtn = lookupResult.locator('.friends__lookup-add');
            await expect(addBtn).toBeVisible();
            await addBtn.tap();

            await expect(lookupResult).toBeHidden({ timeout: 5_000 });

            await expect(friendsTab).toContainText(/Znajomi\s*\(1\)/, { timeout: 10_000 });

            const friendRow = primaryPage.locator('.friends__row', {
                has: primaryPage.locator('.friends__row-name', { hasText: secondaryNick }),
            });
            await expect(friendRow).toBeVisible({ timeout: 10_000 });
            await expect(friendRow.locator('.friends__action--pm')).toBeVisible();
            await expect(friendRow.locator('.friends__action--block')).toBeVisible();
            await expect(friendRow.locator('.friends__action--remove')).toBeVisible();
        } finally {
            if (handles) {
                await handles.cleanup({ primaryCharId, secondaryCharId });
            } else {
                const { cleanupCharacterById } = await import('../../fixtures/cleanup');
                const idsToWipe = [primaryCharId, secondaryCharId].filter(
                    (id): id is string => id !== null,
                );
                if (idsToWipe.length > 0) {
                    await Promise.all(idsToWipe.map((id) => cleanupCharacterById(id)));
                }
            }
        }
    });
});
