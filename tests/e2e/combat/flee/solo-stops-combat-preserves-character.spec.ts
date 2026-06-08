/**
 * Atomic E2E — solo HUNT flee (`stopCombat()`) resets the combat session
 * cleanly without applying any progression penalty.
 *
 * Spec (BACKLOG 13.24): "Ucieczka (flee): działa solo + party". The hunt
 * "flee" is the SOFT exit path the player triggers via the in-combat
 * `HuntExitDialog` → "Zakończ polowanie" button (Combat.tsx line 2884-2920).
 * It collapses to `stopCombat()` (combatEngine.ts line 2775) +
 * `combatStore.clearCombatSession()`.
 *
 * Two distinct "flee" paths exist in the codebase and they have OPPOSITE
 * contracts — atomic test must pin which one we're covering:
 *   • HUNT flee (`stopCombat()`): no XP loss, no item loss, character HP/MP
 *     preserved from combat state. Soft "I'm done hunting" exit.
 *   • DUNGEON / BOSS / RAID / TRANSFORM flee
 *     (`applyCombatLeaveDeath()` in `combatLeavePenalty.ts`): heavy death
 *     penalty — level drop, XP reset, item loss, deaths-feed row with
 *     `result='fled'`. URL-leave / mid-combat-abandon cheat-guard.
 *
 * This test covers the HUNT branch (the only path that's reachable through
 * the `/combat` view's "Uciekaj"-style exit). The dungeon/boss/raid leave
 * penalty branch is already covered by:
 *   • `combat/flee/feed-shows-seeded-flee.spec.ts` (feed verb render)
 *   • `combat/death/eq-loss-after-real-death.spec.ts` (item-loss path)
 *   • `combat/death/real-death-applies-xp-penalty.spec.ts` (XP-loss path)
 *
 * ## Test strategy — engine-driven, no UI taps required
 *
 * `stopCombat()` is a pure store-mutating function — it doesn't go through
 * any animation, modal, or timer. We:
 *   1. Stage a live fight via `combatStore.initCombat(monster, hp, mp)`
 *      (same primitive the engine uses when `startNewFight` begins a
 *      wave). After init, `phase==='fighting'` + `monsterCurrentHp` /
 *      `playerCurrentHp` are populated.
 *   2. Mutate `playerCurrentHp` to a non-max value (40) so we can assert
 *      `stopCombat()` writes that exact value back to the character store
 *      (proves the "save HP from combat state" branch at combatEngine.ts
 *      line 2790-2795 ran).
 *   3. Invoke `stopCombat()` directly.
 *   4. Assert post-state:
 *     a. `combatStore.phase === 'idle'` (resetCombat ran).
 *     b. `combatStore.monster === null` (resetCombat ran).
 *     c. `combatStore.waveMonsters.length === 0` (full reset).
 *     d. `characterStore.character.hp === 40` (HP saved from combat
 *        state — proves the player keeps the damage they took).
 *     e. `characterStore.character.level === 50` (UNCHANGED — no
 *        penalty applied).
 *     f. `characterStore.character.xp === 0` (UNCHANGED — no XP reset).
 *     g. `inventoryStore.bag.length === 3` (UNCHANGED — no item drop).
 *
 * Bug surfaces this test catches:
 *   - Someone wires `applyCombatLeaveDeath` into the hunt-flee path by
 *     mistake → level + items + XP would all wipe.
 *   - `stopCombat()` skips the `updateCharacter({ hp, mp })` write when
 *     `phase === 'fighting'` (regression on line 2790 if-condition) →
 *     character HP stays at pre-combat value, masking damage taken.
 *   - `resetCombat()` accidentally retains `monster` or `phase: 'fighting'`
 *     → next /combat view mount would stale-render the previous fight.
 *
 * ## Why no party path here
 *
 * Party flee is a separate test (`party-leader-flee-broadcasts-combat-end.spec.ts`)
 * with multi-context — exercises the `publishCombatEnd` broadcast path
 * (combatEngine.ts line 2820-2826) that the leader fires when in a
 * multi-human party. This file stays atomic / solo.
 *
 * ## Cleanup
 *
 * try/finally + `cleanupCharacterById` per CLAUDE.md TESTING rule. Knight
 * lvl 50 seeded with no consumables; one cleanup call covers everything.
 */

import { test, expect, type Page } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';

