/**
 * Multi-context E2E — party-leader flee broadcasts `combat-end` and members
 * receive it (BACKLOG 13.24 party branch — "Ucieczka (flee): działa solo +
 * party").
 *
 * Spec coverage: when a multi-human party LEADER invokes `stopCombat()`
 * mid-fight, combatEngine.ts line 2817-2826 lazy-imports
 * `usePartyCombatSyncStore` and calls `publishCombatEnd()` ->
 * partyCombatSyncStore.ts line 998-1010 broadcasts a `combat-end` event
 * on the `party-combat-<partyId>` Realtime channel. Each MEMBER's
 * `usePartyCombatSync` subscriber consumes the event (line 776) and
 * updates `lastCombatEnd` timestamp + the AppShell's auto-navigate
 * effect carries the member back to town.
 *
 * Without this broadcast, members would stay stuck in `/combat` with
 * stale shared-arena state after the leader bails (2026-05-12 spec
 * "lider konczy polowanie -> sojusznicy wracaja do miasta" cited in
 * combatEngine line 2811-2815).
 *
 * ## Pragmatic adaptation vs full UI flow
 *
 * Full UI = (1) primary creates party, (2) secondary joins, (3) primary
 * navigates to /combat, (4) start real fight -> wait for `phase==='fighting'`
 * on both clients, (5) primary opens HuntExitDialog, (6) primary taps
 * "Zakończ polowanie" -> invokes `stopCombat()`, (7) secondary auto-navs
 * to /battle. Steps 4-7 involve live attack-cadence timing, Realtime hop
 * latency (5-10s worst case on mobile-chrome), HuntExitDialog modal taps,
 * and React-effect-driven navigation transitions — each one a flake
 * surface.
 *
 * The CONTRACT we care about is "leader's `stopCombat()` -> member's
 * `lastCombatEnd` timestamp updates". We invoke `stopCombat()` directly
 * on primary's page (same call site as the HuntExitDialog handler at
 * Combat.tsx line 2889) and assert secondary's `lastCombatEnd` advanced
 * within a reasonable Realtime window.
 *
 * What this proves:
 *   - The leader-broadcast branch in combatEngine.ts line 2817-2826 fires
 *     correctly when `iAmLeaderInPartyCombat===true`. Bug surface: if
 *     someone breaks the `usePartyCombatSyncStore` lazy import or the
 *     condition flip, the broadcast silently dies and members never
 *     receive the end signal.
 *   - The Realtime channel routing is wired — broadcast on
 *     `party-combat-<partyId>` reaches the secondary's subscriber on the
 *     same channel. Bug surface: channel name typo, subscriber filter
 *     drift.
 *   - Both clients agree on combat state post-leader-flee — primary
 *     `phase==='idle'`, secondary `lastCombatEnd > preTimestamp`.
 *
 * What this does NOT prove (separate test files):
 *   - Auto-navigation from /combat -> /battle on the member side
 *     (UI-level concern; would need members to actually be on /combat).
 *   - Member's own `stopCombat()` calls on receiving the broadcast
 *     (covered by usePartyCombatSync hook test if/when it exists).
 *   - Solo flee path (covered by `solo-stops-combat-preserves-character.spec.ts`).
 *
 * ## Test flow
 *
 *  1. Seed both characters lvl 10 + open multi-context (both logged in).
 *  2. Both pick character -> Town.
 *  3. Both nav to /party (Społeczność -> Party tile).
 *  4. Primary creates a public party.
 *  5. Secondary refreshes + joins.
 *  6. Synchronization barrier — both rosters show 2/4 (proves Realtime
 *     hello/join routing works, otherwise broadcast assertions are noise).
 *  7. Pre-snapshot secondary's `lastCombatEnd` (likely 0 or null).
 *  8. Stage a fight on PRIMARY via `combatStore.initCombat(rat)` —
 *     primary is leader of a 2-human party so the
 *     `iAmLeaderInPartyCombat` branch will arm.
 *  9. ACTION — invoke `stopCombat()` on primary's page directly. Same
 *     call site Combat.tsx HuntExitDialog handler uses.
 * 10. POLL secondary's `lastCombatEnd` until it advances above
 *     `pre` value. Generous 45s timeout per CLAUDE.md TESTING note
 *     about cumulative Realtime latency under load.
 * 11. ASSERT primary's `combatStore.phase === 'idle'` (proves the local
 *     `stopCombat` ran cleanly even with the broadcast side-effect).
 *
 * ## Cleanup
 *
 * Multi-context fixture handles party + character cleanup. 180s timeout
 * for multi-ctx + Realtime settling per CLAUDE.md TESTING rule.
 */

import { test, expect, type Page } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { openMultiContext } from '../../fixtures/multiContext';

/** Pick the seeded character -> land in Town. */
const pickCharacterAndEnterTown = async (page: Page, nick: string): Promise<void> => {
    if (!page.url().endsWith('/character-select')) {
        await page.goto('/character-select');
    }
    await expect(page.locator('.char-select__card-name', { hasText: nick }))
        .toBeVisible({ timeout: 15_000 });
    const card = page.locator('.char-select__card', {
        has: page.locator('.char-select__card-name', { hasText: nick }),
    });
    await card.getByRole('button', { name: /Wybierz/i }).tap();
    await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
    await expect(page.locator('.town__char-name')).toHaveText(nick);
};

