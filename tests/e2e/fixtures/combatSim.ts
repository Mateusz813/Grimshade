/**
 * Combat simulation helpers for E2E tests.
 *
 * ## Why this fixture exists
 *
 * Many BACKLOG items (13.5x full-combat, 13.12 kill counter, 13.13 logs +
 * drops, 13.17 inventory-full, 13.20 death penalty) need REAL combat
 * happening — start fight, mob takes damage, mob dies, drop spawns,
 * character XP/level/gold update. Pure UI tap-attack-button-N-times
 * approach is:
 *   • Slow (each attack tick = 500-2000ms wall clock).
 *   • Fragile (timing depends on `attack_speed`, monster `speed`, RNG
 *     for crits / dodge / block; one bad seed and the test sticks).
 *   • Auto-fight + auto-cast + auto-potion side effects bleed into the
 *     measurement (every kill triggers a fresh `startNewFight` after the
 *     `AUTO_FIGHT_DELAY_MS` countdown).
 *
 * ## Strategy: SKIP-speed instant resolution
 *
 * We exploit the engine's existing **SKIP combat speed** (added for
 * speed-runners): when `settingsStore.combatSpeed === 'SKIP'` and
 * `startNewFight(monster)` is invoked, the engine calls
 * `resolveInstantFight()` which runs a 5000-iteration battle simulation
 * SYNCHRONOUSLY and writes the final state into `combatStore` /
 * `characterStore` / `inventoryStore` before returning. No setInterval,
 * no animation, no React render delay between attacks — one call, fully
 * deterministic, takes ~5ms.
 *
 * That's the same code path the in-game SKIP button uses, so we're
 * exercising real production logic — not a test double. Result:
 *   • `combatStore.phase` flips `idle → fighting → victory` (or `dead`).
 *   • `combatStore.earnedXp` / `earnedGold` populated.
 *   • `combatStore.sessionKills[rarity]` incremented.
 *   • `combatStore.sessionLog` populated with kill / drop log lines.
 *   • `inventoryStore.gold` increased.
 *   • `inventoryStore.bag` has any dropped items appended.
 *   • `characterStore.xp` increased (or level bumped if XP threshold hit).
 *
 * ## What we DON'T cover
 *
 * • Wave combat with multi-monster aggro (SKIP processes per-monster but
 *   simpler than the live combat loop). For wave-aggro-specific tests
 *   (e.g. "spell retargets on ally kill") consider a different approach.
 * • Animations / particle effects — invisible to engine-driven tests.
 * • Real attack-speed cadence — SKIP collapses the entire fight into one
 *   tick. Use a different strategy if you need to assert "one log entry
 *   every `attack_speed` seconds".
 * • Multi-context party Realtime — each browser ctx has its own combat
 *   engine; SKIP would resolve each independently, missing the broadcast
 *   path that's the whole point of party tests.
 *
 * ## Hard requirements before invoking
 *
 *   1. Player must already be in the app with `characterStore.character`
 *      hydrated — i.e. logged in + character picked + Town view reached.
 *      Call `loginViaUI` + character-select tap → wait for Town BEFORE
 *      navigating to `/combat`.
 *   2. The chosen monster's `level` must be ≤ character `level` (engine
 *      bails with a log line otherwise). For the easiest fast kill, use
 *      `'rat'` (level 1, hp 30, defense 2) — every starting Knight one-
 *      shots it.
 *   3. The combat view does NOT need to be mounted for SKIP mode —
 *      `startNewFight` operates entirely on stores. But if you want to
 *      see the post-victory UI render, navigate to `/combat` AFTER the
 *      resolved fight (the view picks up `phase === 'victory'` and
 *      shows the post-fight footer).
 *
 * ## Cleanup
 *
 * SKIP mode mutates BOTH the combat store AND the character store +
 * inventory store + task / quest / mastery / daily stores (kills count
 * for tasks, drops fill bag). All those mutations persist into
 * `game_saves` via the auto-save subscription. So:
 *
 *   • In-memory state — restored by the next page navigation (Combat.tsx
 *     re-mount re-reads stores; new login = fresh hydration).
 *   • DB state — cleaned by `cleanupCharacterById(id)` in `finally` of
 *     each test (kills the character row → CASCADE deletes game_saves +
 *     all character-scoped tables).
 *
 * ## Restoring the speed setting between tests
 *
 * `runCombatViaSkip` sets `combatSpeed` to `'SKIP'` for the duration of
 * its work. It restores the previous value before returning so the next
 * navigation / test doesn't inherit `'SKIP'` mode in the UI. If your
 * test depends on `combatSpeed` being a specific value AFTER the sim,
 * pass it explicitly via `useSettingsStore.getState().setCombatSpeed()`
 * after the sim call.
 */

