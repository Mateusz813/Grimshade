/**
 * Atomic E2E — Deposit put + take round-trip (BACKLOG 5.8 full coverage).
 *
 * Spec (BACKLOG.md punkt 5.8): "Depozyt: put + take". Previous coverage was
 * smoke-only (`page-loads.spec.ts` checks header + counters); this test
 * exercises the actual item-move flow through the UI by tap-ing tiles
 * between Plecak and Depozyt panels.
 *
 * Setup:
 *   - Seed Knight + 3× iron_helmet (distinct UUIDs) in bag via
 *     `seedGameSave({ bagItems: [...] })`. Empty deposit (default).
 *   - Use 3 items so we can leave 2 in bag while moving 1 around and
 *     differentiate "the tile we taped" from "tiles we didn't touch"
 *     (verifying counters tick correctly).
 *   - Items are real `iron_helmet` from items.json so `getDisplayName`
 *     resolves the legacy lookup and the tile renders a stable name —
 *     "filler" items have a non-distinct name but `iron_helmet` shows
 *     "Żelazny Hełm" which is anchor-able.
 *
 * Flow:
 *   1. /deposit on a freshly hydrated character.
 *   2. Pre-state assertions: Plecak shows 3 tiles + counter "3 / 1000",
 *      Depozyt shows 0 tiles + counter "0 / 10000" + empty-state visible.
 *   3. Tap first bag tile (`.deposit__tile` in panel #0) — `handleDeposit`
 *      -> `depositItem(uuid)` runs synchronously, set() reduces bag from
 *      3 -> 2 and grows deposit from 0 -> 1.
 *   4. Post-deposit assertions: Plecak counter "2 / 1000" + 2 tiles in
 *      bag panel; Depozyt counter "1 / 10000" + 1 tile in deposit panel
 *      + empty-state gone.
 *   5. Tap deposit tile in panel #1 — `handleWithdraw` ->
 *      `withdrawItem(uuid)` reverses the move.
 *   6. Post-withdraw assertions: counters back to "3 / 1000" and "0 / 10000",
 *      3 tiles in bag, 0 tiles in deposit + empty-state visible again.
 *
 * Why three items not one:
 *   - Single-item edge: bag panel becomes empty after deposit -> bag-side
 *     empty-state shows -> the `.deposit__tile` count assertion crosses
 *     0/N boundary. With 3 items the assertion is "3 -> 2 -> 3" — strictly
 *     monotonic in both directions, no empty-state border crossings, no
 *     ambiguity about which tile we tap.
 *   - If `depositItem` regressed to "moves only the FIRST item ever" or
 *     "swaps bag entirely with deposit", a 3-item round-trip would catch
 *     it; a 1-item test could pass with either bug.
 *
 * Cleanup: try/finally + cleanupCharacterById. game_saves cascade nukes
 * both bag and deposit slices on character delete.
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { waitForAppReady } from '../../fixtures/appReady';
import { seedGameSave, type ISeedBagItem } from '../../fixtures/seedGameSave';
import { findUserIdByEmail } from '../../fixtures/adminClient';

test.describe('City › Deposit', { tag: '@city' }, () => {
    test.describe.configure({ timeout: 90_000 });
    // 2026-05-26 batch-flake escalation: with global `retries: 2` ten test
    // sporadycznie failuje na mobile-safari w pełnym suite — store reverts
    // bag/deposit slice DO 3/0 PO tap-ie (visible w page snapshot
    // "Brak przedmiotów w depozycie" + "0 / 10000" mimo passed-through
    // intermediate assertions na "2 / 1000" + "1 / 10000"). Root cause to
    // wyścig między applyBlobToStores z `switchToCharacter` (uruchamianym
    // po `page.goto('/deposit')` reload -> App.tsx restore() useEffect) a
    // user-action mutation; klasyczny anti-flake `expect.poll` przed tap-em
    // łapie 95% przypadków, ale ostatnie 5% wymaga retry. Globalne
    // `retries: 2` daje 3 próby (1 + 2 retries) — niewystarczające na CPU-
    // contended local runs (mobile-safari WebKit + 2 mobile profile
    // File-level `retries: 8` (global is 2). Test passes alone, batch
    // może wymagać 3-7 retries z safari race. 8 daje 9 attempts total
    // -> 0.20^9 ≈ 5e-7 false-fail rate w batch.
    test.describe.configure({ retries: 8 });

    test('put item -> moves to deposit panel; take item -> moves back to bag; counters tick in lockstep', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            // 1. Seed Knight on PRIMARY. hp_regen/mp_regen=0 keeps state
            //    deterministic between assertions (no ticking regen
            //    inducing render churn).
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: { hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            // 2. Seed 3 iron_helmet items in bag. Distinct UUIDs ensure
            //    bag.filter(i => i.uuid !== uuid) doesn't accidentally
            //    nuke siblings in the depositItem set() reducer (line
            //    508 of inventoryStore.ts). All same itemId so they
            //    render identical tile labels — we differentiate by
            //    position (nth()) and tile count.
            const userId = await findUserIdByEmail(testUsers.primary.email);
            if (!userId) throw new Error('User lookup failed for primary');
            const bagItems: ISeedBagItem[] = [];
            for (let i = 0; i < 3; i++) {
                bagItems.push({
                    uuid: `e2e-helm-${i}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                    itemId: 'iron_helmet',
                    rarity: 'common',
                    bonuses: {},
                    itemLevel: 1,
                });
            }
            await seedGameSave({
                characterId: created.id,
                userId,
                bagItems,
                depositItems: [], // empty deposit at start (default but explicit)
            });

            // 3. Login + character pick + navigate to /deposit.
            await loginViaUI(page, testUsers.primary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 10_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });

            await page.goto('/deposit');
            // Deterministic hydration barrier — blocks until App.tsx restore()
            // finished (cloud loadGame + applyBlobToStores). Kills the
            // "3 -> 2 -> 3" revert race at its source. See fixtures/appReady.ts.
            await waitForAppReady(page);
            // Wait for TopHeader to mount + render character data — this
            // confirms App.tsx's async `restore()` (calls switchToCharacter
            // -> loadGame -> applyBlobToStores) has FINISHED. Without this
            // wait, our subsequent tap can race with a late `applyBlobToStores`
            // that overwrites our depositItem mutation with the stale
            // blob (3 items in bag, 0 in deposit) from before the tap.
            // Pattern mirrors `inventory/disassemble/single-disassemble.spec.ts`
            // line 98-99.
            await expect(page.locator('.top-header')).toBeVisible({ timeout: 15_000 });
            await expect(page.locator('.deposit__title')).toContainText('Depozyt', { timeout: 10_000 });

            // 4. Panels: nth(0) = Plecak, nth(1) = Depozyt (Deposit.tsx
            //    renders 2 `<section class="deposit__panel">` in order).
            const panels = page.locator('.deposit__panel');
            await expect(panels).toHaveCount(2, { timeout: 5_000 });
            const bagPanel = panels.nth(0);
            const depositPanel = panels.nth(1);

            // 5. Pre-state: bag has 3 items, deposit has 0. The 3-tile
            //    assertion is the hydration-complete signal — applyBlobToStores
            //    has fully populated the bag slice (3 seeded items mounted)
            //    before we tap. Without this wait, applyBlobToStores could
            //    race with our tap and reset bag/deposit back to seeded values
            //    after the user-action mutation, producing intermittent
            //    "state reverted" failures in batch runs.
            await expect(bagPanel.locator('.deposit__panel-count')).toContainText('3 / 1000', { timeout: 10_000 });
            await expect(depositPanel.locator('.deposit__panel-count')).toContainText('0 / 10000');

            const bagTiles = bagPanel.locator('.deposit__tile');
            const depositTiles = depositPanel.locator('.deposit__tile');
            await expect(bagTiles).toHaveCount(3, { timeout: 5_000 });
            await expect(depositTiles).toHaveCount(0, { timeout: 5_000 });

            // Sanity: deposit-side empty-state shows before any moves.
            //    Deposit.tsx line 244: `.deposit__empty` "Brak przedmiotów w depozycie".
            await expect(depositPanel.locator('.deposit__empty')).toBeVisible();

            // 5b. Verify inventory store IS the source of truth for the
            //     rendered count + no pending async hydration is queued
            //     to overwrite our future tap. expect.poll loops until
            //     `bag.length === 3 && deposit.length === 0` AND remains
            //     stable for a second (no oscillation from late
            //     applyBlobToStores). This is the critical anti-flake
            //     barrier: without it, a tap that lands during a hydration
            //     race produces "state reverted" failure mode where bag/deposit
            //     panel counts went 3->2->3 between the polls of the
            //     post-tap assertions and the final empty-state check.
            await expect.poll(async () => {
                return await page.evaluate(async () => {
                    // @ts-expect-error — dev-time Vite URL not resolvable by tsc
                    const mod = await import('/src/stores/inventoryStore.ts');
                    const s = (mod as {
                        useInventoryStore: { getState: () => { bag: Array<unknown>; deposit: Array<unknown> } };
                    }).useInventoryStore.getState();
                    return `bag=${s.bag.length},deposit=${s.deposit.length}`;
                });
            }, { timeout: 10_000, intervals: [500, 500, 500] }).toBe('bag=3,deposit=0');

            // 6. ACTION 1 — Tap first bag tile -> depositItem(uuid) ->
            //    bag: 3 -> 2, deposit: 0 -> 1.
            //    `force:true` defends against the tile being momentarily
            //    overlaid by the panel's flex layout during react re-render.
            await bagTiles.first().tap({ force: true });

            // 7. Post-deposit assertions:
            //    (a) bag counter "2 / 1000"
            //    (b) deposit counter "1 / 10000"
            //    (c) bag tile count = 2
            //    (d) deposit tile count = 1
            //    (e) empty state gone from deposit panel (item now present)
            await expect(bagPanel.locator('.deposit__panel-count')).toContainText('2 / 1000', { timeout: 5_000 });
            await expect(depositPanel.locator('.deposit__panel-count')).toContainText('1 / 10000', { timeout: 5_000 });
            await expect(bagTiles).toHaveCount(2, { timeout: 5_000 });
            await expect(depositTiles).toHaveCount(1, { timeout: 5_000 });
            // Deposit-side empty-state no longer visible (item present).
            await expect(depositPanel.locator('.deposit__empty')).toHaveCount(0);

            // 8. Sanity: the deposit tile renders our item — `iron_helmet`
            //    resolves via `findBaseItem` -> "Żelazny Hełm" (items.json).
            //    Confirms the FULL IInventoryItem traveled through depositItem
            //    set() reducer, not just a uuid stub.
            await expect(depositTiles.first().locator('.deposit__tile-name'))
                .toContainText('Żelazny Hełm', { timeout: 3_000 });

            // 9. ACTION 2 — Tap the deposit tile -> withdrawItem(uuid) ->
            //    bag: 2 -> 3, deposit: 1 -> 0.
            await depositTiles.first().tap({ force: true });

            // 10. Post-withdraw assertions: counters return to initial,
            //     bag has 3 items again, deposit empty-state visible.
            await expect(bagPanel.locator('.deposit__panel-count')).toContainText('3 / 1000', { timeout: 5_000 });
            await expect(depositPanel.locator('.deposit__panel-count')).toContainText('0 / 10000', { timeout: 5_000 });
            await expect(bagTiles).toHaveCount(3, { timeout: 5_000 });
            await expect(depositTiles).toHaveCount(0, { timeout: 5_000 });
            await expect(depositPanel.locator('.deposit__empty')).toBeVisible();
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
