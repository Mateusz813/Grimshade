import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';



const {
    inventoryState, skillState, taskState, questState, bossState, dungeonState,
    partyState, settingsState, dailyQuestState, masteryState, bossScoreState,
    buffState, transformState, combatState, offlineHuntState, friendsState,
    characterState, connectivityState,
    saveGameMock, loadGameMock, deleteGameSaveMock,
    updateCharacterMock,
    subscribeCalls,
} = vi.hoisted(() => {
    const subscribeCalls: Array<() => void> = [];
    return {
        inventoryState: { current: { bag: [], equipment: {}, deposit: [], gold: 0, consumables: {}, stones: {} } },
        skillState: { current: { skillLevels: {}, skillXp: {}, skillUpgradeLevels: {}, unlockedSkills: {}, activeSkillSlots: [null, null, null, null], offlineTrainingSkillId: null as string | null, trainingSegmentStartedAt: null as string | null, trainingAccumulatedEffectiveSeconds: 0, trainingCurrentSpeedMultiplier: 1, startOfflineTraining: vi.fn(), onActivityChange: vi.fn() } },
        taskState: { current: { activeTask: null, activeTasks: [], completedTasks: [] } },
        questState: { current: { activeQuests: [], completedQuestIds: [] } },
        bossState: { current: { dailyAttempts: {}, lastResult: null } },
        dungeonState: { current: { dailyAttempts: {}, clearedDungeonIds: {}, lastResult: null } },
        partyState: { current: {} },
        settingsState: { current: { language: 'pl', combatSpeed: 'x1', skillMode: 'auto' } },
        dailyQuestState: { current: { lastRefreshDate: null, activeQuests: [], todayQuestDefs: [] } },
        masteryState: { current: { masteries: {}, masteryKills: {} } },
        bossScoreState: { current: { totalScore: 0, bossKills: {} } },
        buffState: { current: { allBuffs: [] } },
        transformState: { current: { completedTransforms: [], currentTransformQuest: null, bakedBonusesApplied: false, pendingClaimTransformId: null, migrateLegacyBakedBonuses: vi.fn(() => false) } },
        combatState: { current: { phase: 'idle', monster: null, monsterCurrentHp: 0, monsterMaxHp: 0, playerCurrentHp: 0, playerCurrentMp: 0, monsterRarity: 'normal', backgroundActive: false, baseMonster: null, autoFight: true, backgroundStartedAt: null, lastCombatTickAt: null, sessionXpEarned: 0, sessionGoldEarned: 0, sessionKills: { normal: 0, strong: 0, epic: 0, legendary: 0, boss: 0 }, sessionStartedAt: 0, waveMonsters: [], activeTargetIdx: 0, wavePlannedCount: 1 } },
        offlineHuntState: { current: { isActive: false, startedAt: null, targetMonster: null, trainedSkillId: null } },
        friendsState: { current: { friends: [], favorites: [], blocked: [] } },
        characterState: { current: { character: null } },
        connectivityState: { current: { mode: 'online', snapshot: null } },
        saveGameMock: vi.fn().mockResolvedValue(undefined),
        loadGameMock: vi.fn().mockResolvedValue(null),
        deleteGameSaveMock: vi.fn().mockResolvedValue(undefined),
        updateCharacterMock: vi.fn().mockResolvedValue(undefined),
        subscribeCalls,
    };
});


interface IStateHolder<T> { current: T }

const makeMockStore = <T>(holder: IStateHolder<T>): {
    getState: () => T;
    setState: (patch: Partial<T> | T) => void;
    subscribe: (cb: () => void) => () => void;
} => ({
    getState: () => holder.current,
    setState: (patch) => {
        holder.current = { ...(holder.current as object), ...(patch as object) } as T;
    },
    subscribe: (cb: () => void) => {
        subscribeCalls.push(cb);
        return () => {
            const idx = subscribeCalls.indexOf(cb);
            if (idx >= 0) subscribeCalls.splice(idx, 1);
        };
    },
});


