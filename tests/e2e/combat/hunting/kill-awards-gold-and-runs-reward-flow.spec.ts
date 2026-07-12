
import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { killMonsterViaEngine, getCharacterSnapshot } from '../../fixtures/combatSim';

test.describe('Combat › Hunting', { tag: '@combat' }, () => {
    test.describe.configure({ timeout: 90_000 });

    test('live-combat kill of rat: gold +1, xp gained, kill counter +1, log "ginie"', async ({ page }) => {
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

            await loginViaUI(page, testUsers.primary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 10_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
            await expect(page.locator('.town__char-name')).toHaveText(nick, { timeout: 10_000 });

            const before = await getCharacterSnapshot(page);
            expect(before).not.toBeNull();
            const preGold = before!.gold;
            const preXp = before!.xp;

            const result = await killMonsterViaEngine(page, 'rat', 'normal');

            expect(result.sessionKills.normal).toBeGreaterThanOrEqual(1);

            const killLogEntry = result.sessionLog.find((l) =>
                /Szczur ginie!.*\+\d+ XP.*\+\d+ Gold/.test(l.text),
            );
            expect(killLogEntry).toBeDefined();
            expect(killLogEntry!.type).toBe('loot');

            const after = await getCharacterSnapshot(page);
            expect(after).not.toBeNull();

            expect(after!.gold).toBeGreaterThanOrEqual(preGold + 1);

            expect(after!.xp).toBeGreaterThan(preXp);
            expect(after!.xp - preXp).toBeLessThanOrEqual(10);
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
