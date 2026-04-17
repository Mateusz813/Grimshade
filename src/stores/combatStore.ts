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
    /**
     * Current aggro target for THIS monster.
     * 'player' → attacking the player
     * `bot_<id>` → attacking a party bot by ID
     * null → not yet resolved (will pick on next attack tick)
     */
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
    /** Monster pre-selected from MonsterList screen, to auto-start on Combat mount */
    selectedMonster: IMonster | null;
    /** Rarity of the current monster encounter */
    monsterRarity: TMonsterRarity;

    // ── Background combat fields ─────────────────────────────────────────────
    /** Whether combat is running in background (player navigated away) */
    backgroundActive: boolean;
    /** Base (unscaled) monster being fought — used for auto-fight re-rolls */
    baseMonster: IMonster | null;
    /** Whether auto-fight is enabled */
    autoFight: boolean;
    /** ISO timestamp when background combat started (for 10h cap) */
    backgroundStartedAt: string | null;
    /** Cumulative session XP earned */
    sessionXpEarned: number;
    /** Cumulative session gold earned */
    sessionGoldEarned: number;
    /** Session kills by monster rarity */
    sessionKills: Record<string, number>;
    /** Timestamp when session started (Date.now()) */
    sessionStartedAt: number;
    /** Last combat event — for triggering animations in Combat.tsx */
    lastCombatEvent: ICombatEvent | null;
    /** Last dropped items — for victory popup display */
    lastDrops: IDropDisplay[];
    /** XP per hour computed by useBackgroundCombat */
    sessionXpPerHour: number;
    /** ISO timestamp of the last combat tick – used for offline catch-up */
    lastCombatTickAt: string | null;

    // ── Wave (multi-monster) state ──────────────────────────────────────────
    /** All monsters in the current wave (1-4 of the same base monster type). */
    waveMonsters: IWaveMonster[];
    /** Index of the currently-targeted monster in waveMonsters. */
    activeTargetIdx: number;
    /**
     * Sticky planned wave size (1-4). Persists across waves — clicking
     * "Dodaj potwora" bumps this, so every subsequent auto-fight spawns
     * the same number of monsters without the user re-clicking each time.
     * Reset to 1 on `resetCombat()`.
     */
    wavePlannedCount: number;

    // ── Actions ──────────────────────────────────────────────────────────────
    initCombat:        (monster: IMonster, playerHp: number, playerMp: number, rarity?: TMonsterRarity) => void;
    setSelectedMonster:(monster: IMonster | null) => void;
    dealToMonster:(dmg: number) => void;
    dealToPlayer: (dmg: number) => void;
    addLog:       (text: string, type: ICombatLogEntry['type']) => void;
    bulkAddLog:   (entries: Array<Pick<ICombatLogEntry, 'text' | 'type'>>) => void;
    addReward:    (xp: number, gold: number) => void;
    setPhase:     (phase: CombatPhase) => void;
    setHps:       (monsterHp: number, playerHp: number) => void;
    /** Restore HP, capped at maxHp. */
    healPlayerHp: (amount: number, maxHp: number) => void;
    /** Restore MP, capped at maxMp. */
    healPlayerMp: (amount: number, maxMp: number) => void;
    /** Subtract MP (e.g. skill cost). Floors at 0. */
    spendPlayerMp:(cost: number) => void;
    resetCombat:  () => void;

    // ── Background combat actions ────────────────────────────────────────────
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

    // ── Wave actions ────────────────────────────────────────────────────────
    /** Append a monster to the wave (max MAX_WAVE_MONSTERS). Returns true if added. */
    addWaveMonster: (m: IMonster, rarity: TMonsterRarity) => boolean;
    /** Set the aggro target for a specific wave monster (by index). */
    setWaveMonsterAggro: (waveIdx: number, target: string | null) => void;
    /** Apply damage to a wave monster by index (non-active monsters included). */
    damageWaveMonster: (waveIdx: number, dmg: number) => void;
    /** Clear wave & reset active target to 0. */
    resetWave: () => void;
    /** Find next alive monster in wave, promote it to active. Returns true if one found. */
    advanceToNextWaveTarget: () => boolean;
    /** Mark current active monster as dead in the wave. */
    markActiveWaveMonsterDead: () => void;
    /** Set the sticky planned wave size (clamped 1..MAX_WAVE_MONSTERS). */
    setWavePlannedCount: (n: number) => void;
    /** Bump the planned wave size by 1 (no-op at max). Returns new count. */
    incrementWavePlannedCount: () => number;
    /** Decrease the planned wave size by 1 (no-op at min=1). Returns new count. */
    decrementWavePlannedCount: () => number;
    /**
     * Remove the last alive non-active monster from the current wave (during fight).
     * Used by the "➖ Usuń potwora" button so the player can bail out of extra
     * monsters they've already spawned. Returns true if one was removed.
     */
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

    // Background combat defaults
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
    sessionXpPerHour: 0,
    lastCombatTickAt: null,
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
        set((s) => ({
            log: [...s.log.slice(-49), { id: _logId++, text, type }],
        })),

    bulkAddLog: (entries) =>
        set((s) => {
            const newEntries = entries.map((e) => ({ id: _logId++, text: e.text, type: e.type }));
            return { log: [...s.log, ...newEntries].slice(-50) };
        }),

    addReward: (xp, gold) =>
        set((s) => ({ earnedXp: s.earnedXp + xp, earnedGold: s.earnedGold + gold })),

    setPhase: (phase) => set({ phase }),

    setHps: (monsterHp, playerHp) =>
        set({ monsterCurrentHp: Math.max(0, monsterHp), playerCurrentHp: Math.max(0, playerHp) }),

    healPlayerHp: (amount, maxHp) =>
        set((s) => ({
            // Always clamp to maxHp — even if playerCurrentHp was somehow already above max
            playerCurrentHp: Math.min(maxHp, Math.max(0, Math.min(s.playerCurrentHp, maxHp) + amount)),
        })),

    healPlayerMp: (amount, maxMp) =>
        set((s) => ({
            playerCurrentMp: Math.min(maxMp, Math.max(0, Math.min(s.playerCurrentMp, maxMp) + amount)),
        })),

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
            sessionXpPerHour: 0,
            lastCombatTickAt: null,
            waveMonsters: [],
            activeTargetIdx: 0,
            wavePlannedCount: 1,
        }),

    // Background combat actions
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
    setLastDrops: (drops) => set({ lastDrops: drops }),
    appendDrops: (drops) =>
        set((s) => ({ lastDrops: [...s.lastDrops, ...drops] })),
    setSessionXpPerHour: (v) => set({ sessionXpPerHour: v }),
    setLastCombatTickAt: (ts) => set({ lastCombatTickAt: ts }),

    // ── Wave actions ────────────────────────────────────────────────────────
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
            // If we hit the active target, mirror into monsterCurrentHp
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
        // Find first alive monster starting from top (top-to-bottom aggro)
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
        // Find the LAST alive monster that is NOT the current active target.
        // Iterate from the end so we always pick the most recently added one.
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
        // Active idx may need to shift left if we removed something before it.
        const newActiveIdx = removeIdx < s.activeTargetIdx
            ? s.activeTargetIdx - 1
            : s.activeTargetIdx;
        set({ waveMonsters: newWave, activeTargetIdx: newActiveIdx });
        return true;
    },
}));