/** Pick character → land in Town. Mirrors pattern from sibling combat-sim tests. */
const pickCharacterAndEnterTown = async (page: Page, nick: string): Promise<void> => {
    await page.goto('/character-select');
    const card = page.locator('.char-select__card', {
        has: page.locator('.char-select__card-name', { hasText: nick }),
    });
    await expect(card).toBeVisible({ timeout: 15_000 });
    await card.getByRole('button', { name: /Wybierz/i }).tap();
    await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
};

/**
 * Snapshot of combat + character + inventory state read in a single
 * `page.evaluate` round-trip — avoids inter-store drift between reads.
 */
interface IFleeSnapshot {
    phase: 'idle' | 'fighting' | 'victory' | 'dead';
    monsterIsNull: boolean;
    waveMonstersCount: number;
    characterHp: number;
    characterMp: number;
    characterLevel: number;
    characterXp: number;
    bagSize: number;
}

const readFleeSnapshot = async (page: Page): Promise<IFleeSnapshot> => {
    return await page.evaluate(async (): Promise<IFleeSnapshot> => {
        // @ts-expect-error — dev-time Vite URL not resolvable by tsc
        const combatMod = await import('/src/stores/combatStore.ts');
        // @ts-expect-error — dev-time Vite URL not resolvable by tsc
        const charMod = await import('/src/stores/characterStore.ts');
        // @ts-expect-error — dev-time Vite URL not resolvable by tsc
        const invMod = await import('/src/stores/inventoryStore.ts');

        const combat = (combatMod as {
            useCombatStore: {
                getState: () => {
                    phase: 'idle' | 'fighting' | 'victory' | 'dead';
                    monster: unknown;
                    waveMonsters: unknown[];
                };
            };
        }).useCombatStore.getState();

        const character = (charMod as {
            useCharacterStore: {
                getState: () => { character: { hp: number; mp: number; level: number; xp: number } | null };
            };
        }).useCharacterStore.getState().character;
        if (!character) throw new Error('[fleeSnapshot] no character hydrated');

        const inv = (invMod as {
            useInventoryStore: { getState: () => { bag: unknown[] } };
        }).useInventoryStore.getState();

        return {
            phase: combat.phase,
            monsterIsNull: combat.monster === null,
            waveMonstersCount: combat.waveMonsters.length,
            characterHp: character.hp,
            characterMp: character.mp,
            characterLevel: character.level,
            characterXp: character.xp,
            bagSize: inv.bag.length,
        };
    });
};