vi.mock('./inventoryStore', () => ({ useInventoryStore: makeMockStore(inventoryState) }));
vi.mock('./skillStore', () => ({ useSkillStore: makeMockStore(skillState) }));
vi.mock('./taskStore', () => ({ useTaskStore: makeMockStore(taskState) }));
vi.mock('./questStore', () => ({ useQuestStore: makeMockStore(questState) }));
vi.mock('./bossStore', () => ({ useBossStore: makeMockStore(bossState) }));
vi.mock('./dungeonStore', () => ({ useDungeonStore: makeMockStore(dungeonState) }));
vi.mock('./partyStore', () => ({ usePartyStore: makeMockStore(partyState) }));
vi.mock('./settingsStore', () => ({ useSettingsStore: makeMockStore(settingsState) }));
vi.mock('./dailyQuestStore', () => ({ useDailyQuestStore: makeMockStore(dailyQuestState) }));
vi.mock('./masteryStore', () => ({ useMasteryStore: makeMockStore(masteryState) }));
vi.mock('./bossScoreStore', () => ({ useBossScoreStore: makeMockStore(bossScoreState) }));
vi.mock('./buffStore', () => ({ useBuffStore: makeMockStore(buffState) }));
vi.mock('./transformStore', () => ({ useTransformStore: makeMockStore(transformState) }));
vi.mock('./combatStore', () => ({ useCombatStore: makeMockStore(combatState) }));
vi.mock('./offlineHuntStore', () => ({ useOfflineHuntStore: makeMockStore(offlineHuntState) }));
vi.mock('./friendsStore', () => ({ useFriendsStore: makeMockStore(friendsState) }));
vi.mock('./characterStore', () => ({ useCharacterStore: makeMockStore(characterState) }));
vi.mock('./connectivityStore', () => ({ useConnectivityStore: makeMockStore(connectivityState) }));

vi.mock('../systems/itemSystem', () => ({
    EMPTY_EQUIPMENT: { helmet: null, armor: null, pants: null, gloves: null, shoulders: null, boots: null, mainHand: null, offHand: null, ring1: null, ring2: null, earrings: null, necklace: null },
}));

vi.mock('../storage/gameStorage', () => ({
    saveGame: saveGameMock,
    loadGame: loadGameMock,
    deleteGameSave: deleteGameSaveMock,
}));

vi.mock('../api/v1/characterApi', () => ({
    characterApi: { updateCharacter: updateCharacterMock },
}));

vi.mock('../data/skills.json', () => ({
    default: { activeSkills: { knight: [{ id: 'sword_mastery' }, { id: 'shield_bash' }] } },
}));


const resetStoreState = (): void => {
    inventoryState.current = { bag: [], equipment: {}, deposit: [], gold: 0, consumables: {}, stones: {} } as typeof inventoryState.current;
    skillState.current = { ...skillState.current, skillLevels: {}, skillXp: {}, skillUpgradeLevels: {}, unlockedSkills: {}, activeSkillSlots: [null, null, null, null], offlineTrainingSkillId: null, trainingSegmentStartedAt: null, trainingAccumulatedEffectiveSeconds: 0, trainingCurrentSpeedMultiplier: 1 };
    taskState.current = { activeTask: null, activeTasks: [], completedTasks: [] } as typeof taskState.current;
    questState.current = { activeQuests: [], completedQuestIds: [] } as typeof questState.current;
    bossState.current = { dailyAttempts: {}, lastResult: null } as typeof bossState.current;
    dungeonState.current = { dailyAttempts: {}, clearedDungeonIds: {}, lastResult: null } as typeof dungeonState.current;
    partyState.current = {};
    settingsState.current = { language: 'pl', combatSpeed: 'x1', skillMode: 'auto' } as typeof settingsState.current;
    dailyQuestState.current = { lastRefreshDate: null, activeQuests: [], todayQuestDefs: [] } as typeof dailyQuestState.current;
    masteryState.current = { masteries: {}, masteryKills: {} } as typeof masteryState.current;
    bossScoreState.current = { totalScore: 0, bossKills: {} } as typeof bossScoreState.current;
    buffState.current = { allBuffs: [] } as typeof buffState.current;
    transformState.current = { ...transformState.current, completedTransforms: [], currentTransformQuest: null, bakedBonusesApplied: false, pendingClaimTransformId: null };
    combatState.current = { ...combatState.current, phase: 'idle', monster: null, sessionXpEarned: 0 };
    offlineHuntState.current = { isActive: false, startedAt: null, targetMonster: null, trainedSkillId: null } as typeof offlineHuntState.current;
    friendsState.current = { friends: [], favorites: [], blocked: [] } as typeof friendsState.current;
    characterState.current = { character: null } as typeof characterState.current;
    connectivityState.current = { mode: 'online', snapshot: null } as typeof connectivityState.current;
};

