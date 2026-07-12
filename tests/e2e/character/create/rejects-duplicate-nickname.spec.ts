
import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import {
    createCharacterViaApi,
    generateTestCharacterName,
} from '../../fixtures/createCharacter';
import {
    cleanupCharacterById,
    cleanupCharacterByName,
} from '../../fixtures/cleanup';
import { getAdminClient, findUserIdByEmail } from '../../fixtures/adminClient';

test.describe('Character › Create', { tag: '@character' }, () => {
    test.describe.configure({ timeout: 90_000 });

    test('rejects nickname already taken by another user', async ({ page }) => {
        const sharedNick = generateTestCharacterName();
        let secondaryCharId: string | null = null;

        try {
            const seeded = await createCharacterViaApi({
                userEmail: testUsers.secondary.email,
                name: sharedNick,
                class: 'Mage',
                overrides: { hp_regen: 0, mp_regen: 0 },
            });
            secondaryCharId = seeded.id;

            await loginViaUI(page, testUsers.primary);
            if (!page.url().endsWith('/character-select')) {
                await page.goto('/character-select');
            }

            const createBtn = page.getByRole('button', { name: /Stwórz nową postać/i });
            await createBtn.scrollIntoViewIfNeeded();
            await createBtn.tap();
            await expect(page).toHaveURL(/\/create-character$/, { timeout: 10_000 });

            const knightBtn = page.locator('.character-create__class-btn').filter({
                hasText: /Rycerz/,
            });
            await knightBtn.tap();
            await expect(knightBtn).toHaveClass(/character-create__class-btn--selected/);

            await page.locator('.character-create__input').fill(sharedNick);

            await page.getByRole('button', { name: /Stwórz postać/i }).tap();

            await page.waitForTimeout(2000);
            await expect(page).toHaveURL(/\/create-character$/);

            const errorEl = page.locator('.character-create__error');
            await expect(errorEl).toBeVisible({ timeout: 5_000 });

            const admin = getAdminClient();
            const primaryUserId = await findUserIdByEmail(testUsers.primary.email);
            const { data: primaryChars, error: pcErr } = await admin
                .from('characters')
                .select('id')
                .eq('user_id', primaryUserId!)
                .eq('name', sharedNick);
            expect(pcErr).toBeNull();
            expect(primaryChars ?? []).toHaveLength(0);
        } finally {
            if (secondaryCharId) {
                await cleanupCharacterById(secondaryCharId);
            }
            await cleanupCharacterByName(testUsers.primary.email, sharedNick);
        }
    });
});
