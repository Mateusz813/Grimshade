/**
 * E2E — BACKLOG 15.6 full 9-tab admin panel smoke.
 *
 * UNBLOCKED 2026-05-26: previously gated on owner decision about admin
 * test-account creation. Resolution:
 *   1. `ADMIN_EMAILS` set (was `ADMIN_EMAIL` single string) in
 *      `src/components/ui/AdminPanel/AdminPanel.tsx` line 47-65 allows
 *      both production owner (`krasek39@gmail.com`) AND test admin
 *      (`e2e-admin@grimshade-test.local`).
 *   2. `e2e-admin@grimshade-test.local` created via service_role in
 *      Supabase Auth (see migration log 2026-05-26).
 *   3. `E2E_ADMIN_EMAIL` + `E2E_ADMIN_PASSWORD` added to `.env.test` +
 *      `.env.test.example`.
 *   4. `cleanupCharactersForEmail` whitelist extended with admin email.
 *
 * What this test verifies:
 *   - Admin gate accepts the test admin email (positive counterpart to
 *     `panel-tabs-load.spec.ts` non-admin negative test).
 *   - Each of the 9 tabs (char/inv/skill/tasks/quests/walki/social/system/nuke)
 *     can be tapped + the active-modifier flips + a section anchor mounts
 *     without React crash.
 *
 * Tab list source: `AdminPanel.tsx` line 708-718 `<TabBtn>` invocations.
 * Tab labels with emoji are the canonical Polish UI text.
 */

import { test, expect, type Page } from '@playwright/test';
import { testUsers } from '../fixtures/testUsers';
import { loginViaUI } from '../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../fixtures/createCharacter';
import { cleanupCharacterById } from '../fixtures/cleanup';

/** Tab definitions — must match `AdminPanel.tsx` `<TabBtn>` lines 709-717. */
const TABS = [
    { value: 'char',   label: /🧙\s*Postać/ },
    { value: 'inv',    label: /🎒\s*Inv/ },
    { value: 'skill',  label: /✨\s*Skille/ },
    { value: 'tasks',  label: /📜\s*Tasks/ },
    { value: 'quests', label: /📖\s*Questy/ },
    { value: 'walki',  label: /🏰\s*Walki/ },
    { value: 'social', label: /👥\s*Społ/ },
    { value: 'system', label: /⚙️\s*System/ },
    { value: 'nuke',   label: /💀\s*Reset/ },
] as const;

/** Pick character → land in Town. */
const pickCharacterAndEnterTown = async (page: Page, nick: string): Promise<void> => {
    await page.goto('/character-select');
    const card = page.locator('.char-select__card', {
        has: page.locator('.char-select__card-name', { hasText: nick }),
    });
    await expect(card).toBeVisible({ timeout: 15_000 });
    await card.getByRole('button', { name: /Wybierz/i }).tap();
    await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
};

test.describe('Admin › Panel', { tag: '@admin' }, () => {
    test.describe.configure({ timeout: 180_000 });

    test('admin session: all 9 panel tabs load without crash', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            // 1. Seed Knight on test admin account so we have a character to
            //    pick (admin gate requires session + character).
            const created = await createCharacterViaApi({
                userEmail: testUsers.admin.email,
                name: nick,
                class: 'Knight',
                overrides: { level: 50, gold: 100000, hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            // 2. Login as admin + pick character → Town.
            await loginViaUI(page, testUsers.admin);
            await pickCharacterAndEnterTown(page, nick);

            // 3. Open AvatarMenu — should now show "Panel admina" entry
            //    because session email matches an entry in ADMIN_EMAILS.
            const avatarBtn = page.locator('.top-header__avatar-btn');
            await expect(avatarBtn).toBeVisible({ timeout: 10_000 });
            await avatarBtn.tap();

            const adminItem = page.locator('.avatar-menu__item--admin');
            await expect(adminItem).toBeVisible({ timeout: 10_000 });

            // 4. Open admin panel.
            await adminItem.tap();
            const panel = page.locator('.admin-panel');
            await expect(panel).toBeVisible({ timeout: 10_000 });

            // 5. Iterate all 9 tabs — tap each, assert active-modifier
            //    flips + the body section mounts without React crash.
            for (const tab of TABS) {
                const tabBtn = page.locator('.admin-panel__tab', { hasText: tab.label });
                await expect(tabBtn).toBeVisible({ timeout: 5_000 });
                await tabBtn.tap();
                await expect(tabBtn).toHaveClass(/admin-panel__tab--active/, { timeout: 3_000 });

                // The body content varies per tab but always has at least
                // one `.admin-panel__section` element rendered. Use first()
                // because some tabs render multiple sections.
                const section = page.locator('.admin-panel__section').first();
                await expect(section).toBeVisible({ timeout: 5_000 });
            }
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