/** Navigate to /party + wait for either intro or roster panel. */
const navToParty = async (page: Page): Promise<void> => {
    await page.getByRole('button', { name: /^Społeczność$/i }).tap();
    await expect(page).toHaveURL(/\/social$/, { timeout: 10_000 });
    await page.locator('.social__tile--party').tap();
    await expect(page).toHaveURL(/\/party$/, { timeout: 10_000 });
    await expect(page.locator('.party__intro-title, .party__roster').first())
        .toBeVisible({ timeout: 15_000 });
};

/** Read `partyCombatSyncStore.lastCombatEndAt` on the given page. */
const readLastCombatEndAt = async (page: Page): Promise<number> => {
    return await page.evaluate(async (): Promise<number> => {
        // @ts-expect-error — Vite URL
        const mod = await import('/src/stores/partyCombatSyncStore.ts');
        const state = (mod as {
            usePartyCombatSyncStore: { getState: () => { lastCombatEndAt: number } };
        }).usePartyCombatSyncStore.getState();
        return state.lastCombatEndAt;
    });
};

/** Read `combatStore.phase` on the given page. */
const readCombatPhase = async (page: Page): Promise<string> => {
    return await page.evaluate(async (): Promise<string> => {
        // @ts-expect-error — Vite URL
        const mod = await import('/src/stores/combatStore.ts');
        return (mod as {
            useCombatStore: { getState: () => { phase: string } };
        }).useCombatStore.getState().phase;
    });
};

