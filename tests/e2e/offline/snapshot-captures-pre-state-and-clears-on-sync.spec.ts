
import { test, expect } from '@playwright/test';
import { testUsers } from '../fixtures/testUsers';
import { loginViaUI } from '../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../fixtures/createCharacter';
import { seedGameSave, findUserIdByEmail } from '../fixtures/seedGameSave';
import { cleanupCharacterById } from '../fixtures/cleanup';
import { getAdminClient } from '../fixtures/adminClient';

const SEEDED_GOLD = 12345;

test.describe('Offline › Sync', { tag: '@offline' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('snapshot captures pre-offline gold; clears after online sync; canonical row unchanged on no-op offline session', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: { hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            const userId = await findUserIdByEmail(testUsers.primary.email);
            await seedGameSave({
                characterId: createdId,
                userId,
                gold: SEEDED_GOLD,
            });

            await loginViaUI(page, testUsers.primary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 10_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
            await expect(page.locator('.town__char-name')).toHaveText(nick, { timeout: 10_000 });

            const goldBtn = page.locator('.top-header__gold-btn');
            await expect(goldBtn).toHaveAttribute('aria-label', /Złoto:\s+12[\s\xa0]?345/, { timeout: 10_000 });

            const preSnap = await page.evaluate(() => sessionStorage.getItem('grimshade.offlineSnapshot'));
            expect(preSnap).toBeNull();

            const avatarBtn = page.getByRole('button', { name: /menu postaci/i });
            await avatarBtn.tap();
            const modeToggle = page.locator('.avatar-menu__lang-toggle').nth(1);
            const offlineBtn = modeToggle.locator('.avatar-menu__lang-btn', { hasText: /^Offline$/ });
            await expect(offlineBtn).toBeVisible({ timeout: 5_000 });
            await offlineBtn.tap();

            await expect.poll(
                () => page.evaluate(() => {
                    const raw = sessionStorage.getItem('grimshade.offlineSnapshot');
                    return raw ? JSON.parse(raw) as { gold: number; characterId: string; capturedAt: string } : null;
                }),
                { timeout: 5_000 },
            ).toMatchObject({
                gold: SEEDED_GOLD,
                characterId: createdId,
            });

            const statusDot = page.locator('.top-header__status-dot');
            await expect(statusDot).toHaveClass(/top-header__status-dot--offline/, { timeout: 5_000 });

            const onlineBtn = modeToggle.locator('.avatar-menu__lang-btn', { hasText: /^Online$/ });
            await onlineBtn.tap();
            await expect(statusDot).toHaveClass(/top-header__status-dot--online/, { timeout: 5_000 });

            await page.evaluate(async () => {
                const mod = await import('/src/stores/characterScope.ts');
                await (mod as { saveCurrentCharacterStoresForce: () => Promise<void> })
                    .saveCurrentCharacterStoresForce();
            });

            await expect.poll(
                () => page.evaluate(() => sessionStorage.getItem('grimshade.offlineSnapshot')),
                { timeout: 10_000 },
            ).toBeNull();

            const admin = getAdminClient();
            const { data, error } = await admin
                .from('game_saves')
                .select('state')
                .eq('character_id', createdId)
                .single();
            expect(error).toBeNull();
            const persistedGold = ((data?.state as { inventory?: { gold?: number } } | null)
                ?.inventory?.gold) ?? -1;
            expect(persistedGold).toBe(SEEDED_GOLD);
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