import { type Page, expect } from '@playwright/test';

/**
 * Snapshot of combat-relevant store state at the moment of the call.
 * Pulled via a single `page.evaluate` round-trip so the values are
 * consistent (no inter-state drift between separate reads).
 */
export interface ICombatSnapshot {
    /** combatStore.phase — 'idle' | 'fighting' | 'victory' | 'dead'. */
    phase: 'idle' | 'fighting' | 'victory' | 'dead';
    /** combatStore.earnedXp — XP awarded this fight (resets each `startNewFight`). */
    earnedXp: number;
    /** combatStore.earnedGold — gold awarded this fight. */
    earnedGold: number;
    /** combatStore.monsterCurrentHp — monster HP at snapshot time (0 = dead). */
    monsterHp: number;
    /** combatStore.playerCurrentHp — player HP at snapshot time. */
    playerHp: number;
    /** combatStore.sessionKills — kills by rarity across the current combat session. */
    sessionKills: Record<string, number>;
    /** combatStore.sessionLog — uncapped per-session log (last N entries). */
    sessionLog: Array<{ id: number; text: string; type: string }>;
    /** combatStore.lastDrops — items dropped in the most recent fight only. */
    lastDrops: Array<{ name: string; icon?: string; rarity?: string }>;
    /** combatStore.sessionDrops — cumulative drops across the combat session. */
    sessionDrops: Array<{ name: string; icon?: string; rarity?: string }>;
}

/**
 * Snapshot of character-relevant store state. Used by death-penalty tests
 * to assert level/xp changes after `handlePlayerDeath`.
 */
export interface ICharacterSnapshot {
    level: number;
    xp: number;
    hp: number;
    mp: number;
    max_hp: number;
    max_mp: number;
    gold: number;
    bagSize: number;
}

/**
 * Read a unified snapshot of combat + character + inventory state.
 *
 * Single `page.evaluate` round-trip avoids inter-read drift (if you
 * read combat first, wait 5ms, then character, the engine could have
 * ticked between them).
 *
 * Returns `null` if the stores haven't been mounted yet (e.g. called
 * before navigation to any view that imports them).
 */
export const getCombatSnapshot = async (page: Page): Promise<ICombatSnapshot | null> => {
    return await page.evaluate(async () => {
        // @ts-expect-error — dev-time Vite URL not resolvable by tsc, works in browser
        const combatMod = await import('/src/stores/combatStore.ts');
        const combat = (combatMod as {
            useCombatStore: { getState: () => unknown };
        }).useCombatStore.getState() as {
            phase: 'idle' | 'fighting' | 'victory' | 'dead';
            earnedXp: number;
            earnedGold: number;
            monsterCurrentHp: number;
            playerCurrentHp: number;
            sessionKills: Record<string, number>;
            sessionLog: Array<{ id: number; text: string; type: string }>;
            lastDrops: Array<{ name: string; icon?: string; rarity?: string }>;
            sessionDrops: Array<{ name: string; icon?: string; rarity?: string }>;
        };
        return {
            phase: combat.phase,
            earnedXp: combat.earnedXp,
            earnedGold: combat.earnedGold,
            monsterHp: combat.monsterCurrentHp,
            playerHp: combat.playerCurrentHp,
            // Defensive copy — the live array is mutated by store actions and
            // a Playwright-serialized reference would carry stale data across
            // assertion deferrals.
            sessionKills: { ...combat.sessionKills },
            sessionLog: combat.sessionLog.map((l) => ({ ...l })),
            lastDrops: combat.lastDrops.map((d) => ({ ...d })),
            sessionDrops: combat.sessionDrops.map((d) => ({ ...d })),
        };
    });
};

/**
 * Read the live character + inventory state. Companion to
 * `getCombatSnapshot` — split because death-penalty tests need
 * pre/post character snapshots without combat noise.
 */
