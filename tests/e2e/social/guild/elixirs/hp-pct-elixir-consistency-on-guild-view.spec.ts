/**
 * Atomic E2E — primary's `hp_pct_25` buff stays visible on `/guild`
 * via the TopHeader popover (the canonical numeric HP display anchored
 * route-agnostically across the app).
 *
 * Spec (BACKLOG.md punkt 3.5 expansion): "Eliksir +25% HP -> HP identyczne
 * na: Town + TopHeader + CharacterSelect + każda walka + party + **gildia**"
 *
 * Pokrywa GUILD view (3.5-guild slice).
 *
 * ## What this test pins (and what it explicitly doesn't)
 *
 * The Guild member list (`.guild__members` -> `MemberRow` rows) does NOT
 * render HP — it shows class + level + transform tier + boss contribution
 * only (Guild.tsx line 843-931). So there's no member-row HP locator to
 * assert "primary's row shows boosted HP".
 *
 * However: GUILD view also relies on `getEffectiveChar` for the
 * **guild-boss combat HUD** (Guild.tsx line 1120-1127: `maxHp = eff?.max_hp
 * ?? character.max_hp` — exact same code as Combat.tsx). And the
 * TopHeader popover is mounted on /guild (AppShell.tsx line 409,
 * `showChrome=true` for /guild route).
 *
 * The canonical "consistency on guild view" check is therefore:
 *  - TopHeader popover on /guild shows the SAME effective max HP value as
 *    on Town / /combat / CharacterSelect.
 *  - Engine-level `getEffectiveChar(character).max_hp` returns the same
 *    boosted value while the player is on /guild — guards against a route
 *    transition that could silently strip the buff (e.g. a bug where
 *    Guild's `hydrateForCharacter` reset the buff slice on view mount).
 *
 * Multi-context flavor: even though we use a single page to assert (we're
 * verifying the LOCAL UI on /guild for the buffed character), we use
 * `seedGuild` to give the character a real guild context — without that
 * the page would be on /guild "list browser" rather than the home view,
 * and the TopHeader behavior shouldn't differ but the test is more
 * realistic when the user is "actually in a guild".
 *
 * ## Why not multi-context like the party test
 *
 * The party test (`social/party/elixirs/hp-pct-elixir-broadcasts-to-party-member.spec.ts`)
 * verifies the partyPresence broadcast — that's the load-bearing cross-
 * member contract for party. Guild has NO equivalent live HP broadcast
 * channel; member info hydrates from `guild_members` table (which stores
 * `character_level`, `character_class`, `character_transform_tier` but
 * NOT HP). So a multi-context guild test cannot meaningfully assert
 * "secondary sees primary's boosted HP" — there's no UI surface for it.
 *
 * The remaining contract worth pinning is the local guild-view consistency,
 * which doesn't need a second context.
 *
 * ## Setup
 *
 * - Knight, lvl 10, hp=40, hp_regen=0, mp_regen=0.
 * - Buff hp_pct_25 (effect `hp_pct_25`).
 * - Guild pre-seeded with just primary as a member (via `seedGuild`),
 *   so /guild lands on home view (not list browser).
 * - SECONDARY account per task brief.
 *
 * ## Cleanup
 *
 * - `cleanupGuildsByLeaderIds([createdId])` — wipes guild + CASCADE
 *   handles `guild_members`.
 * - `cleanupCharacterById(createdId)` — wipes character + game_save.
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../../fixtures/testUsers';
import { loginViaUI } from '../../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../../fixtures/cleanup';
import { seedGameSave, findUserIdByEmail } from '../../../fixtures/seedGameSave';
import { seedGuild } from '../../../fixtures/seedGuild';
import { cleanupGuildsByLeaderIds } from '../../../fixtures/guildCleanup';

test.describe('Social › Guild › Elixirs', { tag: '@guild' }, () => {
    test.describe.configure({ timeout: 90_000 });

    test('hp_pct_25 buff active -> /guild TopHeader popover shows boosted max HP + engine getEffectiveChar agrees', async ({ page }) => {
        const nick = generateTestCharacterName();
        const tag = Math.random().toString(36).slice(2, 5).toUpperCase().replace(/[^A-Z0-9]/g, 'A');
        const guildName = `E2E G ${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

        let createdId: string | null = null;
        let guildId: string | null = null;

        try {
            // 1. Seed Knight lvl 10 on SECONDARY.
            const created = await createCharacterViaApi({
                userEmail: testUsers.secondary.email,
                name: nick,
                class: 'Knight',
                overrides: { hp: 40, mp: 15, level: 10, highest_level: 10, hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            // 2. Seed game_save with buff.
            const userId = await findUserIdByEmail(testUsers.secondary.email);
            await seedGameSave({
                characterId: createdId,
                userId,
                buffs: [
                    {
                        id: 'hp_pct_25',
                        name: 'Max HP +25%',
                        icon: 'heart-on-fire',
                        effect: 'hp_pct_25',
                    },
                ],
            });

            // 3. Seed solo guild — primary as leader & only member. Skips
            //    the create-modal UI flow that's already covered by
            //    `social/guild/create/create-and-disband.spec.ts`. The
            //    /guild route hydrates `useGuildStore` from this row and
            //    lands directly on the home view (with member roster + chat).
            const seededGuild = await seedGuild({
                name: guildName,
                tag,
                memberCharacterIds: [createdId],
            });
            guildId = seededGuild.id;

            // 4. Login + Town hydration.
            await loginViaUI(page, testUsers.secondary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 15_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
            await expect(page.locator('.town__char-name')).toHaveText(nick, { timeout: 10_000 });

            // 5. Sanity: buff live in runtime store before guild nav.
            const hasBuffAtTown = await page.evaluate(async () => {
                // @ts-expect-error — dev-time Vite URL not resolvable by tsc
                const mod = await import('/src/stores/buffStore.ts');
                return (mod as {
                    useBuffStore: { getState: () => { hasBuff: (e: string) => boolean } };
                }).useBuffStore.getState().hasBuff('hp_pct_25');
            });
            expect(hasBuffAtTown).toBe(true);

            // 6. Navigate to /guild via Społeczność -> Gildia tile.
            //    Note: tile selector uses Polish id `gildia` (Social.tsx tile.id).
            await page.getByRole('button', { name: /^Społeczność$/i }).tap();
            await expect(page).toHaveURL(/\/social$/, { timeout: 10_000 });
            await page.locator('.social__tile--gildia').tap();
            await expect(page).toHaveURL(/\/guild$/, { timeout: 10_000 });

            // 7. Wait for guild home view to render (we're a member so
            //    /guild should hydrate to home, not list browser).
            await expect(page.locator('.guild__home-name, .guild__members').first())
                .toBeVisible({ timeout: 15_000 });

            // 8. Open TopHeader popover, read HP. Should be the same as
            //    Town / /combat / CharacterSelect would show — effective
            //    max HP (150 = floor(120 × 1.25)).
            const pulseBtn = page.locator('.top-header__pulse').first();
            await expect(pulseBtn).toBeVisible({ timeout: 5_000 });
            await pulseBtn.tap();
            const popoverHp = await page
                .locator('.top-header__pulse-popover-row--hp .top-header__pulse-popover-val')
                .first()
                .textContent();
            expect(popoverHp?.trim()).toBe('40/150');

            // 9. Cross-check engine-level effective max HP — this is the
            //    SAME helper Guild.tsx line 1120 uses for the boss-fight
            //    HUD `maxHp` ref. If the buff was somehow dropped by the
            //    /guild route transition (e.g. a `hydrateForCharacter`
            //    side-effect that resets buff slice), this would catch it.
            const engineMaxHp = await page.evaluate(async () => {
                // @ts-expect-error — dev-time Vite URL not resolvable by tsc
                const engineMod = await import('/src/systems/combatEngine.ts');
                // @ts-expect-error — dev-time Vite URL not resolvable by tsc
                const charMod = await import('/src/stores/characterStore.ts');
                const engine = engineMod as {
                    getEffectiveChar: (c: unknown) => { max_hp: number } | null;
                };
                const ch = (charMod as {
                    useCharacterStore: { getState: () => { character: unknown } };
                }).useCharacterStore.getState().character;
                const eff = engine.getEffectiveChar(ch);
                return eff?.max_hp ?? null;
            });
            expect(engineMaxHp).toBe(150);

            // 10. Verify multiplier helper agrees.
            const multiplier = await page.evaluate(async () => {
                // @ts-expect-error — dev-time Vite URL not resolvable by tsc
                const mod = await import('/src/systems/combatElixirs.ts');
                return (mod as { getElixirHpPctMultiplier: () => number }).getElixirHpPctMultiplier();
            });
            expect(multiplier).toBe(1.25);
        } finally {
            if (guildId !== null) {
                await cleanupGuildsByLeaderIds([createdId]);
            }
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
