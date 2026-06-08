import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';

/**
 * useBackgroundCombat tests
 *
 * The hook is a thick orchestrator: it owns five intervals (player tick,
 * monster tick, bot tick, status tick, auto-skill tick, cooldown tick)
 * plus offline catch-up + auto-fight + 10h cap + XP-per-hour. We mock
 * the combat engine so the hook's wiring logic can be exercised
 * without dragging the whole engine into the test.
 */

// All engine entry points are mocked. We can assert on them.
vi.mock('../systems/combatEngine', () => ({
    SPEED_MULT: { x1: 1, x2: 2, x4: 4 },
    doPlayerAttackTick: vi.fn(),
    doMonsterAttackTick: vi.fn(),
    doBotAttackTick: vi.fn(),
    startAutoNextFight: vi.fn(),
    resolveInstantFight: vi.fn(),
    stopCombat: vi.fn(),
    tryAutoPotion: vi.fn(),
    simulateOfflineCombat: vi.fn(() => null),
    advanceSkillCooldowns: vi.fn(),
    huntStatusTick: vi.fn(),
    getAttackMs: vi.fn((speed: number) => Math.max(200, 1000 * (speed ?? 1))),
    getEffectiveChar: vi.fn((c) => c),
}));

vi.mock('../systems/levelSystem', () => ({
    xpToNextLevel: vi.fn(() => 100),
}));

vi.mock('../systems/goldFormat', () => ({
    formatGoldShort: vi.fn((n: number) => String(n)),
}));

import { useBackgroundCombat, AUTO_FIGHT_DELAY_MS } from './useBackgroundCombat';
import { useCombatStore } from '../stores/combatStore';
import { useCharacterStore, type ICharacter } from '../stores/characterStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useBotStore } from '../stores/botStore';
import { useAppRouteStore } from '../stores/appRouteStore';
import { usePartyStore } from '../stores/partyStore';
import {
    doPlayerAttackTick,
    doMonsterAttackTick,
    doBotAttackTick,
    startAutoNextFight,
    simulateOfflineCombat,
    huntStatusTick,
    stopCombat,
} from '../systems/combatEngine';

// ── Fixtures ────────────────────────────────────────────────────────────────

const makeChar = (overrides: Partial<ICharacter> = {}): ICharacter => ({
    id: 'char-1',
    user_id: 'user-1',
    name: 'Hero',
    class: 'Knight',
    level: 5,
    xp: 0,
    hp: 100, max_hp: 100, mp: 30, max_mp: 30,
    attack: 15, defense: 12, attack_speed: 2.0,
    crit_chance: 3, crit_damage: 150, magic_level: 0,
    hp_regen: 0, mp_regen: 0,
    gold: 0, stat_points: 0, highest_level: 5,
    equipment: {},
    created_at: '', updated_at: '',
    ...overrides,
} as ICharacter);

const makeMonster = () => ({
    id: 'rat',
    name_pl: 'Szczur',
    name_en: 'Rat',
    level: 1,
    hp: 30,
    attack: 7,
    defense: 2,
    speed: 2,
    xp: 3,
    gold: [1, 1] as [number, number],
    dropTable: [],
    sprite: '🐀',
});

beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    useCombatStore.getState().resetCombat();
    useCombatStore.setState({ autoFight: true, backgroundStartedAt: null, lastCombatTickAt: null });
    useCharacterStore.setState({ character: makeChar(), isLoading: false });
    useSettingsStore.setState({ combatSpeed: 'x1' });
    useBotStore.setState({ bots: [] });
    useAppRouteStore.setState({ isCharacterless: false });
    usePartyStore.setState({ party: null });
});

afterEach(() => {
    // Tear down any hooks left mounted by prior tests. Without
    // `cleanup()` the per-hook setInterval handlers keep ticking
    // across tests — so a later `vi.advanceTimersByTime()` invokes
    // the engine spies from previous renders and breaks "not called"
    // assertions in the unmount / offline-catch-up suites.
    cleanup();
    vi.useRealTimers();
});

