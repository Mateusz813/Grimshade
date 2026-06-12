/**
 * Atomic E2E — single-context: create a guild, then disband by leaving (BACKLOG 4.4).
 *
 * Spec ("Stwórz gildię -> rozwiąż"): one founder creates a fresh guild
 * (paying the 1M gp cost via seeded gold), enters the guild home view,
 * then opens the "Opuść gildię" flow. Since the founder is the SOLE
 * member, leaving auto-disbands the guild (guildApi.leaveGuild deletes
 * the `guilds` row when no other members remain — see Guild.tsx line
 * 818-822 "Jesteś ostatnim członkiem — gildia zostanie rozwiązana").
 *
 * We verify the full happy path:
 *   1. Pre-create the guild list view is visible (no guild yet).
 *   2. After the create dialog submits, the home banner appears with the
 *      guild's name + tag.
 *   3. Tapping the :door: leave icon + confirming in the modal disbands
 *      the guild -> store clears -> home view collapses back to list.
 *   4. After disband, /guild list does NOT contain our guild name.
 *
 * Critical setup notes:
 *   - Seed 2_000_000 gp into `inventory.gold` slot via `seedGameSave`.
 *     1_000_000 gp is the spec-defined create cost (GUILD_CREATE_COST_GOLD);
 *     we double it so the "canAfford" gate passes with comfortable margin.
 *   - Character at level 10 — there's no min-level requirement for guild
 *     creation but a higher-level character avoids any UI lockouts that
 *     might bite in the future.
 *
 * Cleanup:
 *   - cleanupGuildsByLeaderIds nukes the `guilds` row in case disband
 *     failed (idempotent — no-op if the test successfully disbanded).
 *   - cleanupCharacterById wipes the character + child rows.
 *
 * Why no `parties` cleanup: this test never creates a party. The
 * `parties` row delete in `multiContext.cleanup` is for party-flow tests
 * — guild flow uses the `guilds` table instead.
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../../fixtures/testUsers';
import { loginViaUI } from '../../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../../fixtures/createCharacter';
import { seedGameSave, findUserIdByEmail } from '../../../fixtures/seedGameSave';
import { cleanupCharacterById } from '../../../fixtures/cleanup';
import { cleanupGuildsByLeaderIds } from '../../../fixtures/guildCleanup';

test.describe('Social › Guild', { tag: '@guild' }, () => {
    // Single-context but still slower than auth: create dialog opens
    // (3 modal renders), submit (1 INSERT + 1 INSERT guild_members),
    // hydrate guild from realtime (~3s), leave (DELETE + DELETE), back
    // to list refresh. 60s is plenty of headroom.
    test.describe.configure({ timeout: 60_000 });

    test('happy path: create guild with 1M gp -> home view renders -> disband by leaving -> guild gone from list', async ({ page }) => {
        const nick = generateTestCharacterName();
        // Tag must be 2-3 letters/digits — pick a random 3-char alphanumeric
        // so parallel test runs don't collide on the same tag string (no
        // DB unique constraint on `guilds.tag` but humans see "duplicate"
        // entries during debug if we share).
        const tag = Math.random().toString(36).slice(2, 5).toUpperCase().replace(/[^A-Z0-9]/g, 'A');
        const guildName = `E2E Guild ${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
        let createdCharId: string | null = null;

        try {
            // 1. Seed Knight with enough gold for the create cost.
            //    `inventoryStore.gold` (game_saves slot) is what
            //    GuildCreateDialog reads via `useInventoryStore((s) => s.gold)`
            //    — `characters.gold` column is NOT used by the create form.
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: { level: 10, highest_level: 10, hp_regen: 0, mp_regen: 0 },
            });
            createdCharId = created.id;
            const userId = await findUserIdByEmail(testUsers.primary.email);
            await seedGameSave({
                characterId: created.id,
                userId,
                gold: 2_000_000, // 2× create cost — comfortable margin
            });

            // 2. Login + character pick -> Town.
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

            // 3. Navigate Town -> Społeczność -> Gildia tile (SPA preserves store).
            await page.getByRole('button', { name: /^Społeczność$/i }).tap();
            await expect(page).toHaveURL(/\/social$/, { timeout: 10_000 });
            await page.locator('.social__tile--gildia').tap();
            await expect(page).toHaveURL(/\/guild$/, { timeout: 10_000 });

            // 4. Guild list view is the default screen for unaffiliated
            //    players. Wait for the create button to be reachable.
            await expect(page.locator('.guild__list-create')).toBeVisible({ timeout: 15_000 });

            // 5. Tap "Stwórz gildię" -> create dialog modal opens.
            await page.locator('.guild__list-create').tap();
            await expect(page.locator('.guild__modal-title', { hasText: /Stwórz gildię/i }))
                .toBeVisible({ timeout: 5_000 });

            // 6. Fill name + tag. (Logo + color default to GUILD_ICONS[0] +
            //    GUILD_COLORS[0] which we don't need to touch.)
            await page.locator('#guild-name').fill(guildName);
            await page.locator('#guild-tag').fill(tag);

            // 7. Submit. Button text shows "Stwórz gildię" (NOT "Utwórz" —
            //    that's the party form). Disabled while `busy` OR
            //    `!canAfford` — we seeded 2× the cost so canAfford=true.
            const submitBtn = page.locator('.guild__btn-primary', { hasText: /Stwórz gildię/i });
            await expect(submitBtn).toBeEnabled({ timeout: 10_000 });
            await submitBtn.tap();

            // 8. Wait for the home view to mount. The home view is what
            //    a player sees after creating/joining a guild — it
            //    renders the guild banner with name + tag.
            //    The `useEffect` in <Guild> watches `guildState.guild`
            //    and flips `screen` from 'list' to 'home' automatically.
            await expect(page.locator('.guild__home-banner')).toBeVisible({ timeout: 15_000 });
            await expect(page.locator('.guild__home-name')).toContainText(guildName);
            await expect(page.locator('.guild__home-name')).toContainText(`[${tag}]`);

            // 9. Members section shows exactly 1 row — us, marked "Ty".
            const myMember = page.locator('.guild__member-row.is-me');
            await expect(myMember).toBeVisible();
            await expect(myMember.locator('.guild__member-name')).toContainText(nick);
            // Crown (:crown:) confirms we're the leader.
            await expect(myMember.locator('.guild__member-crown')).toBeVisible();

            // 10. DISBAND flow: tap the :door: leave button -> confirmation modal.
            //     Since we're the sole member, the modal carries the
            //     "Jesteś ostatnim członkiem — gildia zostanie rozwiązana"
            //     warning copy (Guild.tsx ~819).
            await myMember.locator('.guild__member-leave').tap();
            await expect(page.locator('.guild__modal-title', { hasText: /Opuść gildię/i }))
                .toBeVisible({ timeout: 5_000 });
            await expect(page.locator('.guild__home-warning'))
                .toContainText(/ostatnim członkiem.*rozwiązana/i);

            // 11. Confirm — leaveGuild deletes the `guilds` row + cascades.
            const confirmBtn = page.locator('.guild__btn-danger', { hasText: /Opuść/i });
            await expect(confirmBtn).toBeEnabled();
            await confirmBtn.tap();

            // 12. After disband, the store clears + Guild.tsx flips back
            //     from 'home' to 'list'. The home banner disappears,
            //     the guild list view re-renders.
            await expect(page.locator('.guild__home-banner')).toBeHidden({ timeout: 15_000 });
            await expect(page.locator('.guild__list-create')).toBeVisible({ timeout: 10_000 });

            // 13. Critical: our disbanded guild is NOT in the list. The
            //     list re-fetches on mount via `fetchPage` — wait briefly
            //     for the row to NOT appear (defensive against listing
            //     race conditions during the re-fetch).
            //     We search the entire list area, not just first page,
            //     by checking the count of matching name rows.
            await expect(page.locator('.guild__list-name', { hasText: guildName }))
                .toHaveCount(0, { timeout: 15_000 });
        } finally {
            // Order matters: clean guild rows first (CASCADE wipes child
            // tables), then nuke the character. If disband succeeded the
            // guilds delete is a no-op; if not, it kills the orphan.
            await cleanupGuildsByLeaderIds([createdCharId]);
            if (createdCharId) {
                await cleanupCharacterById(createdCharId);
            }
        }
    });
});
