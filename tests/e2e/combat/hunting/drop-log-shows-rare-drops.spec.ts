
import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { killMonsterViaEngine } from '../../fixtures/combatSim';

test.describe('Combat › Hunting', { tag: '@combat' }, () => {
    test.describe.configure({ timeout: 90_000 });

    test('forced drop produces "· Drop: <name>" suffix in loot-type log entry', async ({ page }) => {
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

            await page.evaluate(() => {
                let counter = 0;
                Math.random = () => 0.01 + (counter++ % 9_000_000) * 1e-8;
            });

            const result = await killMonsterViaEngine(page, 'rat', 'normal');

            expect(result.sessionDrops.length).toBeGreaterThan(0);

            const dropLogEntry = result.sessionLog.find((l) =>
                /Szczur ginie!.*· Drop:/.test(l.text),
            );
            expect(dropLogEntry).toBeDefined();

            expect(dropLogEntry!.type).toBe('loot');

            expect(dropLogEntry!.text).toMatch(/· Drop: .+/);

            const bagSize = await page.evaluate(async () => {
                const mod = await import('/src/stores/inventoryStore.ts');
                return (mod as {
                    useInventoryStore: { getState: () => { bag: Array<unknown> } };
                }).useInventoryStore.getState().bag.length;
            });
            expect(bagSize).toBeGreaterThanOrEqual(1);
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
