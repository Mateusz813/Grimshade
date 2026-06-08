/**
 * Atomic E2E — Eliksir Ochrony actually consumes + prevents level loss.
 *
 * BACKLOG 13.21 extension. The sibling armed-state SMOKE
 * (`combat/death/death-protection-armed-shows-buff-row.spec.ts`)
 * documents that "Pełny consume flow … wymaga combat-sim — TODO".
 * THIS test delivers that consume verification.
 *
 * What we test:
 *  1. Seed Knight lvl 50 + 2× `death_protection` consumable + NO
 *     amulet_of_loss (focuses the assertion on the death_protection
 *     branch, separate from the AOL item-protection branch).
 *  2. Login + Town.
 *  3. Pre-snapshot: char lvl 50, `consumables.death_protection === 2`.
 *  4. `triggerPlayerDeath(page)` — engine fires:
 *       • `useInventoryStore.useConsumable('death_protection')`
 *         returns TRUE and decrements count by 1 (combatEngine.ts
 *         line 1381).
 *       • Branch at line 1391 hits → log "🛡️ Eliksir Ochrony …" and
 *         SKIPS the entire `applyDeathPenalty` block (lines 1394-1413).
 *       • Character level/xp UNCHANGED.
 *       • `fullHealEffective` called at line 1384 → HP=max.
 *  5. Post-assert:
 *       • level === 50 (NO drop — death protection swallowed the penalty).
 *       • xp unchanged from pre-death.
 *       • `consumables.death_protection === 1` (1 was used).
 *       • hp === max_hp (full revival).
 *
 * Contrast with sibling test `real-death-applies-xp-penalty.spec.ts`:
 *   • That test seeds NO protection → asserts level/xp DROPPED.
 *   • THIS test seeds protection → asserts level/xp UNCHANGED + count
 *     decremented.
 *   Together they prove the protection branch / no-protection branch
 *   are wired correctly and don't accidentally fall through.
 *
 * Why we DON'T verify (kept for separate tests):
 *  • amulet_of_loss item-protection — same engine, separate branch
 *    (line 1416-1421). A separate test would seed AOL + bag items,
 *    trigger death, assert items SURVIVED.
 *  • Death feed row written (`deathsApi.logDeath` line 1369-1378).
 *  • Death overlay UI render (`useDeathStore.triggerDeath` line 1434).
 *
 * Cleanup: try/finally + cleanupCharacterById.
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { seedConsumables } from '../../fixtures/seedInventory';
import { triggerPlayerDeath, getCharacterSnapshot } from '../../fixtures/combatSim';

test.describe('Combat › Death', { tag: '@combat' }, () => {
    test.describe.configure({ timeout: 90_000 });

    test('Knight lvl 50 with 2× death_protection dies → level stays 50, 1 protection consumed', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            // 1. Seed Knight lvl 50 + 2× death_protection.
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: {
                    level: 50,
                    highest_level: 50,
                    hp_regen: 0,
                    mp_regen: 0,
                },
            });
            createdId = created.id;

            // seedConsumables upserts into the game_saves blob — same
            // path the engine reads via `useInventoryStore.useConsumable`
            // after applyBlobToStores hydrates the inventory slice.
            await seedConsumables({
                characterId: created.id,
                counts: { death_protection: 2 },
            });

            // 2. Login → Town.
            await loginViaUI(page, testUsers.primary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 10_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
            await expect(page.locator('.town__char-name')).toHaveText(nick, { timeout: 10_000 });

            // 3. Pre-snapshot.
            const before = await getCharacterSnapshot(page);
            expect(before).not.toBeNull();
            expect(before!.level).toBe(50);

            // Sanity: verify the consumable seed actually landed in the
            // hydrated inventory store. If this fails the test scenario
            // is invalid (we'd be measuring the no-protection branch
            // pretending it's the protected branch).
            const preConsumableCount = await page.evaluate(async () => {
                // @ts-expect-error — dev-time Vite URL not resolvable by tsc
                const mod = await import('/src/stores/inventoryStore.ts');
                const inv = (mod as {
                    useInventoryStore: { getState: () => { consumables: Record<string, number> } };
                }).useInventoryStore.getState();
                return inv.consumables['death_protection'] ?? 0;
            });
            expect(preConsumableCount).toBe(2);

            // 4. Trigger death.
            await triggerPlayerDeath(page, 'rat');

            // 5. Post-snapshot.
            const after = await getCharacterSnapshot(page);
            expect(after).not.toBeNull();

            // 6. Level UNCHANGED — death_protection swallowed the penalty.
            expect(after!.level).toBe(50);

            // 7. XP unchanged (pre-death xp=0 from default; post-death
            //    also 0 because applyDeathPenalty branch was SKIPPED).
            expect(after!.xp).toBe(before!.xp);

            // 8. Full revival still happened — fullHealEffective runs
            //    BEFORE the protection branch (line 1384), so HP=max
            //    regardless of which branch fires.
            expect(after!.hp).toBe(after!.max_hp);

            // 9. Critical assertion: death_protection count decremented
            //    by exactly 1 (line 1381's useConsumable consumes one).
            //    This proves the protection ACTUALLY fired — not just
            //    that level happened to stay (e.g. if engine bailed
            //    silently and didn't call useConsumable, count would
            //    stay at 2 AND level would also stay).
            const postConsumableCount = await page.evaluate(async () => {
                // @ts-expect-error — dev-time Vite URL not resolvable by tsc
                const mod = await import('/src/stores/inventoryStore.ts');
                const inv = (mod as {
                    useInventoryStore: { getState: () => { consumables: Record<string, number> } };
                }).useInventoryStore.getState();
                return inv.consumables['death_protection'] ?? 0;
            });
            expect(postConsumableCount).toBe(1);
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