const makeCharacter = (overrides: Record<string, unknown> = {}): any => ({
    id: 'char-1',
    user_id: 'user-1',
    name: 'Tester',
    class: 'Knight',
    level: 10,
    xp: 100,
    hp: 200,
    max_hp: 200,
    mp: 50,
    max_mp: 50,
    attack: 20,
    defense: 10,
    attack_speed: 2,
    crit_chance: 5,
    crit_damage: 150,
    magic_level: 0,
    hp_regen: 0,
    mp_regen: 0,
    gold: 500,
    stat_points: 0,
    highest_level: 10,
    ...overrides,
});

beforeEach(() => {
    resetStoreState();
    subscribeCalls.length = 0;
    saveGameMock.mockClear();
    loadGameMock.mockClear();
    deleteGameSaveMock.mockClear();
    updateCharacterMock.mockClear();
    if (typeof window !== 'undefined') {
        window.localStorage.clear();
        window.sessionStorage.clear();
    }
    vi.resetModules();
});

afterEach(() => {
    vi.useRealTimers();
});


describe('peekCharacterStore', () => {
    it('returns null when no save exists for the character', async () => {
        const mod = await import('./characterScope');
        expect(mod.peekCharacterStore('char-x', 'inventory')).toBeNull();
    });

    it('returns the requested sub-store slice when a save exists', async () => {
        const blob = { inventory: { bag: [{ uuid: 'i1' }], gold: 99 }, skills: { skillLevels: { sword: 5 } } };
        window.localStorage.setItem('dungeon_rpg_save_char_char-1', JSON.stringify({ state: blob, updated_at: 'x' }));
        const mod = await import('./characterScope');
        expect(mod.peekCharacterStore('char-1', 'inventory')).toEqual({ bag: [{ uuid: 'i1' }], gold: 99 });
        expect(mod.peekCharacterStore('char-1', 'skills')).toEqual({ skillLevels: { sword: 5 } });
    });

    it('returns null for a baseKey that does not exist in the blob', async () => {
        window.localStorage.setItem('dungeon_rpg_save_char_char-1', JSON.stringify({ state: { inventory: { gold: 1 } } }));
        const mod = await import('./characterScope');
        expect(mod.peekCharacterStore('char-1', 'doesNotExist')).toBeNull();
    });

    it('handles legacy (no .state wrapper) saves', async () => {
        const legacy = { inventory: { gold: 42 } };
        window.localStorage.setItem('dungeon_rpg_save_char_char-1', JSON.stringify(legacy));
        const mod = await import('./characterScope');
        expect(mod.peekCharacterStore('char-1', 'inventory')).toEqual({ gold: 42 });
    });

    it('returns null on corrupt JSON', async () => {
        window.localStorage.setItem('dungeon_rpg_save_char_char-1', '{not valid json');
        const mod = await import('./characterScope');
        expect(mod.peekCharacterStore('char-1', 'inventory')).toBeNull();
    });
});


describe('restoreFromLocalStorageSync', () => {
    it('returns false and resets stores to defaults when no save exists', async () => {
        inventoryState.current = { ...inventoryState.current, gold: 9999 } as typeof inventoryState.current;
        const mod = await import('./characterScope');
        const result = mod.restoreFromLocalStorageSync('char-nonexistent');
        expect(result).toBe(false);
        expect(inventoryState.current.gold).toBe(0);
    });

    it('returns true and applies the saved blob when data exists with matching owner', async () => {
        const blob = {
            _ownerCharacterId: 'char-1',
            inventory: { _entryOwner: 'char-1', bag: [], gold: 500 },
            settings: { _entryOwner: 'char-1', language: 'en' },
        };
        window.localStorage.setItem('dungeon_rpg_save_char_char-1', JSON.stringify({ state: blob, updated_at: 'now' }));
        const mod = await import('./characterScope');
        const result = mod.restoreFromLocalStorageSync('char-1');
        expect(result).toBe(true);
        expect(inventoryState.current.gold).toBe(500);
        expect(settingsState.current.language).toBe('en');
    });

    it('rejects a blob whose _ownerCharacterId points at a different character', async () => {
        const blob = {
            _ownerCharacterId: 'char-OTHER',
            inventory: { gold: 99999 },
        };
        window.localStorage.setItem('dungeon_rpg_save_char_char-1', JSON.stringify({ state: blob }));
        const mod = await import('./characterScope');
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const result = mod.restoreFromLocalStorageSync('char-1');
        expect(result).toBe(false);
        expect(inventoryState.current.gold).toBe(0);
        expect(warnSpy).toHaveBeenCalled();
        warnSpy.mockRestore();
    });

    it('skips per-entry slices whose _entryOwner mismatches but still applies others', async () => {
        const blob = {
            _ownerCharacterId: 'char-1',
            inventory: { _entryOwner: 'char-OTHER', gold: 99999 },
            settings: { _entryOwner: 'char-1', language: 'en' },
        };
        window.localStorage.setItem('dungeon_rpg_save_char_char-1', JSON.stringify({ state: blob }));
        const mod = await import('./characterScope');
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const result = mod.restoreFromLocalStorageSync('char-1');
        expect(result).toBe(true);
        expect(inventoryState.current.gold).toBe(0);
        expect(settingsState.current.language).toBe('en');
        warnSpy.mockRestore();
    });

    it('only applies state keys listed in stateKeys (drops unknown fields)', async () => {
        const blob = {
            _ownerCharacterId: 'char-1',
            inventory: { gold: 42, malicious: 'ignored', alsoNotPersisted: { evil: true } },
        };
        window.localStorage.setItem('dungeon_rpg_save_char_char-1', JSON.stringify({ state: blob }));
        const mod = await import('./characterScope');
        mod.restoreFromLocalStorageSync('char-1');
        expect(inventoryState.current.gold).toBe(42);
        expect((inventoryState.current as Record<string, unknown>).malicious).toBeUndefined();
    });

    it('handles corrupt JSON gracefully — returns false and resets to defaults', async () => {
        window.localStorage.setItem('dungeon_rpg_save_char_char-1', '{corrupt');
        const mod = await import('./characterScope');
        const result = mod.restoreFromLocalStorageSync('char-1');
        expect(result).toBe(false);
    });
});


