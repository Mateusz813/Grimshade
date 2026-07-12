
import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { seedGameSave, findUserIdByEmail } from '../../fixtures/seedGameSave';
import { openMultiContext } from '../../fixtures/multiContext';
import type { Page } from '@playwright/test';

test.describe('Social › Friends', { tag: '@social' }, () => {
    test.describe.configure({ timeout: 120_000 });

    test('multi-context: primary blocks secondary -> messages hidden; unblock -> messages visible again', async ({ browser }) => {
        const primaryNick = generateTestCharacterName();
        const secondaryNick = generateTestCharacterName();
        const tokenBefore = `E2E-BLOCK-BEFORE-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
        const tokenDuring = `E2E-BLOCK-DURING-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
        const tokenAfter = `E2E-BLOCK-AFTER-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

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

            const navToChat = async (page: Page): Promise<void> => {
                await page.getByRole('button', { name: /^Społeczność$/i }).tap();
                await expect(page).toHaveURL(/\/social$/, { timeout: 10_000 });
                await page.locator('.social__tile--czat').tap();
                await expect(page).toHaveURL(/\/chat$/, { timeout: 10_000 });
                await expect(page.locator('.global-chat__tab--active'))
                    .toContainText(/Miasto/i, { timeout: 10_000 });
                await expect(page.locator('.chat__input:visible').first())
                    .toBeVisible({ timeout: 10_000 });
            };
            await Promise.all([
                navToChat(primaryPage),
                navToChat(secondaryPage),
            ]);

            const secondaryInput = secondaryPage.locator('.chat__input:visible').first();
            const secondarySend = secondaryPage.locator('.chat__send:visible').first();

            await secondaryInput.fill(`Pre-block ${tokenBefore}`);
            await expect(secondarySend).toBeEnabled({ timeout: 5_000 });
            await secondarySend.tap();

            const beforeMsgOnPrimary = primaryPage.locator('.chat__msg', { hasText: tokenBefore });
            await expect(beforeMsgOnPrimary).toBeVisible({ timeout: 45_000 });
            await expect(beforeMsgOnPrimary).toContainText(secondaryNick);

            await beforeMsgOnPrimary.locator('.chat__msg-name').click();
            const chatMenu = primaryPage.locator('.chat__menu');
            await expect(chatMenu).toBeVisible({ timeout: 5_000 });
            await chatMenu.getByRole('button', { name: /Zablokuj gracza/i }).click();
            await expect(chatMenu).toBeHidden({ timeout: 5_000 });

            await expect(beforeMsgOnPrimary).toBeHidden({ timeout: 10_000 });

            await secondaryInput.fill(`During-block ${tokenDuring}`);
            await expect(secondarySend).toBeEnabled({ timeout: 5_000 });
            await secondarySend.tap();

            await expect(secondaryPage.locator('.chat__msg', { hasText: tokenDuring }))
                .toBeVisible({ timeout: 15_000 });

            await primaryPage.waitForTimeout(12_000);
            await expect(primaryPage.locator('.chat__msg', { hasText: tokenDuring }))
                .toHaveCount(0);

            await primaryPage.getByRole('button', { name: /^Społeczność$/i }).tap();
            await expect(primaryPage).toHaveURL(/\/social$/, { timeout: 10_000 });
            await primaryPage.locator('.social__tile--znajomi').tap();
            await expect(primaryPage).toHaveURL(/\/friends$/, { timeout: 10_000 });

            const blockedTab = primaryPage.locator('.friends__tab', { hasText: /Zablokowani/i });
            await expect(blockedTab).toContainText(/Zablokowani\s*\(1\)/, { timeout: 10_000 });
            await blockedTab.tap();

            const blockedRow = primaryPage.locator('.friends__row--blocked', {
                has: primaryPage.locator('.friends__row-name', { hasText: secondaryNick }),
            });
            await expect(blockedRow).toBeVisible({ timeout: 10_000 });

            await blockedRow.locator('.friends__action--unblock').tap();
            const confirmModal = primaryPage.locator('.friends__confirm-modal');
            await expect(confirmModal).toBeVisible({ timeout: 5_000 });
            await confirmModal.getByRole('button', { name: /^Odblokuj$/i }).tap();
            await expect(confirmModal).toBeHidden({ timeout: 5_000 });
            await expect(blockedTab).toContainText(/Zablokowani\s*\(0\)/, { timeout: 5_000 });

            await primaryPage.goto('/chat');
            await expect(primaryPage.locator('.global-chat__tab--active'))
                .toContainText(/Miasto/i, { timeout: 10_000 });
            await expect(primaryPage.locator('.chat__input:visible').first())
                .toBeVisible({ timeout: 10_000 });

            await secondaryInput.fill(`After-unblock ${tokenAfter}`);
            await expect(secondarySend).toBeEnabled({ timeout: 5_000 });
            await secondarySend.tap();

            const afterMsgOnPrimary = primaryPage.locator('.chat__msg', { hasText: tokenAfter });
            await expect(afterMsgOnPrimary).toBeVisible({ timeout: 45_000 });
            await expect(afterMsgOnPrimary).toContainText(secondaryNick);
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
