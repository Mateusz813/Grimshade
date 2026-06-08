/**
 * Atomic E2E — create a party from the Town view shortcut (BACKLOG 4.3).
 *
 * Spec ("Stwórz party z poziomu miasta"): when a player has no active
 * party, the Town renders a "Solo — brak party" strip with a
 * "+ Stwórz party" CTA. Tapping it should:
 *   1. Call `partyStore.createParty()` with the character's default
 *      name (`${character.name}'s party`), no password, public=true.
 *   2. After the round-trip, the Town's `town__party-strip` should
 *      switch out of the `--empty` variant (now there's a party).
 *   3. Navigating to /party should show our character in the roster.
 *
 * This test specifically verifies the **Town shortcut path** — not the
 * direct /party create flow (which is covered by `with-password.spec.ts`).
 * The two flows hit different React component handlers
 * (`Town.handleCreateParty` vs `Party.handleCreateSubmit`) but ultimately
 * the same `partyStore.createParty()` action — so a regression in EITHER
 * UI handler is caught by having both tests.
 *
 * Edge case being guarded: when we tap "+ Stwórz party" in Town, the
 * handler navigates via state update (no router navigate) — the empty
 * strip is replaced inline with the populated strip. We DON'T expect a
 * URL change, just a re-render. Then we explicitly navigate to /party
 * to confirm the persisted party shows up in the dedicated view too.
 *
 * Cleanup: same as 4.1 — delete `parties` row by leader_id + character.
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../../fixtures/testUsers';
import { loginViaUI } from '../../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../../fixtures/createCharacter';
import { seedGameSave, findUserIdByEmail } from '../../../fixtures/seedGameSave';
import { cleanupCharacterById } from '../../../fixtures/cleanup';
import { getAdminClient } from '../../../fixtures/adminClient';

test.describe('Social › Party', { tag: '@party' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('Town "+ Stwórz party" shortcut → party persists + appears in /party roster', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            // 1. Seed Knight on primary, level 10.
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: { level: 10, highest_level: 10, hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;
            const userId = await findUserIdByEmail(testUsers.primary.email);
            await seedGameSave({ characterId: created.id, userId });

            // 2. Login + pick character → Town.
            await loginViaUI(page, testUsers.primary);
            if (!page.url().endsWith('/character-select')) {
                await page.goto('/character-select');
            }
            await expect(page.locator('.char-select__card-name', { hasText: nick }))
                .toBeVisible({ timeout: 10_000 });
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });
            await expect(page.locator('.town__char-name')).toHaveText(nick);

            // 3. Sanity: the empty party strip is visible BEFORE we create one.
            //    `.town__party-strip--empty` is the modifier rendered when
            //    `party === null` in the store (Town.tsx ~line 606).
            const emptyStrip = page.locator('.town__party-strip--empty');
            await expect(emptyStrip).toBeVisible({ timeout: 10_000 });
            await expect(emptyStrip).toContainText(/Solo.*brak party/i);

            // 4. Tap "+ Stwórz party" — Town's shortcut handler creates a
            //    default-named public party via `partyStore.createParty()`.
            const createBtn = emptyStrip.locator('.town__party-strip-create');
            await expect(createBtn).toBeVisible();
            await createBtn.tap();

            // 5. After the round-trip, the strip should NO LONGER carry
            //    the `--empty` modifier (party is non-null in the store
            //    → Town re-renders the populated strip variant). We wait
            //    for the empty selector to detach.
            //    Network timing: createParty does INSERT parties + INSERT
            //    party_members + SELECT getPartyWithMembers — 3 sequential
            //    RTTs. 15 s headroom for slow Supabase.
            await expect(page.locator('.town__party-strip--empty')).toBeHidden({ timeout: 15_000 });
            // The populated strip is still `.town__party-strip` (without --empty).
            await expect(page.locator('.town__party-strip')).toBeVisible();

            // 6. Navigate to /party via BottomNav → Społeczność → Party tile.
            //    Confirms the party persisted to DB (Party.tsx hydrates from
            //    server via hydrateActiveParty on mount).
            await page.getByRole('button', { name: /^Społeczność$/i }).tap();
            await expect(page).toHaveURL(/\/social$/, { timeout: 10_000 });
            await page.locator('.social__tile--party').tap();
            await expect(page).toHaveURL(/\/party$/, { timeout: 10_000 });

            // 7. /party should show the in-party roster (not the browser).
            //    The roster contains our character as the lone leader.
            await expect(page.locator('.party__roster')).toBeVisible({ timeout: 15_000 });
            await expect(page.locator('.party__roster-name', { hasText: nick }))
                .toBeVisible();
            await expect(page.locator('.party__roster-crown')).toBeVisible();

            // 8. Roster header should NOT have a lock icon (Town shortcut
            //    creates parties without password). Verifies the password
            //    path defaults to null when invoked from Town.
            const rosterHeader = page.locator('.party__roster-header');
            await expect(rosterHeader.locator('.party__card-lock')).toHaveCount(0);

            // 9. Default party name format: `${character.name}'s party`.
            await expect(page.locator('.party__roster-title'))
                .toContainText(`${nick}'s party`);
        } finally {
            if (createdId) {
                try {
                    const admin = getAdminClient();
                    await admin.from('parties').delete().eq('leader_id', createdId);
                } catch {
                    /* non-fatal — GC will catch it */
                }
            }
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