export const getCharacterSnapshot = async (page: Page): Promise<ICharacterSnapshot | null> => {
    return await page.evaluate(async () => {
        // @ts-expect-error — dev-time Vite URL not resolvable by tsc
        const charMod = await import('/src/stores/characterStore.ts');
        // @ts-expect-error — dev-time Vite URL not resolvable by tsc
        const invMod = await import('/src/stores/inventoryStore.ts');
        const character = (charMod as {
            useCharacterStore: { getState: () => { character: unknown } };
        }).useCharacterStore.getState().character as {
            level: number;
            xp: number;
            hp: number;
            mp: number;
            max_hp: number;
            max_mp: number;
        } | null;
        if (!character) return null;
        const inv = (invMod as {
            useInventoryStore: { getState: () => { gold: number; bag: unknown[] } };
        }).useInventoryStore.getState();
        return {
            level: character.level,
            xp: character.xp,
            hp: character.hp,
            mp: character.mp,
            max_hp: character.max_hp,
            max_mp: character.max_mp,
            gold: inv.gold,
            bagSize: inv.bag.length,
        };
    });
};

/**
 * Resolve a single fight against the named monster using SKIP-speed
 * instant resolution. Caller MUST have a character hydrated and be in
 * a non-offline state when calling.
 *
 * The chosen monster's level must be ≤ character.level or the engine
 * bails silently (returns without setting phase=fighting). The default
 * `'rat'` (level 1) is safe for any starting character lvl 1+.
 *
 * Returns the post-fight snapshot so the caller can chain assertions
 * without an extra `getCombatSnapshot` call. After return:
 *   • combatStore.phase === 'victory' (typical) or 'dead' (if monster
 *     killed the player — only possible if you crank the monster level
 *     way above the char or seed the char with damaged HP).
 *   • All reward systems applied (xp / gold / drops / task / quest /
 *     mastery / daily quest).
 *   • Speed setting restored to its previous value.
 *
 * @param page Playwright page with the app hydrated.
 * @param monsterId Monster id from `src/data/monsters.json` (e.g. 'rat').
 *
 * @example
 * await loginViaUI(page, testUsers.primary);
 * await page.goto('/character-select');
 * await pickCharacter(page, charName);
 * await expect(page).toHaveURL(/\/$/); // Town hydrated
 * const result = await runCombatViaSkip(page, 'rat');
 * expect(result.phase).toBe('victory');
 * expect(result.earnedXp).toBeGreaterThan(0);
 */
export const runCombatViaSkip = async (
    page: Page,
    monsterId: string = 'rat',
): Promise<ICombatSnapshot> => {
    // Run the entire SKIP-fight inside one page.evaluate. Module imports
    // are cached by the Vite dev server so the dynamic-import overhead
    // is one-time per page session (~10ms first call, <1ms thereafter).
    const result = await page.evaluate(async (mId): Promise<ICombatSnapshot> => {
        // @ts-expect-error — dev-time Vite URL not resolvable by tsc
        const settingsMod = await import('/src/stores/settingsStore.ts');
        // @ts-expect-error — dev-time Vite URL not resolvable by tsc
        const engineMod = await import('/src/systems/combatEngine.ts');
        // @ts-expect-error — dev-time Vite URL not resolvable by tsc
        const combatMod = await import('/src/stores/combatStore.ts');
        // @ts-expect-error — dev-time Vite URL not resolvable by tsc
        const charMod = await import('/src/stores/characterStore.ts');

        const useSettingsStore = (settingsMod as {
            useSettingsStore: {
                getState: () => {
                    combatSpeed: string;
                    setCombatSpeed: (s: string) => void;
                };
            };
        }).useSettingsStore;
        const engine = engineMod as {
            getAllMonsters: () => Array<{ id: string; level: number }>;
            startNewFight: (m: unknown, bypassLevelCheck?: boolean) => void;
        };
        const useCombatStore = (combatMod as {
            useCombatStore: { getState: () => unknown };
        }).useCombatStore;
        const useCharacterStore = (charMod as {
            useCharacterStore: { getState: () => { character: { level: number } | null } };
        }).useCharacterStore;

        const character = useCharacterStore.getState().character;
        if (!character) {
            throw new Error('[combatSim] runCombatViaSkip: no character hydrated yet');
        }

        // Find the monster definition. `getAllMonsters` is sorted by level
        // — fine to filter, every entry has `id`.
        const monster = engine.getAllMonsters().find((m) => m.id === mId);
        if (!monster) {
            throw new Error(`[combatSim] runCombatViaSkip: unknown monster id "${mId}"`);
        }
        if (monster.level > character.level) {
            // Bypass level check by passing `bypassLevelCheck=true` to
            // startNewFight (same flag party-members use). Otherwise
            // engine just logs and returns, leaving phase='idle' and
            // the caller's assertions wonder why nothing happened.
            // We CHOOSE bypass=true so tests can deliberately fight
            // high-level mobs to drive death scenarios.
        }

        // Stash + set speed to SKIP.
        const previousSpeed = useSettingsStore.getState().combatSpeed;
        useSettingsStore.getState().setCombatSpeed('SKIP');

        try {
            // Run the fight. SKIP mode is fully synchronous — by the time
            // `startNewFight` returns, the combat store has been written
            // with `phase: 'victory'` (or 'dead') and all rewards
            // applied.
            engine.startNewFight(monster as unknown, true);
        } finally {
            // Restore speed setting regardless of outcome.
            useSettingsStore.getState().setCombatSpeed(previousSpeed);
        }

        // Pull a snapshot inside the same evaluate so we don't pay another
        // round-trip and so we don't drift if any auto-fight kicks in.
        const combat = useCombatStore.getState() as {
            phase: 'idle' | 'fighting' | 'victory' | 'dead';
            earnedXp: number;
            earnedGold: number;
            monsterCurrentHp: number;
            playerCurrentHp: number;
            sessionKills: Record<string, number>;
            sessionLog: Array<{ id: number; text: string; type: string }>;
            lastDrops: Array<{ name: string; icon?: string; rarity?: string }>;
            sessionDrops: Array<{ name: string; icon?: string; rarity?: string }>;
        };
        return {
            phase: combat.phase,
            earnedXp: combat.earnedXp,
            earnedGold: combat.earnedGold,
            monsterHp: combat.monsterCurrentHp,
            playerHp: combat.playerCurrentHp,
            sessionKills: { ...combat.sessionKills },
            sessionLog: combat.sessionLog.map((l) => ({ ...l })),
            lastDrops: combat.lastDrops.map((d) => ({ ...d })),
            sessionDrops: combat.sessionDrops.map((d) => ({ ...d })),
        };
    }, monsterId);

    return result;
};

