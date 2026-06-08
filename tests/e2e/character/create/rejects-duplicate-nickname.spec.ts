/**
 * Atomic E2E — character create rejects a nickname already taken by
 * another user (BACKLOG 2.7).
 *
 * ## Status — migration APPLIED 2026-05-25
 *
 * The case-insensitive UNIQUE INDEX on `LOWER(characters.name)` from
 * `scripts/character_unique_nick_migration.sql` has been APPLIED to
 * production Supabase. Verified end-to-end via service_role probe:
 *   • `INSERT … name='X'` succeeds the first time
 *   • A second `INSERT … name='X'` (different user, different class)
 *     fails with `23505 duplicate key value violates unique constraint
 *     "characters_name_unique_ci"`.
 *
 * The earlier runtime-probe + `test.skip()` gating is therefore removed —
 * the test now drives the canonical UI flow unconditionally. If the
 * constraint is ever rolled back, the test will fail at step 6a (the
 * primary's INSERT will succeed → URL navigates to `/` → assertion
 * `toHaveURL(/\/create-character$/)` blows up) and the failure
 * surfaces immediately.
 *
 * ## Test flow
 *
 *  1. Seed a "taken" character on the SECONDARY account via service_role
 *     (so the conflict comes from a DIFFERENT user — proves the constraint
 *     is GLOBAL, not per-user; per-user UNIQUE would let primary still
 *     create the same nick).
 *  2. Login as primary via UI → /character-select.
 *  3. Navigate to /create-character.
 *  4. Pick a class (Knight) and fill the SAME nick as the seeded char.
 *  5. Tap "Stwórz postać".
 *  6. Assertions:
 *     a. URL stays on /create-character (no navigate to '/' on success).
 *     b. `.character-create__error` is visible with the generic catch-block
 *        message (`'Błąd tworzenia postaci. Spróbuj ponownie.'` per
 *        CharacterCreate.tsx line 196). NB: this message is generic
 *        (not duplicate-specific) because the catch block doesn't
 *        differentiate HTTP 409 from other failures. Future UX polish
 *        can render `'Postać o takim nicku już istnieje'` specifically;
 *        the constraint itself does the gating regardless.
 *     c. No new character row for primary's user_id matches the
 *         attempted nick (service_role probe — primary still has 0 chars
 *         named X). Proves the rejected INSERT didn't partially land.
 *
 * ## Why cross-user collision (secondary's nick), not same-user
 *
 * Same-user collision is a weaker test:
 *   • If we seeded `nick` on primary then tried to create `nick` again,
 *     it could pass on a per-user UNIQUE constraint (e.g. UNIQUE
 *     (user_id, name)) and we'd think the test is green — but cross-user
 *     duplicates would still happen in production.
 *   • The leaderboard / friend lookup / deaths-feed identity problem
 *     only manifests CROSS-user anyway — within one account the player
 *     just sees their own char.
 *
 * Cross-user seed proves the GLOBAL UNIQUE which is what the spec wants.
 *
 * ## Cleanup
 *
 * `cleanupCharacterById` on the seeded SECONDARY char + defensive
 * `cleanupCharacterByName` on PRIMARY in case the rejection logic ever
 * regresses and primary's INSERT silently succeeds. Both run in finally
 * regardless of the test outcome.
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import {
    createCharacterViaApi,
    generateTestCharacterName,
} from '../../fixtures/createCharacter';
import {
    cleanupCharacterById,
    cleanupCharacterByName,
} from '../../fixtures/cleanup';
import { getAdminClient, findUserIdByEmail } from '../../fixtures/adminClient';

test.describe('Character › Create', { tag: '@character' }, () => {
    // UI flow (login + nav + form fill + submit) ~25 s on cold WebKit.
    // 90 s headroom keeps the test safe against background DB load.
    test.describe.configure({ timeout: 90_000 });

    test('rejects nickname already taken by another user', async ({ page }) => {
        const sharedNick = generateTestCharacterName();
        let secondaryCharId: string | null = null;

        try {
            // ── Step 1: seed secondary's char with the contested nick ──────
            // Seeding on SECONDARY (not primary) ensures we're testing the
            // GLOBAL constraint, not a per-user one. If the migration was
            // accidentally `UNIQUE (user_id, name)` instead of `UNIQUE
            // (LOWER(name))`, the primary's subsequent INSERT would still
            // succeed and this test would falsely pass green — the
            // cross-user seed catches that.
            const seeded = await createCharacterViaApi({
                userEmail: testUsers.secondary.email,
                name: sharedNick,
                class: 'Mage',
                overrides: { hp_regen: 0, mp_regen: 0 },
            });
            secondaryCharId = seeded.id;

            // ── Step 2: primary logs in via UI ─────────────────────────────
            await loginViaUI(page, testUsers.primary);
            if (!page.url().endsWith('/character-select')) {
                await page.goto('/character-select');
            }

            // ── Step 3: navigate to /create-character ──────────────────────
            const createBtn = page.getByRole('button', { name: /Stwórz nową postać/i });
            await createBtn.scrollIntoViewIfNeeded();
            await createBtn.tap();
            await expect(page).toHaveURL(/\/create-character$/, { timeout: 10_000 });

            // ── Step 4: pick Knight + fill the contested nick ──────────────
            const knightBtn = page.locator('.character-create__class-btn').filter({
                hasText: /Rycerz/,
            });
            await knightBtn.tap();
            await expect(knightBtn).toHaveClass(/character-create__class-btn--selected/);

            await page.locator('.character-create__input').fill(sharedNick);

            // ── Step 5: submit ─────────────────────────────────────────────
            await page.getByRole('button', { name: /Stwórz postać/i }).tap();

            // ── Step 6a: URL stays on /create-character ────────────────────
            // Success path navigates to '/' (Town). Rejection keeps us on
            // /create-character because the catch block calls setError
            // instead of navigate. ~2 s headroom for the API round-trip.
            await page.waitForTimeout(2000);
            await expect(page).toHaveURL(/\/create-character$/);

            // ── Step 6b: error message is visible ──────────────────────────
            // CharacterCreate.tsx line 195-197 catch block sets
            // `errors.root.message = 'Błąd tworzenia postaci. Spróbuj
            // ponownie.'` — selector `.character-create__error`.
            // Generic message intentional (post-migration UX polish can
            // refine to "nick zajęty" specifically; the constraint itself
            // does the gating regardless).
            const errorEl = page.locator('.character-create__error');
            await expect(errorEl).toBeVisible({ timeout: 5_000 });

            // ── Step 6c: primary has NO character with the contested nick ──
            // Service_role probe — the rejected INSERT must not have
            // partially landed (e.g. row inserted then transaction
            // rolled back leaving the row visible to subsequent reads).
            const admin = getAdminClient();
            const primaryUserId = await findUserIdByEmail(testUsers.primary.email);
            const { data: primaryChars, error: pcErr } = await admin
                .from('characters')
                .select('id')
                .eq('user_id', primaryUserId!)
                .eq('name', sharedNick);
            expect(pcErr).toBeNull();
            expect(primaryChars ?? []).toHaveLength(0);
        } finally {
            if (secondaryCharId) {
                await cleanupCharacterById(secondaryCharId);
            }
            // Defensive: if the rejection logic regressed and primary
            // managed to create the char anyway, this cleans it up so
            // the next test run starts fresh.
            await cleanupCharacterByName(testUsers.primary.email, sharedNick);
        }
    });
});
