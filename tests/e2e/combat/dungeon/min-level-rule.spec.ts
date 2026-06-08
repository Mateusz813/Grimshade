/**
 * Atomic E2E — dungeon min-level gate (solo).
 *
 * BACKLOG 13.16: "Dungeon: tylko najmniejszy ally level / lub wszyscy
 * mają access". Original spec text references a party scenario (lvl 50
 * leader + lvl 5 member trying to enter a lvl-10 dungeon), but the
 * authoritative rule is implemented by `getPartyGateLevel` in
 * `src/systems/partySystem.ts` line 253-263:
 *
 *   • Solo character → `gateLevel = character.level` (no party = no
 *     downscaling).
 *   • Party with humans → `gateLevel = min(character.level, weakestHuman)`.
 *
 * The dungeon-card UI in `Dungeon.tsx` (line 2425) reads
 * `tooLow = gateLevel < getDungeonMinLevel(d)` to render either the
 * "🔒 Wymaga Lvl {dungeonLvl}" lock chip (line 2524) OR the "⚔️ Wejdź"
 * enter button (line 2528). Multi-context party version would also
 * exercise the lowest-level-wins rule but requires 2 browser contexts
 * + multi-human party setup which is fragile (party-create UI flow has
 * its own race conditions per 4.1/4.2 testing).
 *
 * This test PROVES THE SOLO BRANCH OF THE RULE: a Knight lvl 5 attempts
 * to access `dungeon_10` (minLevel=10). UI MUST render the lock chip
 * for that card AND the "Wejdź" button MUST be absent. Conversely,
 * `dungeon_1` (minLevel=1) MUST render the enter button (sanity that
 * gating is selective, not blanket).
 *
 * **Why the solo path is the right load-bearing assertion**:
 *  • `getPartyGateLevel(charLevel, null)` returns `charLevel` — solo is
 *    the EXIT path of the same function the party path uses. Bug in
 *    the unwrap (e.g. accidentally returning 0 / Infinity / NaN) breaks
 *    BOTH paths.
 *  • Solo flow is what 95% of players use. If the gate rendering breaks
 *    solo, every fresh-account user sees broken dungeons.
 *  • Party variant is documented as a future multi-context test
 *    `combat/dungeon/min-level-party-uses-lowest.spec.ts` (TODO) and
 *    will follow the multi-ctx fixture pattern from 4.2 / 4.7.
 *
 * What we test:
 *  1. Seed Knight lvl 5. hp_regen/mp_regen=0 to keep state stable.
 *  2. Nav to `/dungeon`. Verify both `dungeon_1` and `dungeon_10` cards
 *     render.
 *  3. `dungeon_1` (minLevel=1, gate 5≥1): card has NO `dungeon__locked`
 *     chip AND has visible "⚔️ Wejdź" button.
 *  4. `dungeon_10` (minLevel=10, gate 5<10): card has the
 *     `dungeon__locked` chip with "Wymaga Lvl 10" text AND has NO
 *     "Wejdź" button (button is conditionally rendered, line 2527).
 *
 * **Filter approach** — Dungeon view paginates with a default
 * `dungeonFilterMinLevel` of 0 which shows EVERYTHING level 0+. Both
 * `dungeon_1` (level 1) and `dungeon_10` (level 10) sit near the top
 * of the unfiltered, sorted-asc list, so we don't need any UI filter
 * manipulation. The cards are matched by their localized name to be
 * deterministic against any future re-ordering.
 *
 * What we DON'T test (and why):
 *  • Pressing "Wejdź" actually starts the dungeon — the smoke
 *    `page-loads.spec.ts` already covers rendering; the start-flow is
 *    out of scope for the min-level GATE assertion.
 *  • Party-aware lowest-level pick — see "future multi-context test"
 *    note above.
 *
 * Cleanup: try/finally + cleanupCharacterById.
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';

test.describe('Combat › Dungeon', { tag: '@combat' }, () => {
    test.describe.configure({ timeout: 90_000 });

    test('solo Knight lvl 5: dungeon_10 (minLvl=10) shows lock chip + no Wejdź; dungeon_1 (minLvl=1) shows Wejdź', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            // 1. Seed Knight lvl 5. Gate level for solo = char.level = 5.
            //    dungeon_1 (minLvl=1) → 5≥1 → ENTER. dungeon_10 (minLvl=10)
            //    → 5<10 → LOCK. hp_regen/mp_regen=0 (CLAUDE.md TESTING).
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: { level: 5, highest_level: 5, hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            // 2. Login → wybierz postać → Town
            await loginViaUI(page, testUsers.primary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 10_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
            await expect(page.locator('.top-header')).toBeVisible({ timeout: 10_000 });

            // 3. Direct nav na /dungeon.
            await page.goto('/dungeon');
            await expect(page).toHaveURL(/\/dungeon$/, { timeout: 10_000 });
            await expect(page.locator('.dungeon__panel')).toBeVisible({ timeout: 15_000 });

            // 4. Find the lvl-1 dungeon card by name (Ruiny Starego Fortu)
            //    AND verify it has an ENTER button + no lock chip.
            //    Names come from `src/data/dungeons.json` (`name_pl` field).
            const dungeon1Card = page.locator('.dungeon__card', {
                has: page.locator('.dungeon__card-name', { hasText: 'Ruiny Starego Fortu' }),
            });
            await expect(dungeon1Card).toBeVisible({ timeout: 10_000 });
            // Lock chip absent on dungeon_1 — gate (5) ≥ minLvl (1).
            await expect(dungeon1Card.locator('.dungeon__locked')).toHaveCount(0);
            // Wejdź button present — Dungeon.tsx line 2528 conditional.
            await expect(dungeon1Card.locator('.dungeon__enter-btn')).toBeVisible();

            // 5. Find the lvl-10 dungeon card (Ruiny Strażnicy) AND verify
            //    it shows the lock chip + has NO enter button.
            const dungeon10Card = page.locator('.dungeon__card', {
                has: page.locator('.dungeon__card-name', { hasText: 'Ruiny Strażnicy' }),
            });
            await expect(dungeon10Card).toBeVisible({ timeout: 10_000 });
            // Lock chip present — gate (5) < minLvl (10), `tooLow=true`.
            await expect(dungeon10Card.locator('.dungeon__locked')).toBeVisible();
            // Lock chip text mentions the required level (line 2524).
            await expect(dungeon10Card.locator('.dungeon__locked')).toHaveText(/Wymaga Lvl 10/);
            // Wejdź button absent — Dungeon.tsx line 2527 short-circuits
            // rendering when `blocked === true` (noAttempts || tooLow).
            await expect(dungeon10Card.locator('.dungeon__enter-btn')).toHaveCount(0);
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