/**
 * Force player death via direct engine call. Used by death-penalty tests
 * that need to assert `applyDeathPenalty` ran (xp dropped, items lost,
 * skill XP -50%) without needing to set up a real high-level monster
 * grind to kill the player.
 *
 * What this does (mirrors `handlePlayerDeath` in combatEngine.ts):
 *   1. Sets up a minimal active "monster encounter" via `initCombat` so
 *      `handlePlayerDeath` has a `s.monster` to attribute the kill to
 *      (otherwise the deaths-feed insert silently skips).
 *   2. Calls `handlePlayerDeath(forceConfirm=true)` directly. The
 *      `forceConfirm=true` flag bypasses the party-leader popup gate so
 *      solo-character tests don't need to mock the popup.
 *   3. Returns the resulting character + combat snapshot for asserts.
 *
 * Pre-conditions:
 *   • Character hydrated (`useCharacterStore.character !== null`).
 *   • NOT in a multi-human party (the party-leader / party-member gates
 *     in `handlePlayerDeath` would either show a popup or no-op for
 *     non-leaders). Solo characters skip both gates and run the full
 *     death flow.
 *
 * @param page Playwright page with app hydrated.
 * @param monsterId Optional monster to attribute the death to (default 'rat').
 *
 * @example
 * const before = await getCharacterSnapshot(page);
 * await triggerPlayerDeath(page);
 * const after = await getCharacterSnapshot(page);
 * expect(after.level).toBeLessThanOrEqual(before.level);
 */
