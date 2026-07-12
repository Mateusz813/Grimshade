
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { testUsers } from '../fixtures/testUsers';
import { createCharacterViaApi, generateTestCharacterName } from '../fixtures/createCharacter';
import { seedGameSave, findUserIdByEmail } from '../fixtures/seedGameSave';
import { openMultiContext } from '../fixtures/multiContext';

test.describe('Realtime › Reconnect', { tag: '@realtime' }, () => {
    test.describe.configure({ timeout: 180_000 });

    test('multi-context: secondary page.reload mid-chat -> still receives subsequent primary message via Realtime', async ({ browser }) => {
        const primaryNick = generateTestCharacterName();
        const secondaryNick = generateTestCharacterName();
        const tokenBefore = `E2E-RC-PRE-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
        const tokenAfter = `E2E-RC-POST-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
        const messageBefore = `Reconnect test ${tokenBefore} (pre-reload)`;
        const messageAfter = `Reconnect test ${tokenAfter} (post-reload)`;

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

            const sendInChat = async (page: Page, text: string): Promise<void> => {
                const input = page.locator('.chat__input:visible').first();
                const send = page.locator('.chat__send:visible').first();
                await input.fill(text);
                await expect(send).toBeEnabled({ timeout: 5_000 });
                await send.tap();
            };

            await sendInChat(primaryPage, messageBefore);

            await expect(primaryPage.locator('.chat__msg', { hasText: tokenBefore }))
                .toBeVisible({ timeout: 15_000 });

            await expect(secondaryPage.locator('.chat__msg', { hasText: tokenBefore }))
                .toBeVisible({ timeout: 45_000 });

            await secondaryPage.reload({ waitUntil: 'load' });

            const postReloadUrl = secondaryPage.url();
            if (/\/character-select/.test(postReloadUrl)) {
                await pickCharacter(secondaryPage, secondaryNick);
                await secondaryPage.goto('/chat');
            }

            await expect(secondaryPage).toHaveURL(/\/chat$/, { timeout: 25_000 });
            await expect(secondaryPage.locator('.global-chat__tab--active'))
                .toContainText(/Miasto/i, { timeout: 15_000 });
            await expect(secondaryPage.locator('.chat__input:visible').first())
                .toBeVisible({ timeout: 15_000 });

            await secondaryPage.waitForTimeout(4_000);

            await sendInChat(primaryPage, messageAfter);

            await expect(primaryPage.locator('.chat__msg', { hasText: tokenAfter }))
                .toBeVisible({ timeout: 15_000 });

            await expect(secondaryPage.locator('.chat__msg', { hasText: tokenAfter }))
                .toBeVisible({ timeout: 45_000 });

            const postReloadMsg = secondaryPage.locator('.chat__msg', { hasText: tokenAfter });
            await expect(postReloadMsg).toContainText(primaryNick, { timeout: 10_000 });
        } finally {
            if (handles) {
                await handles.cleanup({ primaryCharId, secondaryCharId });
            }
        }
    });
});
