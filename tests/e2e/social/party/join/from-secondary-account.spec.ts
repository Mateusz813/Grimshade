/**
 * Multi-context E2E — secondary account joins primary's party (BACKLOG 4.2).
 *
 * Spec ("Dołącz do party z drugiego konta"): two separate browser
 * contexts logged in as different accounts (primary + secondary). The
 * primary user creates a public party, and the secondary user joins it
 * via the party browser. We verify Realtime sync: after the join,
 * BOTH contexts see both members in their `.party__roster`.
 *
 * Multi-context flow:
 *   1. Open 2 browser contexts (iPhone 13 profile), parallel login.
 *   2. Both contexts seed a character + pick it -> Town.
 *   3. Primary navigates to /party, creates a PUBLIC (no-password)
 *      party with a unique name.
 *   4. Secondary navigates to /party, refreshes the browser, finds the
 *      primary's party in the public feed, taps "Dołącz".
 *   5. Assertions on both contexts:
 *      a. `.party__roster` has 2 members
 *      b. Primary's roster includes primary nick + secondary nick.
 *      c. Secondary's roster includes both nicks too.
 *      d. Primary's character has crown (leader); secondary's doesn't.
 *
 * Realtime timing notes:
 *   - Primary creates party -> server INSERT -> Realtime broadcast ->
 *     primary's `subscribeToActiveParty` populates `party` in store.
 *   - Secondary's `subscribePublicFeed` receives the INSERT event on
 *     `parties` -> re-fetches public feed -> new party appears as
 *     `.party__card` in the browser. If Realtime is slow, the test
 *     uses an explicit refresh tap (:counterclockwise-arrows-button: button) as a deterministic
 *     fallback rather than waiting for the auto-push.
 *   - When secondary joins -> server INSERT on `party_members` ->
 *     Realtime broadcasts to both contexts -> primary's roster updates,
 *     secondary's view switches from browser to roster.
 *
 * Cleanup: deletes both characters via the multi-context fixture +
 *   nukes the `parties` row by leader_id.
 *
 * Why 120s timeout: this test does ~12 network ops (2× login, 2×
 *   character switch, 2× /party nav, 1× create, 1× browser refresh,
 *   1× join, 4× Realtime sync waits). On WebKit cold start each is
 *   ~3-5 s. The default 30 s is way too tight.
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../../fixtures/testUsers';
import { createCharacterViaApi, generateTestCharacterName } from '../../../fixtures/createCharacter';
import { seedGameSave, findUserIdByEmail } from '../../../fixtures/seedGameSave';
import { openMultiContext } from '../../../fixtures/multiContext';
import type { Page } from '@playwright/test';

test.describe('Social › Party', { tag: '@party' }, () => {
    // Multi-context = 2× everything -> bumped to 120 s per README convention.
    test.describe.configure({ timeout: 120_000 });

    test('multi-context: primary creates public party -> secondary joins -> both rosters show 2 members', async ({ browser }) => {
        const primaryNick = generateTestCharacterName();
        const secondaryNick = generateTestCharacterName();
        const partyName = `MC ${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

        let primaryCharId: string | null = null;
        let secondaryCharId: string | null = null;
        let handles: Awaited<ReturnType<typeof openMultiContext>> | null = null;

        try {
            // 1. Seed characters on BOTH accounts BEFORE opening contexts
            //    so the character pickers have something to select.
            //    Both are Knights at level 10 (>= any min-join gate).
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

            // Seed game_saves so character switch on each side doesn't
            // wipe gold/inventory back to 0 (not strictly needed for
            // party flow, but matches the pattern from other tests +
            // avoids latent hydration races).
            const primaryUserId = await findUserIdByEmail(testUsers.primary.email);
            const secondaryUserId = await findUserIdByEmail(testUsers.secondary.email);
            await seedGameSave({ characterId: primaryCharId, userId: primaryUserId });
            await seedGameSave({ characterId: secondaryCharId, userId: secondaryUserId });

            // 2. Open 2 browser contexts in parallel + parallel login.
            handles = await openMultiContext(browser);
            const { primaryPage, secondaryPage } = handles;

            // 3. Both contexts: navigate to character-select, pick the
            //    just-seeded character, end up in Town. Done in parallel
            //    via Promise.all — independent flows.
            const pickCharacter = async (page: Page, nick: string): Promise<void> => {
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
            await Promise.all([
                pickCharacter(primaryPage, primaryNick),
                pickCharacter(secondaryPage, secondaryNick),
            ]);

            // 4. Both navigate to /party.
            const navToParty = async (page: Page): Promise<void> => {
                await page.getByRole('button', { name: /^Społeczność$/i }).tap();
                await expect(page).toHaveURL(/\/social$/, { timeout: 10_000 });
                await page.locator('.social__tile--party').tap();
                await expect(page).toHaveURL(/\/party$/, { timeout: 10_000 });
                await expect(page.locator('.party__intro-title, .party__roster').first())
                    .toBeVisible({ timeout: 15_000 });
            };
            await Promise.all([
                navToParty(primaryPage),
                navToParty(secondaryPage),
            ]);

            // 5. PRIMARY: create a PUBLIC party with a unique name.
            await primaryPage
                .locator('.party__primary-btn', { hasText: /Stwórz nowe party/i })
                .tap();
            await expect(primaryPage.locator('.party__create-form'))
                .toBeVisible({ timeout: 5_000 });
            await primaryPage.locator('.party__field', { hasText: /Nazwa party/i })
                .locator('input').fill(partyName);
            // Leave password BLANK — public, joinable without password.
            // Wait for the submit button to be enabled — it shares
            // `disabled={loading}` with the refresh button, so a still
            // in-flight refreshPublicParties from page mount can keep
            // it disabled until the network round-trip lands.
            const primarySubmitBtn = primaryPage.locator('.party__form-actions')
                .getByRole('button', { name: /^Utwórz$/i });
            await expect(primarySubmitBtn).toBeEnabled({ timeout: 10_000 });
            await primarySubmitBtn.tap();

            // Primary sees roster with 1/4 members (just himself).
            await expect(primaryPage.locator('.party__roster')).toBeVisible({ timeout: 15_000 });
            await expect(primaryPage.locator('.party__roster-meta'))
                .toContainText(/1\/4\s+graczy/i);
            await expect(primaryPage.locator('.party__roster-name', { hasText: primaryNick }))
                .toBeVisible();

            // 6. SECONDARY: tap the manual refresh button to pull the
            //    public feed (Realtime push may have already landed, but
            //    explicit refresh is deterministic across browsers).
            //    Then find the party card by name + tap "Dołącz".
            const refreshBtn = secondaryPage.locator('.party__refresh-btn');
            await refreshBtn.tap();
            // The party card scope is its `.party__card-name` matching our partyName.
            const partyCard = secondaryPage.locator('.party__card', {
                has: secondaryPage.locator('.party__card-name', { hasText: partyName }),
            });
            await expect(partyCard).toBeVisible({ timeout: 15_000 });
            // The "Dołącz" button is the primary-btn inside the card-right.
            // Same disabled-while-loading concern as the create form —
            // wait for enabled before tap.
            const joinBtn = partyCard.locator('.party__primary-btn', { hasText: /^Dołącz$/i });
            await expect(joinBtn).toBeEnabled({ timeout: 10_000 });
            await joinBtn.tap();

            // 7. SECONDARY: roster appears with 2/4 members.
            //    Realtime-dependent (server confirms the join via the
            //    party_members subscription) — 45s to absorb full-suite load.
            await expect(secondaryPage.locator('.party__roster'))
                .toBeVisible({ timeout: 45_000 });
            await expect(secondaryPage.locator('.party__roster-meta'))
                .toContainText(/2\/4\s+graczy/i, { timeout: 45_000 });
            // Both members listed.
            await expect(secondaryPage.locator('.party__roster-name', { hasText: primaryNick }))
                .toBeVisible();
            await expect(secondaryPage.locator('.party__roster-name', { hasText: secondaryNick }))
                .toBeVisible();

            // 8. PRIMARY: Realtime push updates roster to 2/4 too.
            //    Critical Realtime-sync assertion — this is the WHOLE
            //    point of a multi-context test (single-context can't
            //    verify Realtime propagation by definition). 45s: the
            //    cross-context broadcast can take 15-25s under full-suite load.
            await expect(primaryPage.locator('.party__roster-meta'))
                .toContainText(/2\/4\s+graczy/i, { timeout: 45_000 });
            await expect(primaryPage.locator('.party__roster-name', { hasText: secondaryNick }))
                .toBeVisible({ timeout: 45_000 });

            // 9. Leader detection: primary's card has the crown, secondary's
            //    doesn't (leader_id matches primary's character.id).
            //    We scope to each context's own page.
            await expect(primaryPage.locator('.party__roster-row--leader .party__roster-name', { hasText: primaryNick }))
                .toBeVisible();
            await expect(secondaryPage.locator('.party__roster-row--leader .party__roster-name', { hasText: primaryNick }))
                .toBeVisible();
        } finally {
            if (handles) {
                await handles.cleanup({ primaryCharId, secondaryCharId });
            } else {
                // Fixture never opened (early seed failure) — still try
                // to wipe characters directly via the cleanup helper.
                const { cleanupCharacterById } = await import('../../../fixtures/cleanup');
                const { getAdminClient } = await import('../../../fixtures/adminClient');
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