describe('useBackgroundCombat — constants', () => {
    it('exports AUTO_FIGHT_DELAY_MS = 1000', () => {
        expect(AUTO_FIGHT_DELAY_MS).toBe(1000);
    });
});

describe('useBackgroundCombat — idle phase', () => {
    it('does not run any tick when phase is idle', () => {
        renderHook(() => useBackgroundCombat());
        act(() => { vi.advanceTimersByTime(5000); });
        expect(doPlayerAttackTick).not.toHaveBeenCalled();
        expect(doMonsterAttackTick).not.toHaveBeenCalled();
        expect(doBotAttackTick).not.toHaveBeenCalled();
        expect(huntStatusTick).not.toHaveBeenCalled();
    });
});

describe('useBackgroundCombat — fighting phase', () => {
    beforeEach(() => {
        useCombatStore.setState({
            phase: 'fighting',
            monster: makeMonster(),
            baseMonster: makeMonster(),
            playerCurrentHp: 100,
            playerCurrentMp: 30,
        });
    });

    it('ticks the player attack interval while fighting', () => {
        renderHook(() => useBackgroundCombat());
        act(() => { vi.advanceTimersByTime(1500); });
        expect(doPlayerAttackTick).toHaveBeenCalled();
    });

    it('ticks the monster attack interval while fighting', () => {
        renderHook(() => useBackgroundCombat());
        act(() => { vi.advanceTimersByTime(1500); });
        expect(doMonsterAttackTick).toHaveBeenCalled();
    });

    it('runs the status tick at 250ms while fighting', () => {
        renderHook(() => useBackgroundCombat());
        act(() => { vi.advanceTimersByTime(260); });
        expect(huntStatusTick).toHaveBeenCalled();
    });

    it('runs the auto-skill poll at 250ms (passes autoSkillOnly=true)', () => {
        renderHook(() => useBackgroundCombat());
        act(() => { vi.advanceTimersByTime(260); });
        // doPlayerAttackTick is called both by main + auto-skill poll
        const callsWithTrue = (doPlayerAttackTick as ReturnType<typeof vi.fn>).mock.calls.filter(
            (c) => c[0] === true,
        );
        expect(callsWithTrue.length).toBeGreaterThan(0);
    });

    it('does NOT tick bots when bots array is empty', () => {
        renderHook(() => useBackgroundCombat());
        act(() => { vi.advanceTimersByTime(2000); });
        expect(doBotAttackTick).not.toHaveBeenCalled();
    });

    it('ticks bots when at least one bot is in the party', () => {
        useBotStore.setState({
            bots: [{
                id: 'bot-1', name: 'Bot', class: 'Knight', level: 5,
                hp: 80, maxHp: 80, mp: 20, maxMp: 20,
                attack: 10, defense: 8, attackSpeed: 2.0,
                critChance: 5, magicLevel: 0,
                skillId: null, skillDamageMultiplier: 1,
                skillMpCost: 0, skillCooldownMs: 0,
                alive: true,
            }],
        });
        renderHook(() => useBackgroundCombat());
        act(() => { vi.advanceTimersByTime(2000); });
        expect(doBotAttackTick).toHaveBeenCalled();
    });

    it('pauses all ticks when route is characterless', () => {
        useAppRouteStore.setState({ isCharacterless: true });
        renderHook(() => useBackgroundCombat());
        act(() => { vi.advanceTimersByTime(3000); });
        expect(doPlayerAttackTick).not.toHaveBeenCalled();
        expect(doMonsterAttackTick).not.toHaveBeenCalled();
        expect(huntStatusTick).not.toHaveBeenCalled();
    });

    it('cleans up intervals on unmount', () => {
        const { unmount } = renderHook(() => useBackgroundCombat());
        unmount();
        vi.clearAllMocks();
        act(() => { vi.advanceTimersByTime(5000); });
        expect(doPlayerAttackTick).not.toHaveBeenCalled();
        expect(doMonsterAttackTick).not.toHaveBeenCalled();
    });
});

