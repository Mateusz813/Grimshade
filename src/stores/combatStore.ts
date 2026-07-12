import { create } from 'zustand';
import type { TMonsterRarity } from '../systems/lootSystem';
import type { IMonster } from '../types/monster';
import type { IDropDisplay, ICombatEvent } from '../systems/combatEngine';

export type CombatPhase = 'idle' | 'fighting' | 'victory' | 'dead';

export type { IMonster };

export const MAX_WAVE_MONSTERS = 4;

export interface IWaveMonster {
    monster: IMonster;
    currentHp: number;
    maxHp: number;
    rarity: TMonsterRarity;
    isDead: boolean;
    aggroTarget: string | null;
}

export interface ICombatLogEntry {
    id: number;
    text: string;
    type: 'player' | 'monster' | 'crit' | 'system' | 'loot' | 'block' | 'dodge' | 'dualwield';
}

interface ICombatStore {
    phase: CombatPhase;
    monster: IMonster | null;
    monsterCurrentHp: number;
    monsterMaxHp: number;
    playerCurrentHp: number;
    playerCurrentMp: number;
    log: ICombatLogEntry[];
    earnedXp: number;
    earnedGold: number;
    selectedMonster: IMonster | null;
    monsterRarity: TMonsterRarity;

    backgroundActive: boolean;
    baseMonster: IMonster | null;
    autoFight: boolean;
    backgroundStartedAt: string | null;
    sessionXpEarned: number;
    sessionGoldEarned: number;
    sessionKills: Record<string, number>;
    sessionStartedAt: number;
    lastCombatEvent: ICombatEvent | null;
    lastDrops: IDropDisplay[];
    sessionDrops: IDropDisplay[];
    sessionXpPerHour: number;
    lastCombatTickAt: string | null;
    sessionLog: ICombatLogEntry[];

    waveMonsters: IWaveMonster[];
    activeTargetIdx: number;
    wavePlannedCount: number;

    initCombat:        (monster: IMonster, playerHp: number, playerMp: number, rarity?: TMonsterRarity) => void;
    setSelectedMonster:(monster: IMonster | null) => void;
    dealToMonster:(dmg: number) => void;
    dealToPlayer: (dmg: number) => void;
    addLog:       (text: string, type: ICombatLogEntry['type']) => void;
    bulkAddLog:   (entries: Array<Pick<ICombatLogEntry, 'text' | 'type'>>) => void;
    addReward:    (xp: number, gold: number) => void;
    setPhase:     (phase: CombatPhase) => void;
    setHps:       (monsterHp: number, playerHp: number) => void;
    healPlayerHp: (amount: number, maxHp: number) => void;
    healPlayerMp: (amount: number, maxMp: number) => void;
    spendPlayerMp:(cost: number) => void;
    resetCombat:  () => void;

    setBackgroundActive: (active: boolean) => void;
    setBaseMonster: (m: IMonster | null) => void;
    setAutoFight: (on: boolean) => void;
    setBackgroundStartedAt: (ts: string | null) => void;
    addSessionStats: (xp: number, gold: number) => void;
    incrementSessionKill: (rarity: TMonsterRarity) => void;
    resetSession: () => void;
    emitCombatEvent: (event: ICombatEvent) => void;
    setLastDrops: (drops: IDropDisplay[]) => void;
    appendDrops: (drops: IDropDisplay[]) => void;
    setSessionXpPerHour: (v: number) => void;
    setLastCombatTickAt: (ts: string | null) => void;
    addSessionLog: (text: string, type: ICombatLogEntry['type']) => void;
    clearCombatSession: () => void;

    addWaveMonster: (m: IMonster, rarity: TMonsterRarity) => boolean;
    setWaveMonsterAggro: (waveIdx: number, target: string | null) => void;
    damageWaveMonster: (waveIdx: number, dmg: number) => void;
    resetWave: () => void;
    advanceToNextWaveTarget: () => boolean;
    markActiveWaveMonsterDead: () => void;
    setWavePlannedCount: (n: number) => void;
    incrementWavePlannedCount: () => number;
    decrementWavePlannedCount: () => number;
    removeLastWaveMonster: () => boolean;
}

let _logId = 0;

