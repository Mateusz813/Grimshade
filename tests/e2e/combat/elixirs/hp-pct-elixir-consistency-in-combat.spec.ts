/**
 * Atomic E2E — HP consistency on `/combat` view with active `hp_pct_25` buff.
 *
 * Spec (BACKLOG.md punkt 3.5 expansion): "Eliksir +25% HP -> HP identyczne na:
 * Town + TopHeader + CharacterSelect + każda walka (polowanie/raid/dungeon/
 * boss/arena/trainer/loch/transform) + party + gildia"
 *
 * Pokrywa COMBAT view (3.5-combat slice). 3 widoki w 3-view subset (Town,
 * TopHeader popover w Town, CharacterSelect) pokryte przez
 * `shop/elixirs/hp-pct-elixir-consistency-across-views.spec.ts`. Ten test
 * weryfikuje SAMĄ /combat ścieżkę:
 *
 *   1. **Combat HUD's engine-level effective max HP** — `getEffectiveChar`
 *      reads `useBuffStore.hasBuff('hp_pct_25')` via `getElixirHpPctMultiplier`
 *      and returns `max_hp = floor(120 × 1.25) = 150`. This is the value
 *      Combat.tsx (line 638) passes into `playerMaxHpC` for AllyCard rendering
 *      and into auto-potion max HP comparisons. Guards against the bug where
 *      `playerMaxHp` would silently fall back to raw 120 (potion would fire
 *      "at 50% max" computing from 120 instead of 150 -> wrong threshold).
 *
 *   2. **TopHeader pulse popover ON /combat** — TopHeader mounts on every
 *      route (AppShell.tsx line 409 `{showChrome && <TopHeader />}`), and
 *      its HP value is derived from `getEffectiveChar(character).max_hp`
 *      (TopHeader.tsx line 193-194). On /combat the popover row should
 *      ALSO show `40/150`, identical to Town's reading. This is the
 *      canonical "user sees the same HP value in combat as in town" check.
 *
 *   3. **Engine SKIP-resolve fight succeeds with boosted HP cap** — run
 *      `runCombatViaSkip(page, 'rat')` to prove the buff doesn't break the
 *      combat path. Phase resolves to victory, XP awarded, kill counter
 *      bumped. Catches the bug where the multiplier propagates a NaN
 *      through `playerCurrentHp` clamping (combatEngine.ts line 1518:
 *      `Math.min(effectiveChar.max_hp, ...)` would NaN-out if multiplier
 *      returned NaN, breaking every subsequent attack tick).
 *
 * ## Why not assert the in-fight HUD value (during `phase='fighting'`)?
 *
 * The combat HUD's player AllyCard renders HP as a BAR (% of effective max),
 * not as a textual `40/150` string (AllyCard.tsx line 25). The textual
 * value lives only in TopHeader popover. So the in-fight textual assertion
 * IS the TopHeader popover assertion. No additional combat-only locator
 * exists for the player's effective max HP as text.
 *
 * The engine-level `getEffectiveChar(character).max_hp` evaluation IS the
 * "combat HUD reads correct max" assertion — that's the exact value
 * Combat.tsx uses for `playerEffMaxHp` (line 2409). Asserting it in test
 * via page.evaluate skips the bar-percentage indirection and gives us a
 * deterministic numeric assertion.
 *
 * ## Setup
 *
 * - Knight, level 5, hp=40, hp_regen=0, mp_regen=0 (per CLAUDE.md TESTING).
 * - Buff `hp_pct_25` (effect `hp_pct_25`) seeded via `seedGameSave({ buffs })`.
 * - SECONDARY account per task brief — primary is the background suite host.
 *
 * ## Expected math
 *
 * Knight base max_hp = 120 (CLASS_BASE_STATS w createCharacter.ts).
 *   raw = 120 + 0 + 0 + 0 + 0 = 120
 *   eff = floor(120 × 1.25) = 150
 *
 * HP starts at 40 -> expect `40/150` on TopHeader popover.
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

    test('hp_pct_25 buff active -> /combat TopHeader popover shows boosted max HP + engine getEffectiveChar agrees + SKIP fight resolves', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            // 1. Seed Knight lvl 5 on SECONDARY (suite is on primary).
            //    hp=40, hp_regen=0, mp_regen=0 — under-max & race-free.
            const created = await createCharacterViaApi({
                userEmail: testUsers.secondary.email,
                name: nick,
                class: 'Knight',
                overrides: { hp: 40, mp: 15, level: 5, highest_level: 5, hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            // 2. Seed buff via game_saves blob. effect `hp_pct_25` is read by
            //    `getElixirHpPctMultiplier` (combatElixirs.ts) -> returns 1.25
            //    when buff active. Pausable timerMode means buff doesn't
            //    drain out-of-combat AND drains slowly in combat (2000ms tick
            //    per SKIP fight — well within 24h remainingMs).
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
                        // Defaults: timerMode='pausable', remainingMs=24h.
                    },
                ],
            });

            // 3. Login + Town hydration. applyBlobToStores hydrates buff
            //    into useBuffStore so the buff is "live" by Town reach.
            await loginViaUI(page, testUsers.secondary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 15_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
            await expect(page.locator('.town__char-name')).toHaveText(nick, { timeout: 10_000 });

            // 4. Sanity gate: buff lives in runtime store before navigating
            //    to /combat. Without this, a Vite HMR / hydrate race could
            //    leave the buff slice empty and the combat-engine path would
            //    correctly report effective=120 (raw), and the test would
            //    pass-when-it-shouldn't (asserting raw 120/120 as "correct").
            //    Better to fail-fast on the seed pipeline.
            const hasBuffAtTown = await page.evaluate(async () => {
                // @ts-expect-error — dev-time Vite URL not resolvable by tsc
                const mod = await import('/src/stores/buffStore.ts');
                return (mod as {
                    useBuffStore: { getState: () => { hasBuff: (e: string) => boolean } };
                }).useBuffStore.getState().hasBuff('hp_pct_25');
            });
            expect(hasBuffAtTown).toBe(true);

            // 5. Navigate to /combat. TopHeader continues to mount (AppShell
            //    flags /combat as a "chrome" route, line 409). The
            //    `.top-header__pulse-popover-row--hp` is identical to Town's
            //    rendering — both share TopHeader.tsx as the source.
            //    Direct goto vs tap-through-battle-hub: battle-hub UI flow
            //    is covered by `battle/*` smoke tests; we want to land on
            //    /combat fast for this elixir-consistency assertion.
            await page.goto('/combat');
            // Wait for the hub page chrome to be fully painted (filters
            // strip + monster list section). Without this, the TopHeader
            // pulse btn might be intercepted by a still-fading route
            // transition overlay.
            await expect(page.locator('.combat__hub-monsters, .combat__hub-empty').first())
                .toBeVisible({ timeout: 10_000 });

            // 6. Open TopHeader popover, read HP. Same value as Town would
            //    show — proves the popover is route-agnostic and reads
            //    effective max HP regardless of which view we sit on.
            //    Format: `liveHp.toLocaleString('pl-PL') + '/' + maxHp.toLocaleString('pl-PL')`.
            //    For values < 1000 (40 and 150 both) pl-PL toLocaleString
            //    inserts no separator -> `40/150`.
            const pulseBtn = page.locator('.top-header__pulse').first();
            await expect(pulseBtn).toBeVisible({ timeout: 5_000 });
            await pulseBtn.tap();
            const popoverHp = await page
                .locator('.top-header__pulse-popover-row--hp .top-header__pulse-popover-val')
                .first()
                .textContent();
            expect(popoverHp?.trim()).toBe('40/150');

            // 7. Cross-check engine-level effective max HP (combat HUD source).
            //    `getEffectiveChar(character).max_hp` is the EXACT value
            //    Combat.tsx feeds to AllyCard (`playerMaxHpC` at line 2442-2444)
            //    AND to the auto-potion threshold check (`effectiveChar.max_hp`
            //    at line 1521 / 1541). If TopHeader showed 150 but the engine
            //    returned 120 (or vice-versa), we'd have a split-brain bug
            //    where the player sees one max HP but auto-potion fires at
            //    a different threshold.
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

            // 8. Verify engine multiplier helper actually fires for `hp_pct_25`.
            //    Same regression guard pattern used in 3.4 atk_dmg_25 test —
            //    a hashing / lookup typo in `getElixirHpPctMultiplier` would
            //    leave hasBuff()=true but multiplier=1.0 and engineMaxHp would
            //    silently fall back to 120.
            const multiplier = await page.evaluate(async () => {
                // @ts-expect-error — dev-time Vite URL not resolvable by tsc
                const mod = await import('/src/systems/combatElixirs.ts');
                return (mod as { getElixirHpPctMultiplier: () => number }).getElixirHpPctMultiplier();
            });
            expect(multiplier).toBe(1.25);

            // 9. SKIP fight against rat — proves the combat path doesn't
            //    blow up with the buff active. The 1.25× multiplier flows
            //    through `resolveInstantFight` -> player max HP capping. If
            //    a NaN crept into the multiplier, the engine's
            //    `Math.min(effectiveChar.max_hp, ...)` clamp would NaN-out
            //    and combat would never resolve to 'victory'.
            const result = await runCombatViaSkip(page, 'rat');
            expect(result.phase).toBe('victory');
            expect(result.earnedXp).toBeGreaterThan(0);
            expect(result.sessionKills.normal).toBeGreaterThanOrEqual(1);

            // 10. Buff survived the fight (pausable drain at SKIP=2000ms vs
            //     24h remainingMs -> still active). Same guard as 3.4: if the
            //     buff got wiped mid-combat, the UX claim "buff lasts 15
            //     minutes" would silently break.
            const hasBuffAfter = await page.evaluate(async () => {
                // @ts-expect-error — dev-time Vite URL not resolvable by tsc
                const mod = await import('/src/stores/buffStore.ts');
                return (mod as {
                    useBuffStore: { getState: () => { hasBuff: (e: string) => boolean } };
                }).useBuffStore.getState().hasBuff('hp_pct_25');
            });
            expect(hasBuffAfter).toBe(true);
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
