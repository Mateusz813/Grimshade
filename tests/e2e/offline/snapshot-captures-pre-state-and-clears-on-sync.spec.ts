/**
 * Atomic E2E — BACKLOG 14.2 (anti-hack — no duplication on offline <-> online).
 *
 * Pragmatic scope (per task brief): instead of trying to reproduce a full
 * "duplicate items in offline mode" exploit (which would need a planted
 * vulnerability + injection vector — not realistic without an actual
 * bug to reproduce), we verify the SNAPSHOT LIFECYCLE that's the
 * underlying anti-dupe defence:
 *
 *   1. Going offline writes a trusted baseline to sessionStorage
 *      (`grimshade.offlineSnapshot`) capturing pre-offline gold + item
 *      count + level + XP. This is what `computeOfflineDelta` later
 *      compares against to flag suspicious inflation.
 *   2. Going back online forces a full Supabase sync via
 *      `saveCurrentCharacterStores()` and ONLY clears the snapshot when
 *      that sync resolves. If the sync fails (offline at OS level), the
 *      snapshot is retained so the next attempt can still compare.
 *
 * The seeded gold acts as a deterministic anchor: a fresh seed of
 * 12345 gp means we can both (a) assert the snapshot captured that
 * exact pre-state and (b) confirm no inflation happened by checking
 * the canonical Supabase row carries the SAME value after the
 * full online -> offline -> online cycle (no offline-action this run —
 * "no-op offline session" should produce zero delta).
 *
 * Spec source: `src/systems/connectivityTransitions.ts` (captureOfflineSnapshot,
 * computeOfflineDelta, transitionToOffline, transitionToOnline);
 * `src/stores/connectivityStore.ts` (IOfflineSnapshot shape, sessionStorage
 * persistence key `grimshade.offlineSnapshot`).
 *
 * Why this is the contract worth pinning:
 *   - If captureOfflineSnapshot ever silently no-ops, anti-cheat audit
 *     trail goes dark (no baseline -> no delta).
 *   - If transitionToOnline clears the snapshot WITHOUT first persisting
 *     the live state, a player could keep playing offline-mode forever
 *     with no canonical row to roll back to.
 *   - If the snapshot survives a successful sync, the next offline dip
 *     would compare against a stale baseline and over-report delta.
 *
 * Setup:
 *   1. Seed character with gold=12345 (deterministic anchor) via
 *      seedGameSave — switchToCharacter reads inventory.gold from the
 *      blob.
 *   2. Login + select character -> Town hydrates inventoryStore.gold to
 *      12345.
 *   3. Tap Offline in AvatarMenu -> captureOfflineSnapshot runs.
 *   4. Read sessionStorage to confirm snapshot.gold === 12345 (baseline
 *      captured pre-state, not inflated).
 *   5. Tap Online -> transitionToOnline runs -> snapshot should clear
 *      after sync resolves.
 *   6. Query game_saves directly to confirm canonical row matches
 *      seeded 12345 (no inflation since we didn't actually act offline).
 *
 * The throttle in `saveCurrentCharacterStores` (4 s window) COULD swallow
 * the post-toggle sync — to keep the test deterministic we force a
 * non-throttled save via `saveCurrentCharacterStoresForce()` after the
 * online transition. The transition itself is what we're testing; the
 * force-save just guarantees the assert window doesn't race the throttle.
 *
 * Cleanup: try/finally + cleanupCharacterById per CLAUDE.md TESTING hard
 * rule. The character itself + its game_saves row + sessionStorage all
 * die with the test context.
 */

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
            // 1. Seed Knight + game_saves blob with deterministic gold anchor.
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

            // 2. Login + select character -> Town hydrates inventoryStore.gold.
            await loginViaUI(page, testUsers.primary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 10_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
            // Town render gate so inventoryStore is guaranteed hydrated
            // before we trigger the transition (snapshot reads from
            // useInventoryStore.getState()).
            await expect(page.locator('.town__char-name')).toHaveText(nick, { timeout: 10_000 });

            // Sanity: TopHeader gold reflects seeded value. pl-PL
            //    toLocaleString uses NBSP between thousands -> "12 345".
            //    aria-label format: "Złoto: <localized>".
            const goldBtn = page.locator('.top-header__gold-btn');
            await expect(goldBtn).toHaveAttribute('aria-label', /Złoto:\s+12[\s\xa0]?345/, { timeout: 10_000 });

            // 3. Pre-snapshot sanity: sessionStorage MUST be clean (fresh boot,
            //    online mode default). If a previous test left a stale snapshot
            //    in the same browser context this would skew assertion #5.
            const preSnap = await page.evaluate(() => sessionStorage.getItem('grimshade.offlineSnapshot'));
            expect(preSnap).toBeNull();

            // 4. Tap Offline via AvatarMenu (same path as test 14.1 covers UI,
            //    here we use it to drive captureOfflineSnapshot).
            const avatarBtn = page.getByRole('button', { name: /menu postaci/i });
            await avatarBtn.tap();
            const modeToggle = page.locator('.avatar-menu__lang-toggle').nth(1);
            const offlineBtn = modeToggle.locator('.avatar-menu__lang-btn', { hasText: /^Offline$/ });
            await expect(offlineBtn).toBeVisible({ timeout: 5_000 });
            await offlineBtn.tap();

            // 5. Snapshot landed in sessionStorage with seeded gold value.
            //    Poll because setSnapshot -> sessionStorage write happens
            //    inside transitionToOffline -> captureOfflineSnapshot -> which
            //    is sync but mounted via dynamic-import (await on caller).
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

            // 6. Status dot flipped to --offline — sanity check the UI hook
            //    actually ran (else we'd be asserting against an unrelated
            //    pre-existing snapshot from some other code path).
            const statusDot = page.locator('.top-header__status-dot');
            await expect(statusDot).toHaveClass(/top-header__status-dot--offline/, { timeout: 5_000 });

            // 7. Tap Online -> transitionToOnline -> forces save + clears
            //    snapshot. The button is still rendered (menu didn't close).
            const onlineBtn = modeToggle.locator('.avatar-menu__lang-btn', { hasText: /^Online$/ });
            await onlineBtn.tap();
            await expect(statusDot).toHaveClass(/top-header__status-dot--online/, { timeout: 5_000 });

            // 8. Force a non-throttled save so the post-transition Supabase
            //    write is guaranteed to land before we query game_saves
            //    below. transitionToOnline awaits saveCurrentCharacterStores
            //    (throttled — could no-op if a previous auto-save fired
            //    <4 s ago) and then clears the snapshot — but the snapshot
            //    clear depends on the save succeeding. Forcing here pins
            //    both behaviours to a deterministic timeline.
            await page.evaluate(async () => {
                // @ts-expect-error — dev-time Vite URL not resolvable by tsc
                const mod = await import('/src/stores/characterScope.ts');
                await (mod as { saveCurrentCharacterStoresForce: () => Promise<void> })
                    .saveCurrentCharacterStoresForce();
            });

            // 9. Snapshot was cleared once sync resolved. Poll because the
            //    setSnapshot(null) -> sessionStorage.removeItem hop is
            //    behind the saveCurrentCharacterStores promise.
            await expect.poll(
                () => page.evaluate(() => sessionStorage.getItem('grimshade.offlineSnapshot')),
                { timeout: 10_000 },
            ).toBeNull();

            // 10. Canonical Supabase row carries the SAME gold (no offline
            //     action this run -> zero delta -> no inflation). This is the
            //     "anti-hack" pin: even after a full online->offline->online
            //     cycle, the trusted state is preserved unchanged.
            const admin = getAdminClient();
            const { data, error } = await admin
                .from('game_saves')
                .select('state')
                .eq('character_id', createdId)
                .single();
            expect(error).toBeNull();
            // state.inventory.gold path mirrors STORE_ENTRIES['inventory']
            //    in src/stores/characterScope.ts (line 175).
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