test.describe('Combat › Flee', { tag: '@combat' }, () => {
    test.describe.configure({ timeout: 180_000 });

    test('party leader stopCombat() publishes combat-end -> secondary receives broadcast', async ({ browser }) => {
        const primaryNick = generateTestCharacterName();
        const secondaryNick = generateTestCharacterName();
        const partyName = `Flee ${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

        let primaryCharId: string | null = null;
        let secondaryCharId: string | null = null;
        let handles: Awaited<ReturnType<typeof openMultiContext>> | null = null;

        try {
            // 1. Seed two characters lvl 10 (Knight + Mage — class agnostic
            //    for this test; just need 2 humans so the leader's
            //    `iAmLeaderInPartyCombat` branch arms).
            const primaryCreated = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: primaryNick,
                class: 'Knight',
                overrides: { level: 10, highest_level: 10, hp_regen: 0, mp_regen: 0 },
            });
            primaryCharId = primaryCreated.id;
            const secondaryCreated = await createCharacterViaApi({
                userEmail: testUsers.secondary.email,
                name: secondaryNick,
                class: 'Mage',
                overrides: { level: 10, highest_level: 10, hp_regen: 0, mp_regen: 0 },
            });
            secondaryCharId = secondaryCreated.id;

            // 2. Open multi-context (parallel login).
            handles = await openMultiContext(browser);
            const { primaryPage, secondaryPage } = handles;

            // 3. Both pick character -> Town.
            await Promise.all([
                pickCharacterAndEnterTown(primaryPage, primaryNick),
                pickCharacterAndEnterTown(secondaryPage, secondaryNick),
            ]);

            // 4. Both nav to /party.
            await Promise.all([
                navToParty(primaryPage),
                navToParty(secondaryPage),
            ]);

            // 5. Primary creates public party.
            await primaryPage
                .locator('.party__primary-btn', { hasText: /Stwórz nowe party/i })
                .tap();
            await expect(primaryPage.locator('.party__create-form'))
                .toBeVisible({ timeout: 5_000 });
            await primaryPage.locator('.party__field', { hasText: /Nazwa party/i })
                .locator('input').fill(partyName);
            const primarySubmitBtn = primaryPage.locator('.party__form-actions')
                .getByRole('button', { name: /^Utwórz$/i });
            await expect(primarySubmitBtn).toBeEnabled({ timeout: 10_000 });
            await primarySubmitBtn.tap();
            await expect(primaryPage.locator('.party__roster')).toBeVisible({ timeout: 15_000 });

            // 6. Secondary refresh + join.
            await secondaryPage.locator('.party__refresh-btn').tap();
            const partyCard = secondaryPage.locator('.party__card', {
                has: secondaryPage.locator('.party__card-name', { hasText: partyName }),
            });
            await expect(partyCard).toBeVisible({ timeout: 15_000 });
            const joinBtn = partyCard.locator('.party__primary-btn', { hasText: /^Dołącz$/i });
            await expect(joinBtn).toBeEnabled({ timeout: 10_000 });
            await joinBtn.tap();

            // Synchronization barrier — both rosters at 2/4.
            // The leader's `stopCombat()` reads partyStore.party.members to
            // decide `iAmLeaderInPartyCombat` (combatEngine.ts line 2817).
            // If party state hasn't propagated, broadcast WON'T fire. 45s:
            // the cross-context Realtime broadcast (secondary's join reaching
            // primary) can take 15-25s under full-suite load.
            await expect(primaryPage.locator('.party__roster-meta'))
                .toContainText(/2\/4\s+graczy/i, { timeout: 45_000 });
            await expect(secondaryPage.locator('.party__roster-meta'))
                .toContainText(/2\/4\s+graczy/i, { timeout: 45_000 });

            // 6b. Realtime party-combat channel must be subscribed on BOTH
            //     sides BEFORE primary triggers stopCombat. The subscriber
            //     is set up by `subscribe(partyId)` in partyCombatSyncStore
            //     which sets `channel` to a non-null RealtimeChannel +
            //     `partyId` to the joined party id. Poll partyId on
            //     secondary — when it matches a non-null UUID, the
            //     subscriber is mounted.
            await expect.poll(
                async () => {
                    return await secondaryPage.evaluate(async () => {
                        // @ts-expect-error — Vite URL
                        const mod = await import('/src/stores/partyCombatSyncStore.ts');
                        const state = (mod as {
                            usePartyCombatSyncStore: { getState: () => { partyId: string | null } };
                        }).usePartyCombatSyncStore.getState();
                        return state.partyId;
                    });
                },
                {
                    timeout: 45_000,
                    message: 'Waiting for secondary to subscribe to party-combat channel',
                },
            ).not.toBeNull();

            // 7. PRE-snapshot — secondary's lastCombatEndAt. 0 on a brand-new
            //    subscription (init value at line 726).
            const preLastCombatEndAt = await readLastCombatEndAt(secondaryPage);

            // 8. Stage a fight on PRIMARY via direct `initCombat`. We don't
            //    need real combat damage — `stopCombat()` only checks
            //    `cs.phase === 'fighting' || cs.phase === 'victory'` to
            //    decide whether to broadcast. initCombat sets phase to
            //    'fighting' synchronously.
            await primaryPage.evaluate(async () => {
                // @ts-expect-error — Vite URL
                const engineMod = await import('/src/systems/combatEngine.ts');
                // @ts-expect-error — Vite URL
                const combatMod = await import('/src/stores/combatStore.ts');
                const engine = engineMod as { getAllMonsters: () => Array<{ id: string }> };
                const useCombatStore = (combatMod as {
                    useCombatStore: {
                        getState: () => {
                            initCombat: (m: unknown, hp: number, mp: number, rarity?: string) => void;
                        };
                    };
                }).useCombatStore;
                const rat = engine.getAllMonsters().find((m) => m.id === 'rat');
                if (!rat) throw new Error('[stage fight] rat monster not found');
                useCombatStore.getState().initCombat(rat, 120, 30, 'normal');
            });

            // Sanity — primary phase is 'fighting' so the stopCombat
            // broadcast branch will arm.
            expect(await readCombatPhase(primaryPage)).toBe('fighting');

            // 9. ACTION — invoke `stopCombat()` on primary (the leader).
            //    Same call site Combat.tsx HuntExitDialog handler uses at
            //    line 2889. Because primary is leader of a 2-human party,
            //    combatEngine.ts line 2820-2826 fires `publishCombatEnd()`.
            await primaryPage.evaluate(async () => {
                // @ts-expect-error — Vite URL
                const engineMod = await import('/src/systems/combatEngine.ts');
                const engine = engineMod as { stopCombat: () => void };
                engine.stopCombat();
            });

            // 10. POLL secondary's lastCombatEndAt until it advances past
            //     the pre value. Generous 45s window per CLAUDE.md TESTING
            //     note about cumulative Realtime latency on mobile-chrome
            //     under load (cited in `realtime/reconnect-after-page-reload.spec.ts`).
            await expect.poll(
                async () => {
                    const cur = await readLastCombatEndAt(secondaryPage);
                    return cur > preLastCombatEndAt;
                },
                {
                    timeout: 45_000,
                    message: `Waiting for secondary lastCombatEndAt to advance past ${preLastCombatEndAt}`,
                },
            ).toBe(true);

            // 11. Primary's local combat must be idle — stopCombat resets
            //     phase via `cs.resetCombat()` at line 2827. Bug surface:
            //     if the broadcast accidentally re-armed phase or threw an
            //     error before resetCombat, this assertion catches it.
            expect(await readCombatPhase(primaryPage)).toBe('idle');
        } finally {
            if (handles) {
                await handles.cleanup({ primaryCharId, secondaryCharId });
            } else {
                // Fallback if openMultiContext never set handles (early
                // throw in createCharacterViaApi etc.).
                const { cleanupCharacterById } = await import('../../fixtures/cleanup');
                const { getAdminClient } = await import('../../fixtures/adminClient');
                const idsToWipe = [primaryCharId, secondaryCharId].filter(
                    (id): id is string => id !== null,
                );
                if (idsToWipe.length > 0) {
                    try {
                        const admin = getAdminClient();
                        const idList = idsToWipe.map((id) => `"${id}"`).join(',');
                        await admin.from('parties').delete().or(`leader_id.in.(${idList})`);
                    } catch { /* non-fatal */ }
                    await Promise.all(idsToWipe.map((id) => cleanupCharacterById(id)));
                }
            }
        }
    });
});