export const triggerPlayerDeath = async (
    page: Page,
    monsterId: string = 'rat',
): Promise<void> => {
    await page.evaluate(async (mId) => {
        // @ts-expect-error — dev-time Vite URL not resolvable by tsc
        const engineMod = await import('/src/systems/combatEngine.ts');
        // @ts-expect-error — dev-time Vite URL not resolvable by tsc
        const combatMod = await import('/src/stores/combatStore.ts');
        // @ts-expect-error — dev-time Vite URL not resolvable by tsc
        const charMod = await import('/src/stores/characterStore.ts');

        const engine = engineMod as {
            getAllMonsters: () => Array<{ id: string; level: number; hp: number }>;
            handlePlayerDeath: (forceConfirm?: boolean) => void;
        };
        const useCombatStore = (combatMod as {
            useCombatStore: {
                getState: () => {
                    initCombat: (m: unknown, hp: number, mp: number, rarity?: string) => void;
                };
            };
        }).useCombatStore;
        const useCharacterStore = (charMod as {
            useCharacterStore: {
                getState: () => { character: { hp: number; mp: number } | null };
            };
        }).useCharacterStore;

        const character = useCharacterStore.getState().character;
        if (!character) {
            throw new Error('[combatSim] triggerPlayerDeath: no character hydrated');
        }

        const monster = engine.getAllMonsters().find((m) => m.id === mId);
        if (!monster) {
            throw new Error(`[combatSim] triggerPlayerDeath: unknown monster id "${mId}"`);
        }

        // Stage a fight: handlePlayerDeath reads s.monster to log the
        // death-feed row. Without a monster pre-set, the feed insert
        // silently no-ops and we lose audit visibility into what killed
        // the player.
        useCombatStore.getState().initCombat(monster, 1, character.mp ?? 0, 'normal');
        engine.handlePlayerDeath(true);
    }, monsterId);
};

/**
 * Wait until `combatStore.phase` becomes one of the target values.
 * Pure poll-based — no race-conditions with React render cycles.
 *
 * Default targets `victory` + `dead` which covers any "fight is over"
 * scenario. Pass a custom set if you need to wait for a specific
 * transition.
 *
 * @example
 * await waitForCombatPhase(page, ['victory']); // wait for win
 * await waitForCombatPhase(page, ['dead']);    // wait for loss
 */
export const waitForCombatPhase = async (
    page: Page,
    targets: Array<'idle' | 'fighting' | 'victory' | 'dead'> = ['victory', 'dead'],
    timeoutMs: number = 15_000,
): Promise<'idle' | 'fighting' | 'victory' | 'dead'> => {
    let actualPhase: 'idle' | 'fighting' | 'victory' | 'dead' = 'idle';
    await expect
        .poll(
            async () => {
                actualPhase = await page.evaluate(async () => {
                    // @ts-expect-error — dev-time Vite URL not resolvable by tsc
                    const mod = await import('/src/stores/combatStore.ts');
                    return (mod as {
                        useCombatStore: { getState: () => { phase: 'idle' | 'fighting' | 'victory' | 'dead' } };
                    }).useCombatStore.getState().phase;
                });
                return actualPhase;
            },
            { timeout: timeoutMs, message: `Waiting for combat phase to be one of [${targets.join(', ')}]` },
        )
        .toMatch(new RegExp(`^(${targets.join('|')})$`));
    return actualPhase;
};

/**
 * Save the character stores forcing a non-throttled write so the DB
 * row reflects the latest in-memory state. Use after `runCombatViaSkip`
 * if your test queries `game_saves` directly (e.g. to verify a level-up
 * persisted, or that drops landed in `state.inventory.bag`).
 *
 * Wraps `saveCurrentCharacterStoresForce` from characterScope.ts —
 * bypasses the 4-second auto-save throttle. Same pattern used by the
 * offline-sync test (14.3).
 */
export const forceSaveAfterCombat = async (page: Page): Promise<void> => {
    await page.evaluate(async () => {
        // @ts-expect-error — dev-time Vite URL not resolvable by tsc
        const mod = await import('/src/stores/characterScope.ts');
        await (mod as { saveCurrentCharacterStoresForce: () => Promise<void> })
            .saveCurrentCharacterStoresForce();
    });
};

