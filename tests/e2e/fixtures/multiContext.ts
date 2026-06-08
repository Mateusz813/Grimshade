/**
 * Multi-context fixture — spins up TWO isolated browser contexts in
 * parallel, each logged into a different stable test account
 * (primary + secondary). Returns ready-to-use pages plus a cleanup
 * function that closes both contexts and wipes any characters/parties
 * created on either account.
 *
 * Use case: Realtime / multiplayer flows where one client's action must
 * be observed in another client's UI — party invite + accept, party
 * chat broadcast, guild join request, market listing buy from second
 * account, etc.
 *
 * Architectural decisions (2026-05-25):
 *
 * 1. **Mobile profile for BOTH contexts.** Grimshade is mobile-PWA;
 *    desktop is intentionally not covered. We hard-code `iPhone 13`
 *    device descriptor here so both contexts get the same touch/viewport/
 *    user-agent as the rest of the suite. If we ever want to vary
 *    profiles per side (e.g. test cross-browser Realtime), add a
 *    `device?: 'iPhone 13' | 'Pixel 7'` arg.
 *
 * 2. **Parallel login.** `Promise.all([loginViaUI(primary), loginViaUI(secondary)])`
 *    saves ~5-10 s vs sequential — login is network-heavy and the two
 *    flows are fully independent. If a future timing race appears
 *    (e.g. one side joins party before the other finishes login),
 *    serialize specifically that part of the test, not the fixture.
 *
 * 3. **Cleanup covers parties too.** When a party leader's character
 *    is deleted, the `parties` row stays (no FK on `leader_id`).
 *    Multi-context party tests need both `party_members` AND `parties`
 *    cleaned per-character. The fixture's cleanup deletes:
 *      a. any `parties` row where `leader_id IN (primaryCharId, secondaryCharId)`
 *      b. the characters themselves (via `cleanupCharacterById` which
 *         already nukes `party_members`).
 *
 * 4. **Pass characterIds to cleanup explicitly.** The fixture doesn't
 *    own character creation — the test does (via `createCharacterViaApi`).
 *    The test passes `{ primaryCharId, secondaryCharId }` to
 *    `cleanup()` so the fixture knows what to wipe. This keeps the
 *    fixture stateless and reusable for tests that DON'T need characters
 *    (e.g. pure auth-state multi-context tests).
 *
 * 5. **timeout-friendly.** Test-level
 *    `test.describe.configure({ timeout: 120_000 })` is documented in
 *    `README.md` as the rule for multi-context tests — fixture itself
 *    has no timeout knob, defers to the test/playwright config.
 *
 * Usage pattern:
 * ```ts
 * test('primary creates party, secondary joins', async ({ browser }) => {
 *   const { primaryPage, secondaryPage, cleanup } = await openMultiContext(browser);
 *   let primaryCharId: string | null = null;
 *   let secondaryCharId: string | null = null;
 *   try {
 *     // ... seed characters on each account
 *     primaryCharId = (await createCharacterViaApi({...})).id;
 *     secondaryCharId = (await createCharacterViaApi({...})).id;
 *     // ... navigate each page through Town → /party → assertions
 *   } finally {
 *     await cleanup({ primaryCharId, secondaryCharId });
 *   }
 * });
 * ```
 */

import { devices, type Browser, type Page } from '@playwright/test';
import { testUsers } from './testUsers';
import { loginViaUI } from './login';
import { cleanupCharacterById } from './cleanup';
import { getAdminClient } from './adminClient';

export interface IMultiContextHandles {
    /** Page bound to context #1, logged in as `testUsers.primary`. */
    primaryPage: Page;
    /** Page bound to context #2, logged in as `testUsers.secondary`. */
    secondaryPage: Page;
    /**
     * Closes BOTH contexts + wipes any characters / parties created on
     * either account. Pass the char IDs returned by your
     * `createCharacterViaApi` calls — fixture doesn't track them.
     * Safe to call multiple times (idempotent).
     */
    cleanup: (args: ICleanupArgs) => Promise<void>;
}

export interface ICleanupArgs {
    /** Primary account character UUID (from `createCharacterViaApi`). */
    primaryCharId: string | null;
    /** Secondary account character UUID. */
    secondaryCharId: string | null;
}

/**
 * Opens 2 browser contexts in parallel + logs each in as primary /
 * secondary. Both contexts use the iPhone 13 device descriptor
 * (mobile-safari profile equivalent).
 */
export const openMultiContext = async (
    browser: Browser,
): Promise<IMultiContextHandles> => {
    const mobileProfile = devices['iPhone 13'];

    // Spin up contexts in parallel — they're independent.
    const [ctxPrimary, ctxSecondary] = await Promise.all([
        browser.newContext({ ...mobileProfile }),
        browser.newContext({ ...mobileProfile }),
    ]);

    const primaryPage = await ctxPrimary.newPage();
    const secondaryPage = await ctxSecondary.newPage();

    // Parallel login — saves ~5-10 s vs sequential.
    await Promise.all([
        loginViaUI(primaryPage, testUsers.primary),
        loginViaUI(secondaryPage, testUsers.secondary),
    ]);

    const cleanup = async (args: ICleanupArgs): Promise<void> => {
        // Step 1: delete any `parties` row owned by either character.
        //   `leader_id` has no FK constraint in DB, so deleting the
        //   character doesn't auto-cascade to parties they founded.
        //   We use service_role + admin client to bypass RLS.
        const charIds = [args.primaryCharId, args.secondaryCharId].filter(
            (id): id is string => id !== null,
        );
        if (charIds.length > 0) {
            try {
                const admin = getAdminClient();
                const idList = charIds.map((id) => `"${id}"`).join(',');
                await admin
                    .from('parties')
                    .delete()
                    .or(`leader_id.in.(${idList})`);
                // party_members rows for these characters are already
                // handled by cleanupCharacterById below, so we don't
                // need to re-delete here.
            } catch {
                // Non-fatal — `cleanupCharacterById` will still clean
                // party_members; orphan `parties` rows get GCed by
                // `cleanupEmptyParties` next time someone loads /party.
            }
        }

        // Step 2: delete characters (cascade via cleanupCharacterById
        // which wipes party_members + all other child tables).
        const charPromises: Promise<unknown>[] = [];
        if (args.primaryCharId) {
            charPromises.push(cleanupCharacterById(args.primaryCharId));
        }
        if (args.secondaryCharId) {
            charPromises.push(cleanupCharacterById(args.secondaryCharId));
        }
        await Promise.all(charPromises);

        // Step 3: close both contexts (also frees the underlying pages).
        await Promise.all([
            ctxPrimary.close(),
            ctxSecondary.close(),
        ]);
    };

    return { primaryPage, secondaryPage, cleanup };
};