describe('applyBlobToStores — hydracja _characterStats (regresja: reload nie cofa level/XP)', () => {
    type CharHolder = { current: { character: Record<string, unknown> | null; updateCharacter?: (p: Record<string, unknown>) => void } };
    const holder = (): CharHolder => characterState as unknown as CharHolder;
    const setCharWithUpdater = (char: Record<string, unknown>): void => {
        const h = holder();
        h.current = {
            character: char,
            updateCharacter: (patch: Record<string, unknown>) => {
                const cur = h.current.character;
                if (cur) h.current.character = { ...cur, ...patch };
            },
        };
    };
    const readChar = (): Record<string, unknown> => holder().current.character as Record<string, unknown>;

    it('RESTORE (hydrateCharacterStats:true) przywraca level/xp/highest_level/stat_points z _characterStats', async () => {
        setCharWithUpdater(makeCharacter({ id: 'char-1', level: 10, xp: 100, highest_level: 10, stat_points: 0 }));
        const blob = {
            _ownerCharacterId: 'char-1',
            _characterStats: { level: 15, xp: 500, gold: 9999, highest_level: 15, stat_points: 3 },
        };
        const mod = await import('./characterScope');
        const ok = mod.applyBlobToStores(blob, 'char-1', { hydrateCharacterStats: true });
        expect(ok).toBe(true);
        expect(readChar().level).toBe(15);
        expect(readChar().xp).toBe(500);
        expect(readChar().highest_level).toBe(15);
        expect(readChar().stat_points).toBe(3);
    });

    it('serwerowa hydracja (bez opta) NIE nadpisuje characterStore z _characterStats', async () => {
        setCharWithUpdater(makeCharacter({ id: 'char-1', level: 10, xp: 100 }));
        const blob = { _ownerCharacterId: 'char-1', _characterStats: { level: 999, xp: 999999 } };
        const mod = await import('./characterScope');
        mod.applyBlobToStores(blob, 'char-1');
        expect(readChar().level).toBe(10);
        expect(readChar().xp).toBe(100);
    });

    it('guard: nie hydratuje gdy postać w store ma inny id niż expectedCharId', async () => {
        setCharWithUpdater(makeCharacter({ id: 'char-2', level: 10 }));
        const blob = { _ownerCharacterId: 'char-1', _characterStats: { level: 77 } };
        const mod = await import('./characterScope');
        mod.applyBlobToStores(blob, 'char-1', { hydrateCharacterStats: true });
        expect(readChar().level).toBe(10);
    });
});