describe('useBackgroundCombat — SKIP mode', () => {
    it('does NOT spin up attack intervals when speed is SKIP', () => {
        useSettingsStore.setState({ combatSpeed: 'SKIP' });
        useCombatStore.setState({
            phase: 'fighting',
            monster: makeMonster(),
            baseMonster: makeMonster(),
        });
        renderHook(() => useBackgroundCombat());
        act(() => { vi.advanceTimersByTime(2000); });
        expect(doPlayerAttackTick).not.toHaveBeenCalled();
        expect(doMonsterAttackTick).not.toHaveBeenCalled();
    });
});

describe('useBackgroundCombat — offline catch-up', () => {
    it('triggers simulateOfflineCombat when lastCombatTickAt is older than threshold', () => {
        const oldTs = new Date(Date.now() - 60_000).toISOString();
        useCombatStore.setState({
            phase: 'fighting',
            monster: makeMonster(),
            baseMonster: makeMonster(),
            lastCombatTickAt: oldTs,
        });
        renderHook(() => useBackgroundCombat());
        expect(simulateOfflineCombat).toHaveBeenCalled();
    });

    it('does NOT trigger simulation when there is no baseMonster', () => {
        useCombatStore.setState({
            phase: 'fighting',
            lastCombatTickAt: new Date(Date.now() - 60_000).toISOString(),
            baseMonster: null,
        });
        renderHook(() => useBackgroundCombat());
        expect(simulateOfflineCombat).not.toHaveBeenCalled();
    });

    it('does NOT trigger simulation when phase is idle', () => {
        useCombatStore.setState({
            phase: 'idle',
            lastCombatTickAt: new Date(Date.now() - 60_000).toISOString(),
            baseMonster: makeMonster(),
        });
        renderHook(() => useBackgroundCombat());
        expect(simulateOfflineCombat).not.toHaveBeenCalled();
    });
});

describe('useBackgroundCombat — auto-fight on victory', () => {
    it('schedules startAutoNextFight after AUTO_FIGHT_DELAY_MS in normal speed', () => {
        useCombatStore.setState({
            phase: 'victory',
            autoFight: true,
            monster: makeMonster(),
            baseMonster: makeMonster(),
        });
        renderHook(() => useBackgroundCombat());
        expect(startAutoNextFight).not.toHaveBeenCalled();
        act(() => { vi.advanceTimersByTime(AUTO_FIGHT_DELAY_MS + 50); });
        expect(startAutoNextFight).toHaveBeenCalled();
    });

    it('schedules startAutoNextFight near-instantly in SKIP mode', () => {
        useSettingsStore.setState({ combatSpeed: 'SKIP' });
        useCombatStore.setState({
            phase: 'victory',
            autoFight: true,
            monster: makeMonster(),
            baseMonster: makeMonster(),
        });
        renderHook(() => useBackgroundCombat());
        act(() => { vi.advanceTimersByTime(20); });
        expect(startAutoNextFight).toHaveBeenCalled();
    });

    it('does NOT auto-next-fight when autoFight is disabled', () => {
        useCombatStore.setState({
            phase: 'victory',
            autoFight: false,
            monster: makeMonster(),
            baseMonster: makeMonster(),
        });
        renderHook(() => useBackgroundCombat());
        act(() => { vi.advanceTimersByTime(AUTO_FIGHT_DELAY_MS + 200); });
        expect(startAutoNextFight).not.toHaveBeenCalled();
    });
});

describe('useBackgroundCombat — 10h cap', () => {
    it('calls stopCombat when backgroundStartedAt + 10h has already elapsed', () => {
        // 11h ago — past the cap → stops immediately on mount.
        const longAgo = new Date(Date.now() - 11 * 60 * 60 * 1000).toISOString();
        useCombatStore.setState({ backgroundStartedAt: longAgo });
        renderHook(() => useBackgroundCombat());
        expect(stopCombat).toHaveBeenCalled();
    });

    it('does NOT call stopCombat when within the 10h window', () => {
        useCombatStore.setState({
            backgroundStartedAt: new Date(Date.now() - 60_000).toISOString(),
        });
        renderHook(() => useBackgroundCombat());
        expect(stopCombat).not.toHaveBeenCalled();
    });
});