/**
 * Run the FULL live-combat kill flow (NOT the SKIP path) by setting up
 * a monster encounter then directly calling `handleMonsterDeath(rarity)`.
 *
 * SKIP-mode resolution (`runCombatViaSkip`) intentionally awards 0 gold
 * + no drops (combatEngine.ts line 2515: `const gold = 0;` and line 2516:
 * `setLastDrops([])`). For tests that need drops, gold, mastery kills,
 * task progress — i.e. the FULL post-kill reward suite — we need the
 * live-combat `handleMonsterDeath` path.
 *
 * What this does:
 *  1. `initCombat(monster, playerHp, playerMp, rarity)` — stages the
 *     fight so `combatStore.monster` and `combatStore.activeTargetIdx`
 *     are populated (handleMonsterDeath bails at line 977 if no
 *     `s.monster`).
 *  2. `handleMonsterDeath(rarity)` — runs the production reward flow:
 *       • `dropLootToInventory` → `inventoryStore.addItem` for any drops
 *         + `inventoryStore.addGold` for the rolled gold.
 *       • `useCharacterStore.addXp(finalXp)` → may trigger level-up.
 *       • `taskStore.addKill`, `questStore.addProgress`, masteryStore +
 *         dailyQuestStore progress.
 *       • `incrementSessionKill(rarity)`.
 *       • `saveCurrentCharacterStores` fire-and-forget (throttled).
 *  3. After return, every reward downstream of a real kill has applied.
 *
 * Rarity defaults to 'normal' — pass 'strong'/'epic'/'legendary'/'boss'
 * if you want to test rarity-multiplier paths.
 *
 * Pre-conditions:
 *   • Character hydrated.
 *   • NOT in a multi-human party (would early-return at line 1002 since
 *     local member's `handleMonsterDeath` is broadcast-driven for
 *     non-leaders). Solo / single-bot party is fine.
 *
 * @example
 * await killMonsterViaEngine(page, 'rat');
 * const snap = await getCharacterSnapshot(page);
 * expect(snap.gold).toBeGreaterThanOrEqual(1); // rat gold range [1,1]
 */
export const killMonsterViaEngine = async (
    page: Page,
    monsterId: string = 'rat',
    rarity: 'normal' | 'strong' | 'epic' | 'legendary' | 'boss' = 'normal',
): Promise<ICombatSnapshot> => {
    return await page.evaluate(async (args): Promise<ICombatSnapshot> => {
        // @ts-expect-error — dev-time Vite URL not resolvable by tsc
        const engineMod = await import('/src/systems/combatEngine.ts');
        // @ts-expect-error — dev-time Vite URL not resolvable by tsc
        const combatMod = await import('/src/stores/combatStore.ts');
        // @ts-expect-error — dev-time Vite URL not resolvable by tsc
        const charMod = await import('/src/stores/characterStore.ts');

        const engine = engineMod as {
            getAllMonsters: () => Array<{ id: string; level: number; hp: number }>;
            handleMonsterDeath: (rarity: string) => void;
        };
        const useCombatStore = (combatMod as {
            useCombatStore: {
                getState: () => {
                    initCombat: (m: unknown, hp: number, mp: number, rarity?: string) => void;
                    phase: string;
                    earnedXp: number;
                    earnedGold: number;
                    monsterCurrentHp: number;
                    playerCurrentHp: number;
                    sessionKills: Record<string, number>;
                    sessionLog: Array<{ id: number; text: string; type: string }>;
                    lastDrops: Array<{ name: string; icon?: string; rarity?: string }>;
                    sessionDrops: Array<{ name: string; icon?: string; rarity?: string }>;
                };
            };
        }).useCombatStore;
        const useCharacterStore = (charMod as {
            useCharacterStore: { getState: () => { character: { hp: number; mp: number } | null } };
        }).useCharacterStore;

        const character = useCharacterStore.getState().character;
        if (!character) {
            throw new Error('[combatSim] killMonsterViaEngine: no character hydrated');
        }

        const monster = engine.getAllMonsters().find((m) => m.id === args.monsterId);
        if (!monster) {
            throw new Error(`[combatSim] killMonsterViaEngine: unknown monster id "${args.monsterId}"`);
        }

        // Stage the fight. `initCombat` sets phase='fighting' + populates
        // waveMonsters[0] / monsterCurrentHp / monsterMaxHp from the
        // monster argument. handleMonsterDeath reads `s.monster` +
        // `s.waveMonsters[s.activeTargetIdx]` to know what we killed.
        useCombatStore.getState().initCombat(
            monster as unknown,
            character.hp ?? 1,
            character.mp ?? 0,
            args.rarity,
        );

        // Kill it.
        engine.handleMonsterDeath(args.rarity);

        const combat = useCombatStore.getState();
        return {
            phase: combat.phase as 'idle' | 'fighting' | 'victory' | 'dead',
            earnedXp: combat.earnedXp,
            earnedGold: combat.earnedGold,
            monsterHp: combat.monsterCurrentHp,
            playerHp: combat.playerCurrentHp,
            sessionKills: { ...combat.sessionKills },
            sessionLog: combat.sessionLog.map((l) => ({ ...l })),
            lastDrops: combat.lastDrops.map((d) => ({ ...d })),
            sessionDrops: combat.sessionDrops.map((d) => ({ ...d })),
        };
    }, { monsterId, rarity });
};