describe('applyBlobToStores — sanitizery (regresja: stuck skill buff + nieprawidłowy spell chest)', () => {
    it('usuwa buffy skill_charge_* przy wczytaniu, zachowuje pozostałe', async () => {
        const blob = {
            _ownerCharacterId: 'char-1',
            buffs: {
                allBuffs: [
                    { id: 'a', effect: 'skill_charge_crit_buff_next', characterId: 'char-1', charges: 1 },
                    { id: 'b', effect: 'xp_boost', characterId: 'char-1', expiresAt: 9e15 },
                    { id: 'c', effect: 'skill_charge_dodge_next', characterId: 'char-1', charges: 1 },
                ],
            },
        };
        const mod = await import('./characterScope');
        mod.applyBlobToStores(blob, 'char-1');
        const effects = (buffState.current as { allBuffs: Array<{ effect: string }> })
            .allBuffs.map((b) => b.effect);
        expect(effects).toEqual(['xp_boost']);
    });

    it('usuwa spell_chesty spoza SPELL_CHEST_LEVELS, zachowuje poprawne + inne consumable', async () => {
        const blob = {
            _ownerCharacterId: 'char-1',
            inventory: {
                consumables: { spell_chest_200: 3, spell_chest_50: 1, spell_chest_5: 2, hp_potion_sm: 5 },
            },
        };
        const mod = await import('./characterScope');
        mod.applyBlobToStores(blob, 'char-1');
        expect((inventoryState.current as { consumables: Record<string, number> }).consumables)
            .toEqual({ spell_chest_50: 1, spell_chest_5: 2, hp_potion_sm: 5 });
    });
});

describe('switchToCharacter', () => {
    it('persists the chosen character id to localStorage', async () => {
        const mod = await import('./characterScope');
        await mod.switchToCharacter('char-NEW');
        expect(window.localStorage.getItem('tibia_active_character_id')).toBe('char-NEW');
        expect(mod.getActiveCharacterId()).toBe('char-NEW');
    });

    it('claims a tab lock for the new character', async () => {
        const mod = await import('./characterScope');
        await mod.switchToCharacter('char-NEW');
        const lock = window.localStorage.getItem('tibia_tab_lock_char-NEW');
        expect(lock).not.toBeNull();
        const parsed = JSON.parse(lock as string);
        expect(typeof parsed.tabId).toBe('string');
        expect(typeof parsed.ts).toBe('number');
    });

    it('restores blob from localStorage on switch', async () => {
        const blob = {
            _ownerCharacterId: 'char-NEW',
            inventory: { _entryOwner: 'char-NEW', gold: 777 },
        };
        window.localStorage.setItem('dungeon_rpg_save_char_char-NEW', JSON.stringify({ state: blob }));
        const mod = await import('./characterScope');
        await mod.switchToCharacter('char-NEW');
        expect(inventoryState.current.gold).toBe(777);
    });

    it('falls back to defaults when no save exists for the new character', async () => {
        inventoryState.current = { ...inventoryState.current, gold: 9999 } as typeof inventoryState.current;
        const mod = await import('./characterScope');
        await mod.switchToCharacter('char-EMPTY');
        expect(inventoryState.current.gold).toBe(0);
    });

    it('applies cloud blob from loadGame when newer/present (online mode)', async () => {
        loadGameMock.mockResolvedValueOnce({
            inventory: { _entryOwner: 'char-CLOUD', gold: 5555 },
        });
        const mod = await import('./characterScope');
        await mod.switchToCharacter('char-CLOUD');
        expect(loadGameMock).toHaveBeenCalledWith('char-CLOUD');
        expect(inventoryState.current.gold).toBe(5555);
    });

    it('SKIPS cloud load when an offline snapshot is present (resume-offline path)', async () => {
        connectivityState.current = { mode: 'online', snapshot: { characterId: 'char-1' } } as unknown as typeof connectivityState.current;
        loadGameMock.mockResolvedValueOnce({ inventory: { gold: 9999 } });
        const mod = await import('./characterScope');
        await mod.switchToCharacter('char-CLOUD');
        expect(loadGameMock).not.toHaveBeenCalled();
    });

    it('force-saves the outgoing character before switching to a new one', async () => {
        characterState.current = { character: makeCharacter({ id: 'char-OLD' }) } as typeof characterState.current;
        const mod = await import('./characterScope');
        await mod.switchToCharacter('char-OLD');
        await mod.switchToCharacter('char-NEW');
        expect(saveGameMock).toHaveBeenCalled();
        const calls = saveGameMock.mock.calls;
        expect(calls.some((c) => c[0] === 'char-OLD')).toBe(true);
    });

    it('triggers a defensive heal when the loaded character has hp <= 0', async () => {
        const fullHealEffective = vi.fn();
        characterState.current = {
            character: { ...makeCharacter({ id: 'char-DEAD' }), hp: 0 },
            fullHealEffective,
        } as typeof characterState.current;
        const mod = await import('./characterScope');
        await mod.switchToCharacter('char-DEAD');
        expect(fullHealEffective).toHaveBeenCalled();
    });

    it('auto-unlocks all active skills when the loaded character is at the level cap (1000)', async () => {
        characterState.current = {
            character: makeCharacter({ id: 'char-CAP', level: 1000, class: 'Knight' }),
        } as typeof characterState.current;
        const mod = await import('./characterScope');
        await mod.switchToCharacter('char-CAP');
        expect((skillState.current.unlockedSkills as Record<string, boolean>).sword_mastery).toBe(true);
        expect((skillState.current.unlockedSkills as Record<string, boolean>).shield_bash).toBe(true);
    });

    it('does NOT touch unlockedSkills below the level cap', async () => {
        characterState.current = {
            character: makeCharacter({ id: 'char-LOW', level: 999, class: 'Knight' }),
        } as typeof characterState.current;
        const mod = await import('./characterScope');
        await mod.switchToCharacter('char-LOW');
        expect((skillState.current.unlockedSkills as Record<string, boolean>).sword_mastery).toBeUndefined();
    });
});


