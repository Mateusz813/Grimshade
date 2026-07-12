
import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { getAdminClient, findUserIdByEmail } from '../../fixtures/adminClient';

test.describe('Chat › City', { tag: '@chat' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('city channel message renders level pill with character_level value from DB', async ({ page }) => {
        const nick = generateTestCharacterName();
        const uniqueContent = `E2E test message ${Date.now()}`;
        let createdId: string | null = null;
        let seededMsgId: string | null = null;

        try {
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: { level: 25, highest_level: 25, hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            const admin = getAdminClient();
            const userId = await findUserIdByEmail(testUsers.primary.email);
            if (!userId) throw new Error('[test 15.8] primary userId not found');

            const { data: msgRow, error: insertErr } = await admin
                .from('messages')
                .insert({
                    channel: 'city',
                    character_name: nick,
                    character_class: 'Knight',
                    character_level: 25,
                    content: uniqueContent,
                    user_id: userId,
                })
                .select('id')
                .single();

            if (insertErr) throw new Error(`[test 15.8] message insert failed: ${insertErr.message}`);
            seededMsgId = msgRow.id as string;

            await loginViaUI(page, testUsers.primary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 10_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });

            await page.goto('/chat');
            await expect(page.locator('.global-chat')).toBeVisible({ timeout: 10_000 });

            const myMsg = page.locator('.chat__msg', { hasText: uniqueContent }).first();
            await expect(myMsg).toBeVisible({ timeout: 15_000 });

            await expect(myMsg.locator('.chat__msg-level')).toHaveText('25');

            await expect(myMsg.locator('.chat__msg-level')).toHaveAttribute('title', 'Poziom 25');
        } finally {
            if (seededMsgId) {
                try {
                    await getAdminClient().from('messages').delete().eq('id', seededMsgId);
                } catch {
                }
            }
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
