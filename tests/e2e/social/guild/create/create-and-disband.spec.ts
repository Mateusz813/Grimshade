
import { test, expect } from '@playwright/test';
import { testUsers } from '../../../fixtures/testUsers';
import { loginViaUI } from '../../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../../fixtures/createCharacter';
import { seedGameSave, findUserIdByEmail } from '../../../fixtures/seedGameSave';
import { cleanupCharacterById } from '../../../fixtures/cleanup';
import { cleanupGuildsByLeaderIds } from '../../../fixtures/guildCleanup';

test.describe('Social › Guild', { tag: '@guild' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('happy path: create guild with 1M gp -> home view renders -> disband by leaving -> guild gone from list', async ({ page }) => {
        const nick = generateTestCharacterName();
        const tag = Math.random().toString(36).slice(2, 5).toUpperCase().replace(/[^A-Z0-9]/g, 'A');
        const guildName = `E2E Guild ${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
        let createdCharId: string | null = null;

        try {
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: { level: 10, highest_level: 10, hp_regen: 0, mp_regen: 0 },
            });
            createdCharId = created.id;
            const userId = await findUserIdByEmail(testUsers.primary.email);
            await seedGameSave({
                characterId: created.id,
                userId,
                gold: 2_000_000,
            });

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
            await page.locator('.social__tile--gildia').tap();
            await expect(page).toHaveURL(/\/guild$/, { timeout: 10_000 });

            await expect(page.locator('.guild__list-create')).toBeVisible({ timeout: 15_000 });

            await page.locator('.guild__list-create').tap();
            await expect(page.locator('.guild__modal-title', { hasText: /Stwórz gildię/i }))
                .toBeVisible({ timeout: 5_000 });

            await page.locator('#guild-name').fill(guildName);
            await page.locator('#guild-tag').fill(tag);

            const submitBtn = page.locator('.guild__btn-primary', { hasText: /Stwórz gildię/i });
            await expect(submitBtn).toBeEnabled({ timeout: 10_000 });
            await submitBtn.tap();

            await expect(page.locator('.guild__home-banner')).toBeVisible({ timeout: 15_000 });
            await expect(page.locator('.guild__home-name')).toContainText(guildName);
            await expect(page.locator('.guild__home-name')).toContainText(`[${tag}]`);

            const myMember = page.locator('.guild__member-row.is-me');
            await expect(myMember).toBeVisible();
            await expect(myMember.locator('.guild__member-name')).toContainText(nick);
            await expect(myMember.locator('.guild__member-crown')).toBeVisible();

            await myMember.locator('.guild__member-leave[title="Opuść gildię"]').tap();
            await expect(page.locator('.guild__modal-title', { hasText: /Opuść gildię/i }))
                .toBeVisible({ timeout: 5_000 });
            await expect(page.locator('.guild__home-warning'))
                .toContainText(/ostatnim członkiem.*rozwiązana/i);

            const confirmBtn = page.locator('.guild__btn-danger', { hasText: /Opuść/i });
            await expect(confirmBtn).toBeEnabled();
            await confirmBtn.tap();

            await expect(page.locator('.guild__home-banner')).toBeHidden({ timeout: 15_000 });
            await expect(page.locator('.guild__list-create')).toBeVisible({ timeout: 10_000 });

            await expect(page.locator('.guild__list-name', { hasText: guildName }))
                .toHaveCount(0, { timeout: 15_000 });
        } finally {
            await cleanupGuildsByLeaderIds([createdCharId]);
            if (createdCharId) {
                await cleanupCharacterById(createdCharId);
            }
        }
    });
});
