
import { test, expect, type Page } from '@playwright/test';
import { testUsers } from '../../../fixtures/testUsers';
import { createCharacterViaApi, generateTestCharacterName } from '../../../fixtures/createCharacter';
import { seedGameSave, findUserIdByEmail } from '../../../fixtures/seedGameSave';
import { openMultiContext } from '../../../fixtures/multiContext';
import { getAdminClient } from '../../../fixtures/adminClient';

const r11dNick = (): string => `r11d_${generateTestCharacterName().slice(0, 10)}`;

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

const navToParty = async (page: Page): Promise<void> => {
    await page.getByRole('button', { name: /^Społeczność$/i }).tap();
    await expect(page).toHaveURL(/\/social$/, { timeout: 10_000 });
    await page.locator('.social__tile--party').tap();
    await expect(page).toHaveURL(/\/party$/, { timeout: 10_000 });
    await expect(page.locator('.party__intro-title, .party__roster').first())
        .toBeVisible({ timeout: 15_000 });
};

test.describe('Social › Chat › Floating Icon', { tag: '@social' }, () => {
    test.describe.configure({ timeout: 120_000 });

    test('multi-context: primary sends party-channel msg via floating chat popup -> DB row lands on party_<id>', async ({ browser }) => {
        const primaryNick = r11dNick();
        const secondaryNick = r11dNick();
        const partyName = `r11d ${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
        const token = `E2E-FI-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
        const messageContent = `popup-party ${token}`;

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
                pickCharacter(primaryPage, primaryNick),
                pickCharacter(secondaryPage, secondaryNick),
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
            const submitBtn = primaryPage.locator('.party__form-actions')
                .getByRole('button', { name: /^Utwórz$/i });
            await expect(submitBtn).toBeEnabled({ timeout: 10_000 });
            await submitBtn.tap();

            await expect(primaryPage.locator('.party__roster')).toBeVisible({ timeout: 15_000 });
            await expect(primaryPage.locator('.party__roster-meta'))
                .toContainText(/1\/4\s+graczy/i);

            const refreshBtn = secondaryPage.locator('.party__refresh-btn');
            await refreshBtn.tap();
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

            await primaryPage.evaluate(async () => {
                const m = await import('/src/stores/chatTabsStore.ts');
                const p = await import('/src/stores/partyStore.ts');
                const partyId = p.usePartyStore.getState().party?.id;
                if (partyId) m.useChatTabsStore.getState().syncPartyTab(partyId);
            });

            const chatIcon = primaryPage.locator('.chat-unread-badge');
            await expect(chatIcon).toBeVisible({ timeout: 10_000 });
            await chatIcon.tap();

            const chatPopup = primaryPage.locator('.chat-popup');
            await expect(chatPopup).toBeVisible({ timeout: 5_000 });

            const partyTabBtn = chatPopup.locator('button.chat-popup__tab-btn[title*="Drużyna"]');
            await expect(partyTabBtn).toBeVisible({ timeout: 15_000 });
            await partyTabBtn.tap();

            await expect(partyTabBtn).toHaveAttribute('aria-selected', 'true', { timeout: 5_000 });

            const popupInput = chatPopup.locator('.chat__input:visible').first();
            const popupSend = chatPopup.locator('.chat__send:visible').first();
            await expect(popupInput).toBeVisible({ timeout: 10_000 });
            await popupInput.fill(messageContent);
            await expect(popupSend).toBeEnabled({ timeout: 5_000 });
            await popupSend.tap();

            const primaryOwnMsg = chatPopup.locator('.chat__msg', { hasText: token });
            await expect(primaryOwnMsg).toBeVisible({ timeout: 10_000 });

            const admin = getAdminClient();
            await expect.poll(
                async () => {
                    const { data } = await admin
                        .from('messages')
                        .select('id, channel, content, character_name')
                        .ilike('content', `%${token}%`);
                    return data ?? [];
                },
                { timeout: 15_000, intervals: [500, 1_000, 2_000] },
            ).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        content: messageContent,
                        character_name: primaryNick,
                        channel: expect.stringMatching(/^party_/),
                    }),
                ]),
            );

            try {
                await admin.from('messages').delete().ilike('content', `%${token}%`);
            } catch {
            }
        } finally {
            if (handles) {
                await handles.cleanup({ primaryCharId, secondaryCharId });
            } else {
                const { cleanupCharacterById } = await import('../../../fixtures/cleanup');
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