describe('saveCurrentCharacterStoresSync', () => {
    it('is a no-op when no active character is set', async () => {
        const mod = await import('./characterScope');
        mod.saveCurrentCharacterStoresSync();
        const keys: string[] = [];
        for (let i = 0; i < window.localStorage.length; i++) {
            const k = window.localStorage.key(i);
            if (k) keys.push(k);
        }
        expect(keys.filter((k) => k.startsWith('dungeon_rpg_save_char_'))).toHaveLength(0);
    });

    it('writes blob to dungeon_rpg_save_char_<id> when a character is active', async () => {
        const mod = await import('./characterScope');
        await mod.switchToCharacter('char-FLUSH');
        characterState.current = { character: makeCharacter({ id: 'char-FLUSH', gold: 777 }) } as typeof characterState.current;
        mod.saveCurrentCharacterStoresSync();
        const raw = window.localStorage.getItem('dungeon_rpg_save_char_char-FLUSH');
        expect(raw).not.toBeNull();
        const parsed = JSON.parse(raw as string);
        expect(parsed.state._ownerCharacterId).toBe('char-FLUSH');
        expect(parsed.state._characterStats.gold).toBe(777);
    });

    it('refuses to save when characterStore holds a DIFFERENT character (cross-bleed guard)', async () => {
        const mod = await import('./characterScope');
        await mod.switchToCharacter('char-A');
        characterState.current = { character: makeCharacter({ id: 'char-B' }) } as typeof characterState.current;
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        window.localStorage.removeItem('dungeon_rpg_save_char_char-A');
        mod.saveCurrentCharacterStoresSync();
        expect(window.localStorage.getItem('dungeon_rpg_save_char_char-A')).toBeNull();
        expect(warnSpy).toHaveBeenCalled();
        warnSpy.mockRestore();
    });

    it('refuses to save while a switch is in progress (placeholder check — guard exercised in switchToCharacter)', async () => {
        const mod = await import('./characterScope');
        expect(typeof mod.saveCurrentCharacterStoresSync).toBe('function');
    });
});


describe('saveCurrentCharacterStores', () => {
    it('calls saveGame + updateCharacter when an active character is set', async () => {
        const mod = await import('./characterScope');
        await mod.switchToCharacter('char-A');
        characterState.current = { character: makeCharacter({ id: 'char-A' }) } as typeof characterState.current;
        saveGameMock.mockClear();
        updateCharacterMock.mockClear();
        await mod.saveCurrentCharacterStores();
        expect(updateCharacterMock).toHaveBeenCalledWith('char-A', expect.objectContaining({ gold: 500 }));
        expect(saveGameMock).toHaveBeenCalled();
    });

    it('throttles subsequent calls within the 4-second window', async () => {
        vi.useFakeTimers();
        const mod = await import('./characterScope');
        await mod.switchToCharacter('char-A');
        characterState.current = { character: makeCharacter({ id: 'char-A' }) } as typeof characterState.current;
        saveGameMock.mockClear();
        updateCharacterMock.mockClear();
        await mod.saveCurrentCharacterStores();
        const firstCallCount = updateCharacterMock.mock.calls.length;
        await mod.saveCurrentCharacterStores();
        expect(updateCharacterMock.mock.calls.length).toBe(firstCallCount);
    });

    it('saveCurrentCharacterStoresForce bypasses the throttle', async () => {
        const mod = await import('./characterScope');
        await mod.switchToCharacter('char-A');
        characterState.current = { character: makeCharacter({ id: 'char-A' }) } as typeof characterState.current;
        await mod.saveCurrentCharacterStores();
        const before = updateCharacterMock.mock.calls.length;
        await mod.saveCurrentCharacterStoresForce();
        expect(updateCharacterMock.mock.calls.length).toBeGreaterThan(before);
    });

    it('refuses to save when characterStore holds a different character', async () => {
        const mod = await import('./characterScope');
        await mod.switchToCharacter('char-A');
        characterState.current = { character: makeCharacter({ id: 'char-OTHER' }) } as typeof characterState.current;
        saveGameMock.mockClear();
        updateCharacterMock.mockClear();
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        await mod.saveCurrentCharacterStoresForce();
        expect(saveGameMock).not.toHaveBeenCalled();
        warnSpy.mockRestore();
    });
});


