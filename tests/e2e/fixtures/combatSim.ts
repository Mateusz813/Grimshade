
import { type Page, expect } from '@playwright/test';

export interface ICombatSnapshot {
    phase: 'idle' | 'fighting' | 'victory' | 'dead';
    earnedXp: number;
    earnedGold: number;
    monsterHp: number;
    playerHp: number;
    sessionKills: Record<string, number>;
    sessionLog: Array<{ id: number; text: string; type: string }>;
    lastDrops: Array<{ name: string; icon?: string; rarity?: string }>;
    sessionDrops: Array<{ name: string; icon?: string; rarity?: string }>;
}

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

export const getCombatSnapshot = async (page: Page): Promise<ICombatSnapshot | null> => {
    return await page.evaluate(async () => {
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
            sessionKills: { ...combat.sessionKills },
            sessionLog: combat.sessionLog.map((l) => ({ ...l })),
            lastDrops: combat.lastDrops.map((d) => ({ ...d })),
            sessionDrops: combat.sessionDrops.map((d) => ({ ...d })),
        };
    });
};

export const getCharacterSnapshot = async (page: Page): Promise<ICharacterSnapshot | null> => {
    return await page.evaluate(async () => {
        const charMod = await import('/src/stores/characterStore.ts');
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

export const runCombatViaSkip = async (
    page: Page,
    monsterId: string = 'rat',
): Promise<ICombatSnapshot> => {
    const result = await page.evaluate(async (mId): Promise<ICombatSnapshot> => {
        const settingsMod = await import('/src/stores/settingsStore.ts');
        const engineMod = await import('/src/systems/combatEngine.ts');
        const combatMod = await import('/src/stores/combatStore.ts');
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

        const monster = engine.getAllMonsters().find((m) => m.id === mId);
        if (!monster) {
            throw new Error(`[combatSim] runCombatViaSkip: unknown monster id "${mId}"`);
        }
        const previousSpeed = useSettingsStore.getState().combatSpeed;
        useSettingsStore.getState().setCombatSpeed('SKIP');

        try {
            engine.startNewFight(monster as unknown, true);
        } finally {
            useSettingsStore.getState().setCombatSpeed(previousSpeed);
        }

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

export const triggerPlayerDeath = async (
    page: Page,
    monsterId: string = 'rat',
): Promise<void> => {
    await page.evaluate(async (mId) => {
        const engineMod = await import('/src/systems/combatEngine.ts');
        const combatMod = await import('/src/stores/combatStore.ts');
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

        useCombatStore.getState().initCombat(monster, 1, character.mp ?? 0, 'normal');
        engine.handlePlayerDeath(true);
    }, monsterId);
};

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

export const forceSaveAfterCombat = async (page: Page): Promise<void> => {
    await page.evaluate(async () => {
        const mod = await import('/src/stores/characterScope.ts');
        await (mod as { saveCurrentCharacterStoresForce: () => Promise<void> })
            .saveCurrentCharacterStoresForce();
    });
};

export const killMonsterViaEngine = async (
    page: Page,
    monsterId: string = 'rat',
    rarity: 'normal' | 'strong' | 'epic' | 'legendary' | 'boss' = 'normal',
): Promise<ICombatSnapshot> => {
    return await page.evaluate(async (args): Promise<ICombatSnapshot> => {
        const engineMod = await import('/src/systems/combatEngine.ts');
        const combatMod = await import('/src/stores/combatStore.ts');
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

        useCombatStore.getState().initCombat(
            monster as unknown,
            character.hp ?? 1,
            character.mp ?? 0,
            args.rarity,
        );

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