export const useCombatStore = create<ICombatStore>((set) => ({
    phase: 'idle',
    monster: null,
    monsterCurrentHp: 0,
    monsterMaxHp: 0,
    playerCurrentHp: 0,
    playerCurrentMp: 0,
    log: [],
    earnedXp: 0,
    earnedGold: 0,
    selectedMonster: null,
    monsterRarity: 'normal' as TMonsterRarity,

    backgroundActive: false,
    baseMonster: null,
    autoFight: true,
    backgroundStartedAt: null,
    sessionXpEarned: 0,
    sessionGoldEarned: 0,
    sessionKills: { normal: 0, strong: 0, epic: 0, legendary: 0, boss: 0 },
    sessionStartedAt: Date.now(),
    lastCombatEvent: null,
    lastDrops: [],
    sessionDrops: [],
    sessionXpPerHour: 0,
    lastCombatTickAt: null,
    sessionLog: [],
    waveMonsters: [],
    activeTargetIdx: 0,
    wavePlannedCount: 1,

    setSelectedMonster: (monster) => set({ selectedMonster: monster }),

    initCombat: (monster, playerHp, playerMp, rarity = 'normal') =>
        set({
            phase: 'fighting',
            monster,
            monsterCurrentHp: monster.hp,
            monsterMaxHp: monster.hp,
            playerCurrentHp:  Math.max(0, playerHp),
            playerCurrentMp:  Math.max(0, playerMp),
            log: [],
            earnedXp: 0,
            earnedGold: 0,
            monsterRarity: rarity,
            waveMonsters: [{
                monster,
                currentHp: monster.hp,
                maxHp: monster.hp,
                rarity,
                isDead: false,
                aggroTarget: null,
            }],
            activeTargetIdx: 0,
        }),

    dealToMonster: (dmg) =>
        set((s) => {
            const newHp = Math.max(0, s.monsterCurrentHp - dmg);
            const newWave = s.waveMonsters.map((w, i) =>
                i === s.activeTargetIdx ? { ...w, currentHp: newHp } : w,
            );
            return { monsterCurrentHp: newHp, waveMonsters: newWave };
        }),

    dealToPlayer: (dmg) =>
        set((s) => ({ playerCurrentHp: Math.max(0, s.playerCurrentHp - dmg) })),

    addLog: (text, type) =>
        set((s) => {
            const entry = { id: _logId++, text, type };
            return {
                log: [...s.log.slice(-49), entry],
                sessionLog: [...s.sessionLog, entry].slice(-1000),
            };
        }),

    bulkAddLog: (entries) =>
        set((s) => {
            const newEntries = entries.map((e) => ({ id: _logId++, text: e.text, type: e.type }));
            return {
                log: [...s.log, ...newEntries].slice(-50),
                sessionLog: [...s.sessionLog, ...newEntries].slice(-1000),
            };
        }),

    addReward: (xp, gold) =>
        set((s) => ({ earnedXp: s.earnedXp + xp, earnedGold: s.earnedGold + gold })),

    setPhase: (phase) => set({ phase }),

    setHps: (monsterHp, playerHp) =>
        set({ monsterCurrentHp: Math.max(0, monsterHp), playerCurrentHp: Math.max(0, playerHp) }),

    healPlayerHp: (amount, maxHp) =>
        set((s) => {
            const base = Math.max(0, s.playerCurrentHp);
            const add = Math.max(0, amount);
            return { playerCurrentHp: Math.min(maxHp, base + add) };
        }),

    healPlayerMp: (amount, maxMp) =>
        set((s) => {
            const base = Math.max(0, s.playerCurrentMp);
            const add = Math.max(0, amount);
            return { playerCurrentMp: Math.min(maxMp, base + add) };
        }),

    spendPlayerMp: (cost) =>
        set((s) => ({ playerCurrentMp: Math.max(0, s.playerCurrentMp - cost) })),

    resetCombat: () =>
        set({
            phase: 'idle',
            monster: null,
            monsterCurrentHp: 0,
            monsterMaxHp: 0,
            playerCurrentHp: 0,
            playerCurrentMp: 0,
            log: [],
            earnedXp: 0,
            earnedGold: 0,
            selectedMonster: null,
            monsterRarity: 'normal' as TMonsterRarity,
            backgroundActive: false,
            baseMonster: null,
            autoFight: true,
            backgroundStartedAt: null,
            sessionXpEarned: 0,
            sessionGoldEarned: 0,
            sessionKills: { normal: 0, strong: 0, epic: 0, legendary: 0, boss: 0 },
            sessionStartedAt: Date.now(),
            lastCombatEvent: null,
            lastDrops: [],
            sessionDrops: [],
            sessionXpPerHour: 0,
            lastCombatTickAt: null,
            sessionLog: [],
            waveMonsters: [],
            activeTargetIdx: 0,
            wavePlannedCount: 1,
        }),

    setBackgroundActive: (active) => set({ backgroundActive: active }),
    setBaseMonster: (m) => set({ baseMonster: m }),
    setAutoFight: (on) => set({ autoFight: on }),
    setBackgroundStartedAt: (ts) => set({ backgroundStartedAt: ts }),
    addSessionStats: (xp, gold) =>
        set((s) => ({ sessionXpEarned: s.sessionXpEarned + xp, sessionGoldEarned: s.sessionGoldEarned + gold })),
    incrementSessionKill: (rarity) =>
        set((s) => ({ sessionKills: { ...s.sessionKills, [rarity]: (s.sessionKills[rarity] ?? 0) + 1 } })),
    resetSession: () =>
        set({
            sessionXpEarned: 0, sessionGoldEarned: 0,
            sessionKills: { normal: 0, strong: 0, epic: 0, legendary: 0, boss: 0 },
            sessionStartedAt: Date.now(),
        }),
    emitCombatEvent: (event) => set({ lastCombatEvent: event }),
    setLastDrops: (drops) =>
        set((s) => ({
            lastDrops: drops,
            sessionDrops: drops.length > 0 ? [...s.sessionDrops, ...drops] : s.sessionDrops,
        })),
    appendDrops: (drops) =>
        set((s) => ({
            lastDrops: [...s.lastDrops, ...drops],
            sessionDrops: [...s.sessionDrops, ...drops],
        })),
    setSessionXpPerHour: (v) => set({ sessionXpPerHour: v }),
    setLastCombatTickAt: (ts) => set({ lastCombatTickAt: ts }),
    addSessionLog: (text, type) =>
        set((s) => ({
            sessionLog: [...s.sessionLog, { id: _logId++, text, type }],
        })),
    clearCombatSession: () =>
        set({
            sessionLog: [],
            lastDrops: [],
            sessionDrops: [],
            sessionXpEarned: 0,
            sessionGoldEarned: 0,
            sessionKills: { normal: 0, strong: 0, epic: 0, legendary: 0, boss: 0 },
            sessionStartedAt: Date.now(),
        }),

    addWaveMonster: (m, rarity) => {
        const s = useCombatStore.getState();
        if (s.waveMonsters.length >= MAX_WAVE_MONSTERS) return false;
        if (s.phase !== 'fighting') return false;
        set({
            waveMonsters: [
                ...s.waveMonsters,
                {
                    monster: m,
                    currentHp: m.hp,
                    maxHp: m.hp,
                    rarity,
                    isDead: false,
                    aggroTarget: null,
                },
            ],
        });
        return true;
    },

    setWaveMonsterAggro: (waveIdx, target) =>
        set((s) => ({
            waveMonsters: s.waveMonsters.map((w, i) =>
                i === waveIdx ? { ...w, aggroTarget: target } : w,
            ),
        })),

    damageWaveMonster: (waveIdx, dmg) =>
        set((s) => {
            const newWave = s.waveMonsters.map((w, i) =>
                i === waveIdx ? { ...w, currentHp: Math.max(0, w.currentHp - dmg) } : w,
            );
            const newMonsterHp = waveIdx === s.activeTargetIdx
                ? Math.max(0, s.monsterCurrentHp - dmg)
                : s.monsterCurrentHp;
            return { waveMonsters: newWave, monsterCurrentHp: newMonsterHp };
        }),

    resetWave: () => set({ waveMonsters: [], activeTargetIdx: 0 }),

    markActiveWaveMonsterDead: () =>
        set((s) => {
            const newWave = s.waveMonsters.map((w, i) =>
                i === s.activeTargetIdx ? { ...w, isDead: true, currentHp: 0 } : w,
            );
            return { waveMonsters: newWave };
        }),

    advanceToNextWaveTarget: () => {
        const s = useCombatStore.getState();
        const nextIdx = s.waveMonsters.findIndex((w) => !w.isDead);
        if (nextIdx === -1) return false;
        const next = s.waveMonsters[nextIdx];
        set({
            activeTargetIdx: nextIdx,
            monster: next.monster,
            monsterCurrentHp: next.currentHp,
            monsterMaxHp: next.maxHp,
            monsterRarity: next.rarity,
        });
        return true;
    },

    setWavePlannedCount: (n) => {
        const clamped = Math.max(1, Math.min(MAX_WAVE_MONSTERS, Math.floor(n)));
        set({ wavePlannedCount: clamped });
    },

    incrementWavePlannedCount: () => {
        const s = useCombatStore.getState();
        const next = Math.min(MAX_WAVE_MONSTERS, s.wavePlannedCount + 1);
        set({ wavePlannedCount: next });
        return next;
    },

    decrementWavePlannedCount: () => {
        const s = useCombatStore.getState();
        const next = Math.max(1, s.wavePlannedCount - 1);
        set({ wavePlannedCount: next });
        return next;
    },

    removeLastWaveMonster: () => {
        const s = useCombatStore.getState();
        if (s.waveMonsters.length <= 1) return false;
        let removeIdx = -1;
        for (let i = s.waveMonsters.length - 1; i >= 0; i--) {
            const w = s.waveMonsters[i];
            if (!w.isDead && i !== s.activeTargetIdx) {
                removeIdx = i;
                break;
            }
        }
        if (removeIdx === -1) return false;
        const newWave = s.waveMonsters.filter((_, i) => i !== removeIdx);
        const newActiveIdx = removeIdx < s.activeTargetIdx
            ? s.activeTargetIdx - 1
            : s.activeTargetIdx;
        set({ waveMonsters: newWave, activeTargetIdx: newActiveIdx });
        return true;
    },
}));