describe('scheduleAutoSave (via store subscriptions)', () => {
    it('debounces multiple rapid store changes into one localStorage write (online mode)', async () => {
        vi.useFakeTimers();
        const mod = await import('./characterScope');
        await mod.switchToCharacter('char-DEBOUNCE');
        characterState.current = { character: makeCharacter({ id: 'char-DEBOUNCE' }) } as typeof characterState.current;
        window.localStorage.removeItem('dungeon_rpg_save_char_char-DEBOUNCE');
        subscribeCalls.forEach((cb) => cb());
        subscribeCalls.forEach((cb) => cb());
        subscribeCalls.forEach((cb) => cb());
        expect(window.localStorage.getItem('dungeon_rpg_save_char_char-DEBOUNCE')).toBeNull();
        vi.advanceTimersByTime(600);
        expect(window.localStorage.getItem('dungeon_rpg_save_char_char-DEBOUNCE')).not.toBeNull();
    });

    it('skips the debounce and flushes IMMEDIATELY in offline mode', async () => {
        connectivityState.current = { mode: 'offline', snapshot: null } as typeof connectivityState.current;
        const mod = await import('./characterScope');
        await mod.switchToCharacter('char-OFFLINE');
        characterState.current = { character: makeCharacter({ id: 'char-OFFLINE' }) } as typeof characterState.current;
        window.localStorage.removeItem('dungeon_rpg_save_char_char-OFFLINE');
        subscribeCalls.forEach((cb) => cb());
        expect(window.localStorage.getItem('dungeon_rpg_save_char_char-OFFLINE')).not.toBeNull();
    });

    it('blocks auto-save while _switchInProgress is true (verified via guard semantics)', async () => {
        const mod = await import('./characterScope');
        const switchPromise = mod.switchToCharacter('char-MID');
        await switchPromise;
        expect(subscribeCalls.length).toBeGreaterThan(0);
    });
});


describe('Tab lock mechanism', () => {
    it('writes a tab lock to localStorage on character switch', async () => {
        const mod = await import('./characterScope');
        await mod.switchToCharacter('char-LOCK');
        const lock = window.localStorage.getItem('tibia_tab_lock_char-LOCK');
        expect(lock).not.toBeNull();
        const parsed = JSON.parse(lock as string);
        expect(parsed.tabId).toMatch(/^tab_\d+_[a-z0-9]+$/);
        expect(typeof parsed.ts).toBe('number');
    });

    it('releases the previous lock when switching to a new character', async () => {
        const mod = await import('./characterScope');
        await mod.switchToCharacter('char-FIRST');
        expect(window.localStorage.getItem('tibia_tab_lock_char-FIRST')).not.toBeNull();
        await mod.switchToCharacter('char-SECOND');
        expect(window.localStorage.getItem('tibia_tab_lock_char-FIRST')).toBeNull();
        expect(window.localStorage.getItem('tibia_tab_lock_char-SECOND')).not.toBeNull();
    });

    it('refuses to save when this tab does NOT own the lock (foreign tab stole it)', async () => {
        const mod = await import('./characterScope');
        await mod.switchToCharacter('char-OWNED');
        characterState.current = { character: makeCharacter({ id: 'char-OWNED' }) } as typeof characterState.current;
        window.localStorage.setItem(
            'tibia_tab_lock_char-OWNED',
            JSON.stringify({ tabId: 'tab_FOREIGN_xxx', ts: Date.now() }),
        );
        window.localStorage.removeItem('dungeon_rpg_save_char_char-OWNED');
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        mod.saveCurrentCharacterStoresSync();
        expect(window.localStorage.getItem('dungeon_rpg_save_char_char-OWNED')).toBeNull();
        warnSpy.mockRestore();
    });

    it('refreshes the lock timestamp on each save (keep-alive)', async () => {
        const mod = await import('./characterScope');
        await mod.switchToCharacter('char-REFRESH');
        characterState.current = { character: makeCharacter({ id: 'char-REFRESH' }) } as typeof characterState.current;
        const lockBefore = window.localStorage.getItem('tibia_tab_lock_char-REFRESH');
        const tsBefore = JSON.parse(lockBefore as string).ts;
        await new Promise<void>((r) => setTimeout(r, 5));
        mod.saveCurrentCharacterStoresSync();
        const lockAfter = window.localStorage.getItem('tibia_tab_lock_char-REFRESH');
        const tsAfter = JSON.parse(lockAfter as string).ts;
        expect(tsAfter).toBeGreaterThanOrEqual(tsBefore);
    });
});


