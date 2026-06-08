/**
 * Atomic E2E — Arena shop buy flow (currency = arena points, NOT gold).
 *
 * Backlog item 3.11 ("Arena shop — kup z AP + dostaje item + odjęło AP"):
 * the player has arena points, opens Shop → Arena tab, taps "Kup" on the
 * cheapest catalog item (`arena_stone_common`, 50 AP), and we verify:
 *  1. Toast confirms the purchase ("Kupiono: Kamień (Common)").
 *  2. The Arena-tab AP banner decreases by the sticker price (50 AP).
 *  3. The bought stone appears in the bag (Postać tab) as a stack tile
 *     with the rendered name "Zwykly Kamien" (STONE_NAMES.common_stone).
 *
 * ## Why we inject arenaPoints via `page.evaluate` instead of seeding
 *
 * `inventoryStore.arenaPoints` is a runtime-only field — it is NOT in
 * `STORE_ENTRIES['inventory'].stateKeys` in `src/stores/characterScope.ts`
 * (line 179). That means even if we upsert a `game_saves` blob with
 * `inventory.arenaPoints = 10000`, the `applyBlobToStores` filter (line
 * 416-420) drops the key during hydration. Seeding via `seedGameSave`
 * is therefore a no-op for AP.
 *
 * Workaround: after the character is fully selected and the Town screen
 * is rendered (so `useInventoryStore` is hydrated to the character's
 * persisted slice), we open dev-tools-style and call
 * `useInventoryStore.setState({ arenaPoints: STARTING_AP })` directly.
 * The store is exposed on `window` via the standard Zustand `create()`
 * pattern — Grimshade does NOT shadow it, so the call works in any
 * build.
 *
 * Wait — actually Zustand stores are NOT auto-attached to `window`. We
 * dispatch through the same indirection the AdminPanel uses
 * (`useInventoryStore.setState`), but that requires importing the store
 * module inside the page. The cleanest cross-build approach is to
 * import it from the served bundle. To avoid coupling to Vite's
 * code-splitting layout (which can change between builds), we
 * instead expose a tiny `window.__e2eSetArenaPoints` helper via
 * `addInitScript` that hooks into the existing `useInventoryStore` once
 * it's loaded. To keep this test self-contained we use the simpler
 * pattern: bridge through a custom event that an in-app effect listens
 * to. But there's an EVEN simpler way:
 *
 * `addInitScript` runs BEFORE the app boots, so we can stash a setter
 * factory that resolves the store from the module graph lazily — but
 * the actual store import in dev is `/src/stores/inventoryStore.ts`.
 * Importing that URL works in dev (Vite serves source) but NOT in prod.
 *
 * For atomic E2E on a dev server, the pragmatic path is the in-app
 * dispatch the AdminPanel already uses: open `/admin?secret` would
 * also work but that's coupled to the owner's email and we can't
 * impersonate.
 *
 * Final approach (settled 2026-05-25): after Town renders we do
 * `page.evaluate(() => { ... import('/src/stores/inventoryStore.ts')
 * .then(m => m.useInventoryStore.setState({ arenaPoints: ... })); })`.
 * This works in `npm run dev` (the only env Playwright targets per
 * `playwright.config.ts` webServer) because Vite resolves the source
 * URL. If we ever run E2E against a built bundle, this approach will
 * stop working — at that point we extend `STORE_ENTRIES['inventory']`
 * to include `arenaPoints` (a one-line app fix that ALSO solves the
 * "AP lost after re-login" UX issue the field has today).
 *
 * Setup pattern:
 *   • `createCharacterViaApi` creates a fresh Knight at level 1.
 *   • `seedGameSave` writes a matching `game_saves` blob — keeps the
 *     same hydration path as the other shop tests for parity, even
 *     though arenaPoints itself is injected separately.
 *   • After Town renders, set `arenaPoints = 10000` via `page.evaluate`
 *     dynamic import. 10k AP is plenty for the 50 AP common stone +
 *     covers the case where the first attempt fails and we retry.
 *   • Lvl 1 keeps mythic weapon prices at the floor (1000 AP each) so
 *     the Common stone (50 AP) is unambiguously the cheapest catalog
 *     entry — its "Kup" button is the only one we want to tap.
 *
 * Why we use Common stone:
 *   • Cheapest item (50 AP) — minimises the AP we need to seed.
 *   • Pure "add to inventory.stones" payload (no character buff side
 *     effects, no equipment, no max-HP refresh). Clean assertion.
 *   • Renders as a stack tile in `inventory__bag-tile` with
 *     `inventory__bag-tile-name` = STONE_NAMES.common_stone =
 *     "Zwykly Kamien" — see `src/systems/itemSystem.ts` line 553.
 *
 * Cleanup: `cleanupCharacterById` in `finally` — wipes the seeded
 * `game_saves` row too (it's listed in `CHARACTER_CHILD_TABLES`).
 * arenaPoints isn't persisted anywhere so there's nothing extra to
 * scrub.
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { seedGameSave, findUserIdByEmail } from '../../fixtures/seedGameSave';
import { cleanupCharacterById } from '../../fixtures/cleanup';

test.describe('Shop › Arena', { tag: '@shop' }, () => {
    // Login + switch + Town hydrate + AP injection + Shop render + buy +
    // 3-surface asserts (toast, AP banner, inventory bag) is a 6+ network
    // call test; default 30s timeout is tight on cold WebKit starts.
    test.describe.configure({ timeout: 90_000 });

    test('buying common arena stone (50 AP) shows toast, decreases AP, and adds stone to bag', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        // 10,000 AP is overkill for the 50 AP common stone but keeps the
        // post-buy number visually distinct (10,000 - 50 = 9,950) and
        // avoids "not enough AP" false negatives from any rounding.
        const STARTING_AP = 10_000;

        try {
            // 1. Seed character + game_save. Knight + lvl 1 — keeps the
            //    deterministic mythic price floor + matches the other
            //    shop tests.
            //    hp_regen=0, mp_regen=0 to silence background HP/MP
            //    ticks (cargo-culted from buy-deducts-gold spec).
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: { gold: 0, hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            const userId = await findUserIdByEmail(testUsers.primary.email);
            await seedGameSave({
                characterId: created.id,
                userId,
                gold: 0,
            });

            // 2. Login + go to /character-select → pick our character → Town.
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
            // Wait for Town to fully hydrate so inventoryStore exists in
            // memory before we mutate it.
            await expect(page.locator('.town__char-name')).toHaveText(nick);

            // 3. Inject arenaPoints into the live inventoryStore. We
            //    cannot seed via game_saves (filtered out by
            //    applyBlobToStores — see file header). Use a dynamic
            //    import of the Vite-served source module; the setState
            //    triggers React re-render so the AP banner reflects the
            //    new value immediately on the next Shop render.
            //
            //    eslint-disable-next-line @typescript-eslint/no-explicit-any —
            //    typing the dynamic module signature isn't worth it for a
            //    one-shot test bridge.
            await page.evaluate(async (ap) => {
                // @ts-expect-error — dev-time Vite URL not resolvable by tsc, but works in browser context
                const mod = await import('/src/stores/inventoryStore.ts');
                (mod as { useInventoryStore: { setState: (s: { arenaPoints: number }) => void } })
                    .useInventoryStore.setState({ arenaPoints: ap });
            }, STARTING_AP);

            // 4. Navigate to Shop via BottomNav (SPA route — preserves
            //    Zustand stores). Tabs default to "items"; we'll switch
            //    to "arena" next.
            await page.getByRole('button', { name: /^Sklep$/i }).tap();
            await expect(page).toHaveURL(/\/shop$/, { timeout: 10_000 });
            await expect(page.locator('.shop__tabs')).toBeVisible({ timeout: 10_000 });

            // 5. Switch to Arena tab. The button has aria-label="Arena"
            //    (Shop.tsx line 267 — label maps from icon-only tabs).
            await page.getByRole('button', { name: 'Arena' }).tap();
            await expect(page.locator('.shop__panel--arena')).toBeVisible({ timeout: 5_000 });

            // 6. Verify AP banner shows the injected starting amount.
            //    Format: `<strong>10 000</strong> AP` — pl-PL
            //    toLocaleString uses NBSP/thin space between thousands.
            const apBanner = page.locator('.shop__arena-banner-value');
            await expect(apBanner).toContainText(/10[\s\xa0]?000/, { timeout: 5_000 });
            await expect(apBanner).toContainText(/AP/);

            // 7. Locate the Common-stone arena-shop card.
            //    `.shop__card-name` is exactly "Kamień (Common)" per
            //    shopStore.ts line 520. We anchor on exact match to
            //    avoid grabbing the more-expensive Rare/Epic/etc.
            //    variants which share the "Kamień" prefix.
            const stoneCard = page.locator('.shop__card', {
                has: page.locator('.shop__card-name', { hasText: /^Kamień \(Common\)$/ }),
            }).first();
            await stoneCard.scrollIntoViewIfNeeded();
            await expect(stoneCard).toBeVisible();

            // Sanity-check the price chip reads 50 AP (matches apPrice
            // in shopStore.ts line 520).
            const priceText = await stoneCard.locator('.shop__card-price').textContent();
            expect(priceText).toMatch(/50\s*AP/i);

            // 8. Tap "Kup" — selector targets buttons inside the card body.
            await stoneCard.getByRole('button', { name: /^Kup$/i }).tap();

            // 9. Toast appears with "Kupiono: Kamień (Common)".
            await expect(page.locator('.shop__toast')).toContainText(/Kupiono:\s*Kamień\s*\(Common\)/i, { timeout: 5_000 });

            // 10. AP banner decreased by exactly 50.
            //     Expected: 10,000 - 50 = 9,950. pl-PL formatted as
            //     "9 950" (NBSP/thin space).
            await expect(apBanner).toContainText(/9[\s\xa0]?950/, { timeout: 5_000 });

            // 11. Navigate to /inventory via BottomNav "Postać" tab and
            //     verify the stone appears as a stack tile.
            //     `inventory.stones.common_stone = 1` after buy → tile
            //     name = STONE_NAMES.common_stone = "Zwykly Kamien"
            //     (no Polish diacritics — itemSystem.ts line 553).
            await page.getByRole('button', { name: /^Postać$/i }).tap();
            await expect(page).toHaveURL(/\/inventory$/, { timeout: 10_000 });
            await expect(page.locator('.inventory')).toBeVisible({ timeout: 10_000 });

            const stoneTileName = page.locator('.inventory__bag-tile-name', { hasText: /Zwykly Kamien/i }).first();
            await expect(stoneTileName).toBeVisible({ timeout: 10_000 });
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