test.describe('Combat › Flee', { tag: '@combat' }, () => {
    test.describe.configure({ timeout: 90_000 });

    test('solo stopCombat() resets phase + preserves character (no penalty, no item loss)', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            // 1. Seed Knight lvl 50 (xp=0 for deterministic post-snapshot
            //    assertion). No consumables, no AOL, no DP — pure baseline
            //    so any accidental penalty surfaces as level/xp/items drift.
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: { level: 50, highest_level: 50, hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            // 2. Login + pick character → Town.
            await loginViaUI(page, testUsers.primary);
            await pickCharacterAndEnterTown(page, nick);

            // 3. Seed 3 inventory items via direct `addItem` calls so we can
            //    assert flee doesn't lose any. Construct minimal valid
            //    `IInventoryItem` shape (itemSystem.ts line 216): uuid +
            //    itemId + rarity + bonuses + itemLevel + optional upgradeLevel.
            //    Item ids are stable entries from `src/data/items.json`.
            //    Direct `addItem` is the same call site loot drops use
            //    (combatEngine.ts → dropLootToInventory → addItem).
            //    Important: items must NOT be 'common'-with-auto-sell-on —
            //    fresh char defaults to autoSell.common=false so this is safe.
            await page.evaluate(async () => {
                // @ts-expect-error — Vite URL
                const invMod = await import('/src/stores/inventoryStore.ts');
                const useInventoryStore = (invMod as {
                    useInventoryStore: {
                        getState: () => { addItem: (item: unknown) => boolean };
                    };
                }).useInventoryStore;
                const mkItem = (itemId: string): Record<string, unknown> => ({
                    uuid: `${itemId}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                    itemId,
                    rarity: 'rare', // NOT 'common' to dodge any auto-sell rarity flag drift
                    bonuses: {},
                    itemLevel: 1,
                    upgradeLevel: 0,
                });
                for (const itemId of ['iron_sword', 'iron_helmet', 'leather_armor']) {
                    useInventoryStore.getState().addItem(mkItem(itemId));
                }
            });

            // 4. Stage a live fight via `combatStore.initCombat` + manually
            //    set playerCurrentHp to 40 (Knight max_hp is 120 default).
            //    initCombat sets phase='fighting', writes monster, populates
            //    waveMonsters[0]. Then we forge playerCurrentHp=40 so the
            //    stopCombat HP-save branch has a non-trivial value to write.
            await page.evaluate(async () => {
                // @ts-expect-error — Vite URL
                const engineMod = await import('/src/systems/combatEngine.ts');
                // @ts-expect-error — Vite URL
                const combatMod = await import('/src/stores/combatStore.ts');
                const engine = engineMod as {
                    getAllMonsters: () => Array<{ id: string }>;
                };
                const useCombatStore = (combatMod as {
                    useCombatStore: {
                        getState: () => {
                            initCombat: (m: unknown, hp: number, mp: number, rarity?: string) => void;
                        };
                        setState: (patch: { playerCurrentHp: number }) => void;
                    };
                }).useCombatStore;
                const rat = engine.getAllMonsters().find((m) => m.id === 'rat');
                if (!rat) throw new Error('[stage fight] rat monster not found');
                useCombatStore.getState().initCombat(rat, 40, 30, 'normal');
                // Manually pin playerCurrentHp=40 (initCombat used hp arg
                // but defensive against future signature changes).
                useCombatStore.setState({ playerCurrentHp: 40 });
            });

            // 5. PRE-snapshot — verify staging worked.
            const preSnapshot = await readFleeSnapshot(page);
            expect(preSnapshot.phase).toBe('fighting');
            expect(preSnapshot.monsterIsNull).toBe(false);
            expect(preSnapshot.waveMonstersCount).toBeGreaterThanOrEqual(1);
            expect(preSnapshot.characterLevel).toBe(50);
            expect(preSnapshot.characterXp).toBe(0);
            expect(preSnapshot.bagSize).toBe(3);
            // characterHp may still be the seed value (120) — combatStore's
            // playerCurrentHp tracks the FIGHT pool, character.hp persists
            // pre-fight. stopCombat() is what writes combatStore→character.

            // 6. ACTION — call `stopCombat()` directly. This is the EXACT
            //    function the HuntExitDialog "Zakończ polowanie" handler
            //    runs (Combat.tsx line 2889). Solo character (no party),
            //    so the `isMemberInPartyCombat` branch is FALSE → the
            //    line 2790 `updateCharacter({ hp, mp })` branch fires.
            await page.evaluate(async () => {
                // @ts-expect-error — Vite URL
                const engineMod = await import('/src/systems/combatEngine.ts');
                const engine = engineMod as { stopCombat: () => void };
                engine.stopCombat();
            });

            // 7. POST-snapshot — assertions on the contract.
            const postSnapshot = await readFleeSnapshot(page);

            // 7a. Phase reset to 'idle' (resetCombat ran).
            expect(postSnapshot.phase).toBe('idle');
            // 7b. Monster cleared (resetCombat ran).
            expect(postSnapshot.monsterIsNull).toBe(true);
            // 7c. Wave cleared.
            expect(postSnapshot.waveMonstersCount).toBe(0);
            // 7d. Character HP saved from combat state — proves the
            //     line 2790-2795 branch wrote `playerCurrentHp → character.hp`.
            //     If someone broke the branch, characterHp would stay at
            //     the pre-fight 120 instead of 40.
            expect(postSnapshot.characterHp).toBe(40);
            // 7e. Character MP also saved (line 2793).
            expect(postSnapshot.characterMp).toBe(30);
            // 7f. LEVEL UNCHANGED — no penalty applied. This is the
            //     load-bearing assertion: if someone accidentally wires
            //     `applyCombatLeaveDeath` into the hunt-flee path, level
            //     would drop (floor(50 * 0.02) = 1 level lost).
            expect(postSnapshot.characterLevel).toBe(50);
            // 7g. XP UNCHANGED — no penalty.newXp=0 reset.
            expect(postSnapshot.characterXp).toBe(0);
            // 7h. BAG UNCHANGED — no item loss. If `applyDeathItemLoss(false)`
            //     ran by accident, bag would be ≤2 (5% × 3 floor = 0,
            //     Math.max(1, 0) = 1 lost → bag = 2).
            expect(postSnapshot.bagSize).toBe(3);
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
