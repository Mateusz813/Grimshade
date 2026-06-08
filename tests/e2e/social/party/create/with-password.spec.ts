/**
 * Atomic E2E — create a party WITH a password (BACKLOG 4.1, password variant).
 *
 * Spec ("Stwórz party różne sposoby (z hasłem, bez, z min level)"): the
 * player opens /party, fills the create form, enters a password (so the
 * resulting party is "private"), and submits. We verify:
 *   1. After submit, the in-party roster view renders (`.party__roster`
 *      with our character as the lone member, "(Ty)" suffix).
 *   2. The roster header includes the 🔒 lock icon — confirming the
 *      party was persisted with a password (the icon comes from
 *      `party.hasPassword` in the store, which is derived from the
 *      `parties.password IS NOT NULL` column server-side).
 *
 * Setup:
 *   • Knight on primary account, level 10 (above any defaults).
 *   • seedGameSave with empty inventory (no gold needed for party).
 *
 * Navigation strategy: BottomNav tap → Społeczność hub → Party tile.
 *   Same SPA-preserving pattern as the shop tests — avoids a
 *   page.goto('/party') which wipes the in-memory Zustand stores
 *   (characterStore null → Party renders <Spinner> only, our
 *   .party__primary-btn selector never appears).
 *
 * Cleanup: cleanupCharacterById wipes the character + party_members.
 *   The `parties` row itself isn't auto-deleted (no FK on leader_id),
 *   so we also issue a targeted delete on `parties.leader_id = createdId`
 *   to keep the public feed clean. cleanupEmptyParties on the next test
 *   would GC it anyway, but being explicit is faster + safer.
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../../fixtures/testUsers';
import { loginViaUI } from '../../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../../fixtures/createCharacter';
import { seedGameSave, findUserIdByEmail } from '../../../fixtures/seedGameSave';
import { cleanupCharacterById } from '../../../fixtures/cleanup';
import { getAdminClient } from '../../../fixtures/adminClient';

test.describe('Social › Party', { tag: '@party' }, () => {
    // Login + character switch + Town hydration + nav-to-Party + create form
    // submission + DB roundtrip + Realtime sub bootstrap = 6+ network ops.
    // 60 s is enough for single-context happy path; multi-context tests
    // bump this to 120 s in their own describe.configure.
    test.describe.configure({ timeout: 60_000 });

    test('happy path: create party with password → roster shows our character + 🔒 lock', async ({ page }) => {
        const nick = generateTestCharacterName();
        const partyName = `E2E Party ${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
        let createdId: string | null = null;

        try {
            // 1. Seed Knight on primary.
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: { level: 10, highest_level: 10, hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;
            const userId = await findUserIdByEmail(testUsers.primary.email);
            await seedGameSave({ characterId: created.id, userId });

            // 2. Login + character pick → Town.
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

            // 3. Navigate Town → Społeczność → Party tile (SPA navigation).
            //    BottomNav "Społeczność" button → /social hub → Party tile → /party.
            await page.getByRole('button', { name: /^Społeczność$/i }).tap();
            await expect(page).toHaveURL(/\/social$/, { timeout: 10_000 });
            await page.locator('.social__tile--party').tap();
            await expect(page).toHaveURL(/\/party$/, { timeout: 10_000 });

            // 4. Party intro renders + "+ Stwórz nowe party" button present.
            //    Wait for the intro container so we know Party.tsx hydrated past <Spinner>.
            await expect(page.locator('.party__intro-title')).toHaveText(/Party/i, { timeout: 10_000 });
            const createBtn = page.locator('.party__primary-btn', { hasText: /Stwórz nowe party/i });
            await expect(createBtn).toBeVisible();
            await createBtn.tap();

            // 5. Form appears — fill in name + password.
            await expect(page.locator('.party__create-form')).toBeVisible({ timeout: 5_000 });
            const nameField = page.locator('.party__field', { hasText: /Nazwa party/i }).locator('input');
            await nameField.fill(partyName);
            const passwordField = page.locator('.party__field', { hasText: /Hasło/i }).locator('input');
            await passwordField.fill('secret123');

            // 6. Submit ("Utwórz" button inside party__form-actions).
            //    The button shares `disabled={loading}` with the refresh button
            //    (Party.tsx line 299), so if `refreshPublicParties` is still
            //    in-flight when we land here, the submit button is disabled.
            //    Wait for `enabled` explicitly — this happens even on warm
            //    cache when running the suite in parallel + the refresh
            //    Realtime push lands right as we open the form.
            const submitBtn = page.locator('.party__form-actions')
                .getByRole('button', { name: /^Utwórz$/i });
            await expect(submitBtn).toBeEnabled({ timeout: 10_000 });
            await submitBtn.tap();

            // 7. Form collapses + roster appears with our character.
            //    Roster is the in-party view — `.party__roster` only renders
            //    when `party` is non-null in the store.
            await expect(page.locator('.party__roster')).toBeVisible({ timeout: 15_000 });

            // Our nick appears in the roster (we're the only member + leader).
            await expect(page.locator('.party__roster-name', { hasText: nick }))
                .toBeVisible();

            // The "(Ty)" suffix confirms it's our character (party.tsx
            // line ~536: `<span className="party__roster-you">(Ty)</span>`).
            await expect(page.locator('.party__roster-you')).toBeVisible();

            // Crown icon confirms we're the leader.
            await expect(page.locator('.party__roster-crown')).toBeVisible();

            // 8. Critical assertion: the roster header contains the 🔒
            //    lock icon because we set a password. The lock is rendered
            //    inside `.party__roster-title` as `<span className="party__card-lock">🔒</span>`
            //    only when `party.hasPassword === true`.
            const rosterHeader = page.locator('.party__roster-header');
            await expect(rosterHeader.locator('.party__card-lock')).toBeVisible();

            // 9. Member count shows "1/4 graczy" — confirms the party row
            //    was persisted with default max_members=4 and our row landed.
            await expect(page.locator('.party__roster-meta'))
                .toContainText(/1\/4\s+graczy/i);
        } finally {
            // 1. Delete the party row (no FK on leader_id → won't cascade).
            if (createdId) {
                try {
                    const admin = getAdminClient();
                    await admin.from('parties').delete().eq('leader_id', createdId);
                } catch {
                    // Non-fatal — cleanupEmptyParties will GC stragglers.
                }
            }
            // 2. Delete the character + child rows (party_members included).
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
