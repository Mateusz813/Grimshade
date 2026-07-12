
import { test, expect } from '@playwright/test';
import { testUsers } from '../../../fixtures/testUsers';
import { loginViaUI } from '../../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../../fixtures/createCharacter';
import { seedGameSave, findUserIdByEmail } from '../../../fixtures/seedGameSave';
import { cleanupCharacterById } from '../../../fixtures/cleanup';
import { getAdminClient } from '../../../fixtures/adminClient';

test.describe('Social › Party', { tag: '@party' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('happy path: create party with password -> roster shows our character + :locked: lock', async ({ page }) => {
        const nick = generateTestCharacterName();
        const partyName = `E2E Party ${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
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

            await page.getByRole('button', { name: /^Społeczność$/i }).tap();
            await expect(page).toHaveURL(/\/social$/, { timeout: 10_000 });
            await page.locator('.social__tile--party').tap();
            await expect(page).toHaveURL(/\/party$/, { timeout: 10_000 });

            await expect(page.locator('.party__intro-title')).toHaveText(/Party/i, { timeout: 10_000 });
            const createBtn = page.locator('.party__primary-btn', { hasText: /Stwórz nowe party/i });
            await expect(createBtn).toBeVisible();
            await createBtn.tap();

            await expect(page.locator('.party__create-form')).toBeVisible({ timeout: 5_000 });
            const nameField = page.locator('.party__field', { hasText: /Nazwa party/i }).locator('input');
            await nameField.fill(partyName);
            const passwordField = page.locator('.party__field', { hasText: /Hasło/i }).locator('input');
            await passwordField.fill('secret123');

            const submitBtn = page.locator('.party__form-actions')
                .getByRole('button', { name: /^Utwórz$/i });
            await expect(submitBtn).toBeEnabled({ timeout: 10_000 });
            await submitBtn.tap();

            await expect(page.locator('.party__roster')).toBeVisible({ timeout: 15_000 });

            await expect(page.locator('.party__roster-name', { hasText: nick }))
                .toBeVisible();

            await expect(page.locator('.party__roster-you')).toBeVisible();

            await expect(page.locator('.party__roster-crown')).toBeVisible();

            const rosterHeader = page.locator('.party__roster-header');
            await expect(rosterHeader.locator('.party__card-lock')).toBeVisible();

            await expect(page.locator('.party__roster-meta'))
                .toContainText(/1\/4\s+graczy/i);
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
