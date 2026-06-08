/**
 * Atomic E2E — MP consistency on `/combat` view with active `mp_pct_25` buff.
 *
 * Spec (BACKLOG.md punkt 3.10 expansion): "MP — wszystkie powyższe wzorce
 * dla HP". Pokrywa COMBAT view for MP percentage elixir (analog to 3.5-combat
 * but for MP).
 *
 * Mage chosen for visible delta: max_mp baseline = 200, so 25% buff gives
 * 250 — a clear differential from raw 200. Knight (max_mp=30) would also
 * work numerically (raw 30 → eff 37) but the smaller numbers are less
 * obvious in failure debug output.
 *
 * ## Why test MP on /combat specifically
 *
 * MP is the primary resource for spell-cast cooldown gating in combat
 * (combatEngine.ts `getSkillMpCost` returns N% of max MP). If the engine
 * reads raw `character.max_mp = 200` for cost calculation but the UI
 * displays effective `eff.max_mp = 250`, the player would tap a spell
 * thinking they have enough MP and the cast would silently refuse —
 * a frustrating UX bug. This test pins the contract that BOTH sides
 * read the same effective value.
 *
 * ## Setup
 *
 * - Mage, level 5, mp=80, hp_regen=0, mp_regen=0.
 * - Buff `mp_pct_25` (effect `mp_pct_25`).
 * - SECONDARY account per task brief.
 *
 * ## Expected math
 *
 * Mage base max_mp = 200 (CLASS_BASE_STATS w createCharacter.ts).
 *   raw = 200 + 0 + 0 + 0 + 0 = 200
 *   eff = floor(200 × 1.25) = 250
 *
 * MP starts at 80 → expect `80/250` on TopHeader popover.
 *
 * Cleanup: try/finally + `cleanupCharacterById`.
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { seedGameSave, findUserIdByEmail } from '../../fixtures/seedGameSave';
import { runCombatViaSkip } from '../../fixtures/combatSim';

test.describe('Combat › Elixirs', { tag: '@combat' }, () => {
    test.describe.configure({ timeout: 90_000 });

    test('mp_pct_25 buff active → /combat TopHeader popover shows boosted max MP + engine getEffectiveChar agrees + SKIP fight resolves', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            // 1. Seed Mage lvl 5 on SECONDARY.
            //    Mage base max_mp=200 — sufficient baseline for 25% to be
            //    visually distinctive (200 → 250).
            //    HP stays at class baseline (80) — the SKIP fight against
            //    rat (atk=7, speed=5) would burn through a Mage with hp=50
            //    before they finish their 8 hits needed to kill rat
            //    (atk=6, def=2 → ~4 dmg per hit; Mage atk_speed=2.0 vs
            //    rat speed=5 → rat hits faster). Full HP gives Mage the
            //    cushion to win deterministically on both profiles.
            //    Under-max MP (80/200 → 80/250 effective) is what we
            //    actually need to read on the popover.
            const created = await createCharacterViaApi({
                userEmail: testUsers.secondary.email,
                name: nick,
                class: 'Mage',
                overrides: { mp: 80, level: 5, highest_level: 5, hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            // 2. Seed buff. effect `mp_pct_25` is read by
            //    `getElixirMpPctMultiplier` (combatElixirs.ts ~line 46).
            const userId = await findUserIdByEmail(testUsers.secondary.email);
            await seedGameSave({
                characterId: createdId,
                userId,
                buffs: [
                    {
                        id: 'mp_pct_25',
                        name: 'Max MP +25%',
                        icon: '💠',
                        effect: 'mp_pct_25',
                    },
                ],
            });

            // 3. Login + Town hydration.
            await loginViaUI(page, testUsers.secondary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 15_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
            await expect(page.locator('.town__char-name')).toHaveText(nick, { timeout: 10_000 });

            // 4. Sanity: buff live in runtime store.
            const hasBuffAtTown = await page.evaluate(async () => {
                // @ts-expect-error — dev-time Vite URL not resolvable by tsc
                const mod = await import('/src/stores/buffStore.ts');
                return (mod as {
                    useBuffStore: { getState: () => { hasBuff: (e: string) => boolean } };
                }).useBuffStore.getState().hasBuff('mp_pct_25');
            });
            expect(hasBuffAtTown).toBe(true);

            // 5. Navigate to /combat directly (battle-hub UI flow covered
            //    by `battle/*` smoke tests; here we only care about the
            //    /combat HP rendering).
            await page.goto('/combat');
            await expect(page.locator('.combat__hub-monsters, .combat__hub-empty').first())
                .toBeVisible({ timeout: 10_000 });

            // 6. Open TopHeader popover, read MP.
            //    Expect `80/250` (Mage base 200 × 1.25 = 250).
            const pulseBtn = page.locator('.top-header__pulse').first();
            await expect(pulseBtn).toBeVisible({ timeout: 5_000 });
            await pulseBtn.tap();
            const popoverMp = await page
                .locator('.top-header__pulse-popover-row--mp .top-header__pulse-popover-val')
                .first()
                .textContent();
            expect(popoverMp?.trim()).toBe('80/250');

            // 7. Cross-check engine-level effective max MP.
            const engineMaxMp = await page.evaluate(async () => {
                // @ts-expect-error — dev-time Vite URL not resolvable by tsc
                const engineMod = await import('/src/systems/combatEngine.ts');
                // @ts-expect-error — dev-time Vite URL not resolvable by tsc
                const charMod = await import('/src/stores/characterStore.ts');
                const engine = engineMod as {
                    getEffectiveChar: (c: unknown) => { max_mp: number } | null;
                };
                const ch = (charMod as {
                    useCharacterStore: { getState: () => { character: unknown } };
                }).useCharacterStore.getState().character;
                const eff = engine.getEffectiveChar(ch);
                return eff?.max_mp ?? null;
            });
            expect(engineMaxMp).toBe(250);

            // 8. Verify MP-pct multiplier helper actually fires.
            const multiplier = await page.evaluate(async () => {
                // @ts-expect-error — dev-time Vite URL not resolvable by tsc
                const mod = await import('/src/systems/combatElixirs.ts');
                return (mod as { getElixirMpPctMultiplier: () => number }).getElixirMpPctMultiplier();
            });
            expect(multiplier).toBe(1.25);

            // 9. SKIP fight against rat — proves combat path tolerates MP
            //    multiplier without breaking. Mage one-shots rat with any
            //    HP/MP cap.
            const result = await runCombatViaSkip(page, 'rat');
            expect(result.phase).toBe('victory');
            expect(result.earnedXp).toBeGreaterThan(0);
            expect(result.sessionKills.normal).toBeGreaterThanOrEqual(1);

            // 10. Buff still alive post-fight.
            const hasBuffAfter = await page.evaluate(async () => {
                // @ts-expect-error — dev-time Vite URL not resolvable by tsc
                const mod = await import('/src/stores/buffStore.ts');
                return (mod as {
                    useBuffStore: { getState: () => { hasBuff: (e: string) => boolean } };
                }).useBuffStore.getState().hasBuff('mp_pct_25');
            });
            expect(hasBuffAfter).toBe(true);
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
