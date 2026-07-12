
import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { getAdminClient, findUserIdByEmail } from '../../fixtures/adminClient';

test.describe('Skills › Upgrade', { tag: '@skills' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('milestone broadcast renders rich skill-upgrade row in /chat System tab', async ({ page }) => {
        const nick = generateTestCharacterName();
        const anchor = `E2E_SKILL_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const skillId = 'shield_bash';
        const skillName = 'Uderzenie Tarczą';
        const upgradeLevel = 10;
        const payload = {
            type: 'skillUpgrade',
            skillId,
            skillName,
            upgradeLevel,
        };
        const uniqueSkillName = `${skillName} ${anchor}`;
        const content = `[SYS]${JSON.stringify({
            ...payload,
            skillName: uniqueSkillName,
        })}`;

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
            if (!userId) throw new Error('[test 12.7] primary userId not found');

            const { data: msgRow, error: insertErr } = await admin
                .from('messages')
                .insert({
                    channel: 'system',
                    character_name: nick,
                    character_class: 'Knight',
                    character_level: 25,
                    content,
                    user_id: userId,
                })
                .select('id')
                .single();
            if (insertErr) throw new Error(`[test 12.7] message insert failed: ${insertErr.message}`);
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

            const systemTab = page.locator('.global-chat__tab-btn', { hasText: /System/i });
            await expect(systemTab).toBeVisible({ timeout: 5_000 });
            await systemTab.tap();
            const activeTab = page.locator('.global-chat__tab--active');
            await expect(activeTab).toContainText(/System/i, { timeout: 5_000 });

            const myMsg = page.locator('.chat__msg', { hasText: anchor }).first();
            await expect(myMsg).toBeVisible({ timeout: 15_000 });


            await expect(myMsg.locator('.chat__msg-text--skill')).toBeVisible();

            const strongs = myMsg.locator('.chat__msg-text--skill strong');
            await expect(strongs.first()).toContainText('Uderzenie Tarczą');
            await expect(strongs.first()).toContainText(anchor);

            await expect(strongs.nth(1)).toHaveText('+10');

            await expect(myMsg.locator('.chat__msg-sys-body')).toContainText(/ulepszył\(a\)\s+skill/i);

            await expect(myMsg.locator('.chat__msg-sys-icon')).toBeVisible();
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