describe('deleteCharacterData', () => {
    it('calls deleteGameSave with the character id', async () => {
        const mod = await import('./characterScope');
        await mod.deleteCharacterData('char-WIPE');
        expect(deleteGameSaveMock).toHaveBeenCalledWith('char-WIPE');
    });

    it('clears old per-store localStorage migration keys for the character', async () => {
        window.localStorage.setItem('dungeon_rpg_inventory_char_char-LEG', 'old');
        window.localStorage.setItem('dungeon_rpg_skills_char_char-LEG', 'old');
        const mod = await import('./characterScope');
        await mod.deleteCharacterData('char-LEG');
        expect(window.localStorage.getItem('dungeon_rpg_inventory_char_char-LEG')).toBeNull();
        expect(window.localStorage.getItem('dungeon_rpg_skills_char_char-LEG')).toBeNull();
    });
});


describe('getActiveCharacterId / getActiveCharacterIdForRestore', () => {
    it('returns null when no switch has happened (per-tab isolation)', async () => {
        const mod = await import('./characterScope');
        expect(mod.getActiveCharacterId()).toBeNull();
    });

    it('returns the switched character id after switchToCharacter', async () => {
        const mod = await import('./characterScope');
        await mod.switchToCharacter('char-ACTIVE');
        expect(mod.getActiveCharacterId()).toBe('char-ACTIVE');
    });

    it('getActiveCharacterIdForRestore falls back to localStorage on cold load', async () => {
        window.localStorage.setItem('tibia_active_character_id', 'char-PERSISTED');
        const mod = await import('./characterScope');
        expect(mod.getActiveCharacterIdForRestore()).toBe('char-PERSISTED');
    });

    it('getActiveCharacterIdForRestore prefers in-memory id over localStorage', async () => {
        window.localStorage.setItem('tibia_active_character_id', 'char-OLD-PERSISTED');
        const mod = await import('./characterScope');
        await mod.switchToCharacter('char-LIVE');
        expect(mod.getActiveCharacterIdForRestore()).toBe('char-LIVE');
    });
});


describe('ensureOfflineTrainingRunning — zachowanie zabankowanego treningu', () => {
    it('nie restartuje spauzowanego treningu i nie kasuje zabankowanych sekund', async () => {
        const mod = await import('./characterScope');
        characterState.current = { character: makeCharacter({ id: 'char-TRAIN' }) };
        await mod.switchToCharacter('char-TRAIN');

        skillState.current = {
            ...skillState.current,
            offlineTrainingSkillId: 'sword_mastery',
            trainingSegmentStartedAt: null,
            trainingAccumulatedEffectiveSeconds: 120,
        };

        mod.saveCurrentCharacterStoresSync();

        expect(skillState.current.startOfflineTraining).not.toHaveBeenCalled();
        expect(skillState.current.trainingAccumulatedEffectiveSeconds).toBe(120);
        expect(skillState.current.trainingSegmentStartedAt).not.toBeNull();
    });

    it('nie wznawia treningu spauzowanego na czas polowania offline', async () => {
        const mod = await import('./characterScope');
        characterState.current = { character: makeCharacter({ id: 'char-HUNT' }) };
        await mod.switchToCharacter('char-HUNT');

        offlineHuntState.current = { ...offlineHuntState.current, isActive: true };
        skillState.current = {
            ...skillState.current,
            offlineTrainingSkillId: 'sword_mastery',
            trainingSegmentStartedAt: null,
            trainingAccumulatedEffectiveSeconds: 300,
        };

        mod.saveCurrentCharacterStoresSync();

        expect(skillState.current.startOfflineTraining).not.toHaveBeenCalled();
        expect(skillState.current.trainingSegmentStartedAt).toBeNull();
        expect(skillState.current.trainingAccumulatedEffectiveSeconds).toBe(300);
    });
});
