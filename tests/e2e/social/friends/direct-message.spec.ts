
import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { seedGameSave, findUserIdByEmail } from '../../fixtures/seedGameSave';
import { openMultiContext } from '../../fixtures/multiContext';
import type { Page } from '@playwright/test';

test.describe('Social › Friends', { tag: '@social' }, () => {
    test.describe.configure({ timeout: 120_000 });

    test('multi-context: primary opens PM with secondary -> sends message -> secondary receives via Realtime', async ({ browser }) => {
        const primaryNick = generateTestCharacterName();
        const secondaryNick = generateTestCharacterName();
        const token = `E2E-PM-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
        const messageContent = `Hello ${token} from primary DM`;

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

            const openPmTab = async (page: Page, ownNick: string, target: string): Promise<void> => {
                await page.goto(`/chat?pm=${encodeURIComponent(target)}`);
                const activeTab = page.locator('.global-chat__tab--active');
                await expect(activeTab).toBeVisible({ timeout: 15_000 });
                await expect(activeTab).toContainText(target, { timeout: 10_000 });
                await expect(page.locator('.chat__input:visible').first())
                    .toBeVisible({ timeout: 10_000 });
                expect(ownNick).toBeTruthy();
            };

            await Promise.all([
                openPmTab(primaryPage, primaryNick, secondaryNick),
                openPmTab(secondaryPage, secondaryNick, primaryNick),
            ]);

            const primaryActiveInput = primaryPage.locator('.chat__input:visible').first();
            const primaryActiveSend = primaryPage.locator('.chat__send:visible').first();
            await primaryActiveInput.fill(messageContent);
            await expect(primaryActiveSend).toBeEnabled({ timeout: 5_000 });
            await primaryActiveSend.tap();

            const primaryOwnMsg = primaryPage.locator('.chat__msg', { hasText: token });
            await expect(primaryOwnMsg).toBeVisible({ timeout: 15_000 });

            const secondaryReceivedMsg = secondaryPage.locator('.chat__msg', { hasText: token });
            await expect(secondaryReceivedMsg).toBeVisible({ timeout: 45_000 });

            await expect(secondaryReceivedMsg).toContainText(primaryNick);
            await expect(secondaryReceivedMsg.locator('.chat__msg-level'))
                .toHaveText('10');
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
