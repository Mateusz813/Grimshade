/**
 * Atomic E2E — buff appears in TopHeader BuffPopover after elixir use.
 *
 * Backlog item 3.13 ("Po użyciu eliksiru → buff pokazuje się w header
 * dropdown z czasem / liczbą"): the player uses a buff elixir from the
 * inventory, and we verify:
 *  1. The TopHeader buff button (`.top-header__buffs-btn`) appears with
 *     a count of 1 (it's hidden when `totalBuffCount === 0` — TopHeader
 *     line 296).
 *  2. Tapping the buff button opens the BuffPopover dropdown
 *     (`.buff-popover`).
 *  3. The popover lists the activated buff with its name + remaining
 *     time chip (e.g. "1h 00m" for a 1h XP boost).
 *
 * ## Why xp_boost (and not e.g. atk_boost_elixir)
 *
 * The elixir we use MUST satisfy three constraints:
 *  • effect is in `BUFF_CONFIG` (passes `isBuffEffect()`) so
 *    `applyElixirDose` routes through `addBuff` / `addPausableBuff`
 *    instead of a heal / stat-reset path. Patrz Inventory.tsx ~2770.
 *  • Realtime (not pausable / game-time) — pausable buffs only tick down
 *    in combat (`addPausableBuff` sets `expiresAt = Infinity` and shows
 *    `remainingMs` count via BuffPopover line 130). Realtime buffs show
 *    a live "1h 00m" countdown which is more visually deterministic for
 *    the screenshot/assertion.
 *  • minLevel === 1 so a fresh Knight at lvl 1 can use it without
 *    further setup.
 *
 * `xp_boost` matches: effect `xp_boost_1h`, BUFF_CONFIG says realtime
 * 60min duration, minLevel: 1. The buff name rendered in BuffPopover
 * comes from `BUFF_CONFIG[effect].name` — for `xp_boost_1h` it's
 * "XP Boost +50%" (see `src/systems/buffSystem.ts` if you want to
 * verify). We assert on the partial substring "XP Boost" to be robust
 * against minor copy tweaks.
 *
 * Wait — empirically the name shown is "+50% XP (polowanie)" from the
 * BUFF_CONFIG. So we match the loose "XP" plus a "+50" / "+100" /
 * percent token. Both name shapes should match; pick the most stable.
 *
 * The exact `xp_boost` BUFF_CONFIG entry — name might be the elixir's
 * `name_pl` "Dopalacz XP" OR the BUFF_CONFIG's own name. Looking at
 * `applyElixirDose` line 2778: `buffData = { id: cfg.id, name: cfg.name, … }`
 * → uses the BUFF_CONFIG name, not elixir name. So we anchor on the
 * BUFF_CONFIG name which for xp_boost_1h is "+50% XP (polowanie)".
 * To be robust we assert on "XP" appearing in the popover list (only
 * one row, no other XP-related text in this view).
 *
 * ## Setup pattern
 *
 *   • `createCharacterViaApi` creates a Knight at level 1.
 *   • `seedConsumables` puts 5× xp_boost in the character's inventory
 *     (we only need 1 to use, but having a small stack is harmless and
 *     avoids the "0 stack" disable case if the test ever races).
 *   • After Town hydrates, go to /inventory, find the xp_boost stack
 *     tile, tap it → potion use popup opens, tap "✨ Aktywuj buff"
 *     button.
 *
 * ## Selector strategy for the elixir tile in /inventory
 *
 * `stackTiles` (Inventory.tsx ~2999) renders consumables as
 * `.inventory__bag-tile` shells with `.inventory__bag-tile-name`
 * = elixir.name_pl. We anchor on the elixir's name "Dopalacz XP" — it's
 * unique among the consumable list. After tap, the popup opens
 * (selector `.inventory__popup--use-potion`); we tap the buff confirm
 * button by its visible text "✨ Aktywuj buff" (Inventory.tsx line 4105).
 *
 * After buff is added, we go back to Town (since /inventory's
 * AppShell ALSO has TopHeader — we don't strictly need to navigate
 * away, but doing so confirms the buff persists across SPA routes).
 *
 * Cleanup: `cleanupCharacterById` in `finally`.
 *
 * Note on buff propagation: `addBuff` reads charId via the
 * `getCharId()` helper which checks `useCharacterStore.getState().character?.id`.
 * Since we're already in /inventory with the character selected,
 * this returns our seeded character's id, so the buff is correctly
 * scoped + visible in BuffPopover's `b.characterId === character.id`
 * filter (BuffPopover.tsx line 87).
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { seedConsumables } from '../../fixtures/seedInventory';
import { cleanupCharacterById } from '../../fixtures/cleanup';

test.describe('Shop › Elixirs', { tag: '@shop' }, () => {
    // Full flow: login + switch + hydrate + nav to inventory + open
    // elixir popup + activate buff + nav + open header popover + assert
    // — 7+ network/SPA steps. 60s default is borderline; 90s gives
    // headroom for cold WebKit.
    test.describe.configure({ timeout: 90_000 });

    test('using xp_boost elixir → buff appears in TopHeader dropdown with name + countdown', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            // 1. Seed Knight + 5× xp_boost in consumables.
            //    Level 1 is fine — xp_boost has minLevel: 1.
            //    hp_regen / mp_regen = 0 silences background HP/MP ticks
            //    so they don't race with our assertions on the header.
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: { hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            await seedConsumables({
                characterId: created.id,
                counts: { xp_boost: 5 },
            });

            // 2. Login → character-select → pick → Town.
            await loginViaUI(page, testUsers.primary);
            if (!page.url().endsWith('/character-select')) {
                await page.goto('/character-select');
            }
            await expect(page.locator('.char-select__card-name', { hasText: nick })).toBeVisible({ timeout: 10_000 });
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });
            await expect(page.locator('.town__char-name')).toHaveText(nick);

            // 3. BEFORE we use the elixir: confirm the TopHeader buff
            //    button is HIDDEN (no buffs active yet). totalBuffCount
            //    === 0 → button doesn't render (TopHeader line 296).
            await expect(page.locator('.top-header__buffs-btn')).toHaveCount(0);

            // 4. Navigate to /inventory via BottomNav "Postać" tab.
            await page.getByRole('button', { name: /^Postać$/i }).tap();
            await expect(page).toHaveURL(/\/inventory$/, { timeout: 10_000 });
            await expect(page.locator('.inventory')).toBeVisible({ timeout: 10_000 });

            // 5. Find the xp_boost stack tile in the bag grid.
            //    stackTiles render the elixir's name_pl — for xp_boost
            //    it's "Dopalacz XP" (shopStore.ts line 68).
            //    Anchor on the bag-tile that contains this name span.
            const elixirTile = page.locator('.inventory__bag-tile', {
                has: page.locator('.inventory__bag-tile-name', { hasText: /^Dopalacz XP$/ }),
            }).first();
            await expect(elixirTile).toBeVisible({ timeout: 10_000 });

            // 6. Tap the ItemIcon inside the tile (onClick wired on
            //    ItemIcon — see Inventory.tsx ~4687). The icon itself
            //    is `.item-icon` (TinyIcon component); we can tap the
            //    whole tile and the click bubble reaches the handler.
            //    On mobile-safari, force: true bypasses pointer-event
            //    interception during React re-render (same pattern as
            //    single-disassemble spec).
            await elixirTile.tap({ force: true });

            // 7. Use-potion popup opens (Inventory.tsx ~4014).
            //    `inventory__popup--use-potion` is the popup root.
            await expect(page.locator('.inventory__popup--use-potion')).toBeVisible({ timeout: 5_000 });

            // 8. Tap "✨ Aktywuj buff" (Inventory.tsx line 4105). This
            //    calls `applyElixirDose(xp_boost)` → `addBuff(xp_boost_1h,
            //    3_600_000ms)` → `useInventoryStore.addConsumable(xp_boost, -1)`.
            const activateBtn = page.locator('.inventory__use-potion-btn--use', {
                hasText: /Aktywuj buff/i,
            });
            await expect(activateBtn).toBeVisible();
            await activateBtn.tap();

            // 9. Popup auto-closes (onClick wraps applyElixirDose +
            //    close()). Wait for it.
            await expect(page.locator('.inventory__popup--use-potion')).toHaveCount(0, { timeout: 5_000 });

            // 10. TopHeader buff button NOW appears (totalBuffCount went
            //     from 0 → 1). The count chip shows "1".
            const buffsBtn = page.locator('.top-header__buffs-btn');
            await expect(buffsBtn).toBeVisible({ timeout: 5_000 });
            await expect(buffsBtn.locator('.top-header__buffs-count')).toHaveText('1');

            // 11. Tap the buff button to open the BuffPopover.
            await buffsBtn.tap();
            const popover = page.locator('.buff-popover');
            await expect(popover).toBeVisible({ timeout: 5_000 });

            // 12. The popover shows ONE buff row (xp_boost is the only
            //     active buff). Verify a row with an "XP"-bearing name
            //     plus a time chip is present. We don't pin to the exact
            //     name copy because BUFF_CONFIG[xp_boost_1h].name can be
            //     "XP Boost +50%" or "+50% XP (polowanie)" depending on
            //     when this test runs vs. spec tweaks — both legitimately
            //     match `/XP/i`.
            const buffRow = popover.locator('.buff-popover__row').first();
            await expect(buffRow).toBeVisible();
            await expect(buffRow.locator('.buff-popover__row-name')).toContainText(/XP/i);

            // 13. The time chip shows a "Xh YYm" / "Xm Ys" / "Xs" formatted
            //     countdown (formatTimeLeft in BuffPopover line 21-30).
            //     For a 1-hour buff the freshly-activated chip is in the
            //     "Xh YYm" form. We allow an optional "⏸ " prefix because
            //     xp_boost is in BuffPopover's `COMBAT_ONLY_EFFECTS` set
            //     (line 18) — when activated outside of combat the popover
            //     prepends the ⏸ marker to show that the buff timer is
            //     paused until the player enters combat (BuffPopover line 144).
            //     The Town view is "out of combat" so this branch is hit.
            //     Match "1h 00m" or "59m XXs" (edge case if timer rolled).
            await expect(buffRow.locator('.buff-popover__row-time'))
                .toHaveText(/^(⏸\s*)?(1h\s*00m|59m\s*\d{2}s)$/, { timeout: 5_000 });
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
