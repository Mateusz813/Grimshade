
import { test, expect } from '@playwright/test';
import { testUsers } from '../../../fixtures/testUsers';
import { loginViaUI } from '../../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../../fixtures/createCharacter';
import { seedGameSave, findUserIdByEmail } from '../../../fixtures/seedGameSave';
import { cleanupCharacterById } from '../../../fixtures/cleanup';
import { getAdminClient } from '../../../fixtures/adminClient';

test.describe('Social › Party', { tag: '@party' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('Town "+ Stwórz party" shortcut -> party persists + appears in /party roster', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: { level: 10, highest_level: 10, hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;
            const userId = await findUserIdByEmail(testUsers.primary.email);
            await seedGameSave({ characterId: created.id, userId });

            await loginViaUI(page, testUsers.primary);
            if (!page.url().endsWith('/character-select')) {
                await page.goto('/character-select');
            }
            await expect(page.locator('.char-select__card-name', { hasText: nick }))
                .toBeVisible({ timeout: 10_000 });
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });
            await expect(page.locator('.town__char-name')).toHaveText(nick);

            const emptyStrip = page.locator('.town__party-strip--empty');
            await expect(emptyStrip).toBeVisible({ timeout: 10_000 });
            await expect(emptyStrip).toContainText(/Solo.*brak party/i);

            const createBtn = emptyStrip.locator('.town__party-strip-create');
            await expect(createBtn).toBeVisible();
            await createBtn.tap();

            await expect(page.locator('.town__party-strip--empty')).toBeHidden({ timeout: 15_000 });
            await expect(page.locator('.town__party-strip')).toBeVisible();

            await page.getByRole('button', { name: /^Społeczność$/i }).tap();
            await expect(page).toHaveURL(/\/social$/, { timeout: 10_000 });
            await page.locator('.social__tile--party').tap();
            await expect(page).toHaveURL(/\/party$/, { timeout: 10_000 });

            await expect(page.locator('.party__roster')).toBeVisible({ timeout: 15_000 });
            await expect(page.locator('.party__roster-name', { hasText: nick }))
                .toBeVisible();
            await expect(page.locator('.party__roster-crown')).toBeVisible();

            const rosterHeader = page.locator('.party__roster-header');
            await expect(rosterHeader.locator('.party__card-lock')).toHaveCount(0);

            await expect(page.locator('.party__roster-title'))
                .toContainText(`${nick}'s party`);
        } finally {
            if (createdId) {
                try {
                    const admin = getAdminClient();
                    await admin.from('parties').delete().eq('leader_id', createdId);
                } catch {
                }
            }
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
