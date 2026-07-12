import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';


vi.mock('../systems/combatEngine', () => ({
    getEffectiveChar: vi.fn((c) => c),
}));

vi.mock('../systems/skillSystem', () => ({
    getTrainingBonuses: vi.fn(() => ({
        attack_speed: 0,
        max_hp: 0, max_mp: 0,
        hp_regen: 0, mp_regen: 0,
        defense: 0, crit_chance: 0, crit_dmg: 0,
    })),
}));

vi.mock('../systems/itemSystem', () => ({
    getTotalEquipmentStats: vi.fn(() => ({ hp: 0, mp: 0, attack: 0, defense: 0, speed: 0, critChance: 0, critDmg: 0 })),
    flattenItemsData: vi.fn(() => []),
    EMPTY_EQUIPMENT: {
        mainHand: null, offHand: null, helmet: null, armor: null,
        pants: null, gloves: null, boots: null, shoulders: null,
        ring1: null, ring2: null, necklace: null, earrings: null,
    },
}));

import { useMpRegen } from './useMpRegen';
import { useCharacterStore, type ICharacter } from '../stores/characterStore';
import { useCombatStore } from '../stores/combatStore';
import { useSkillStore } from '../stores/skillStore';
import { useInventoryStore } from '../stores/inventoryStore';
import { useAppRouteStore } from '../stores/appRouteStore';
import { getEffectiveChar } from '../systems/combatEngine';

const makeChar = (overrides: Partial<ICharacter> = {}): ICharacter => ({
    id: 'char-1',
    user_id: 'user-1',
    name: 'Hero',
    class: 'Knight',
    level: 5,
    xp: 0,
    hp: 50, max_hp: 100, mp: 10, max_mp: 30,
    attack: 15, defense: 12, attack_speed: 2.0,
    crit_chance: 3, crit_damage: 150, magic_level: 0,
    hp_regen: 0, mp_regen: 0,
    gold: 0, stat_points: 0, highest_level: 5,
    equipment: {},
    created_at: '', updated_at: '',
    ...overrides,
} as ICharacter);

let updateCharacterSpy: ReturnType<typeof vi.fn>;
let healPlayerHpSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();

    updateCharacterSpy = vi.fn((partial) => {
        const c = useCharacterStore.getState().character;
        if (c) useCharacterStore.setState({ character: { ...c, ...partial } });
    });
    healPlayerHpSpy = vi.fn();

    useCharacterStore.setState({
        character: makeChar(),
        isLoading: false,
        updateCharacter: updateCharacterSpy,
    } as unknown as ReturnType<typeof useCharacterStore.getState>);
    useCombatStore.setState({
        phase: 'idle',
        playerCurrentHp: 0, playerCurrentMp: 0,
        healPlayerHp: healPlayerHpSpy,
    } as unknown as ReturnType<typeof useCombatStore.getState>);
    useSkillStore.setState({ skillLevels: {} });
    useInventoryStore.setState({ equipment: {} } as unknown as ReturnType<typeof useInventoryStore.getState>);
    useAppRouteStore.setState({ isCharacterless: false });
    (getEffectiveChar as ReturnType<typeof vi.fn>).mockImplementation((c) => c);
});

afterEach(() => {
    vi.useRealTimers();
});

describe('useMpRegen — tick wiring', () => {
    it('sets up a 1s interval and cleans it up on unmount', () => {
        const { unmount } = renderHook(() => useMpRegen());
        act(() => { vi.advanceTimersByTime(3000); });
        expect(updateCharacterSpy).not.toHaveBeenCalled();
        unmount();
        act(() => { vi.advanceTimersByTime(5000); });
        expect(updateCharacterSpy).not.toHaveBeenCalled();
    });
});

describe('useMpRegen — characterless pause', () => {
    it('does nothing when isCharacterless is true', () => {
        useAppRouteStore.setState({ isCharacterless: true });
        useCharacterStore.setState({
            character: makeChar({ hp_regen: 10, mp_regen: 10, hp: 10, mp: 10 }),
        });
        renderHook(() => useMpRegen());
        act(() => { vi.advanceTimersByTime(2000); });
        expect(updateCharacterSpy).not.toHaveBeenCalled();
    });

    it('does nothing when there is no character', () => {
        useCharacterStore.setState({ character: null });
        renderHook(() => useMpRegen());
        act(() => { vi.advanceTimersByTime(2000); });
        expect(updateCharacterSpy).not.toHaveBeenCalled();
    });
});

describe('useMpRegen — out of combat', () => {
    it('writes hp + mp progress to the character when regen > 0', () => {
        useCharacterStore.setState({
            character: makeChar({ hp_regen: 3, mp_regen: 2, hp: 50, mp: 10 }),
        });
        renderHook(() => useMpRegen());
        act(() => { vi.advanceTimersByTime(1100); });
        expect(updateCharacterSpy).toHaveBeenCalled();
        const last = updateCharacterSpy.mock.calls.at(-1)?.[0];
        expect(last.hp).toBe(53);
        expect(last.mp).toBe(11);
    });

    it('2026-06-24 regression: applies TRANSFORM regen even when base char.mp_regen/hp_regen is 0', () => {
        (getEffectiveChar as ReturnType<typeof vi.fn>).mockImplementation((c) => ({
            ...c, hp_regen: 4, mp_regen: 3, max_hp: 1000, max_mp: 1000,
        }));
        useCharacterStore.setState({
            character: makeChar({ hp_regen: 0, mp_regen: 0, hp: 50, mp: 10, max_hp: 1000, max_mp: 1000 }),
        });
        renderHook(() => useMpRegen());
        act(() => { vi.advanceTimersByTime(1100); });
        expect(updateCharacterSpy).toHaveBeenCalled();
        const last = updateCharacterSpy.mock.calls.at(-1)?.[0];
        expect(last.hp).toBe(54);
        expect(last.mp).toBe(13);
    });

    it('clamps HP / MP at the effective max', () => {
        useCharacterStore.setState({
            character: makeChar({ hp_regen: 50, mp_regen: 50, hp: 99, mp: 29, max_hp: 100, max_mp: 30 }),
        });
        renderHook(() => useMpRegen());
        act(() => { vi.advanceTimersByTime(1100); });
        const last = updateCharacterSpy.mock.calls.at(-1)?.[0];
        expect(last.hp).toBeLessThanOrEqual(100);
        expect(last.mp).toBeLessThanOrEqual(30);
    });

    it('does NOT call updateCharacter when nothing actually changed', () => {
        useCharacterStore.setState({
            character: makeChar({ hp_regen: 0, mp_regen: 0, hp: 50, mp: 10 }),
        });
        renderHook(() => useMpRegen());
        act(() => { vi.advanceTimersByTime(1100); });
        expect(updateCharacterSpy).not.toHaveBeenCalled();
    });

    it('does NOT regen when character is fully dead (hp=0, mp=0)', () => {
        useCharacterStore.setState({
            character: makeChar({ hp: 0, mp: 0, hp_regen: 5, mp_regen: 5 }),
        });
        renderHook(() => useMpRegen());
        act(() => { vi.advanceTimersByTime(1100); });
        expect(updateCharacterSpy).not.toHaveBeenCalled();
    });
});

describe('useMpRegen — in combat (fighting)', () => {
    it('heals via combatStore.healPlayerHp and skips MP regen', () => {
        useCharacterStore.setState({
            character: makeChar({ hp_regen: 3, mp_regen: 5 }),
        });
        useCombatStore.setState({
            phase: 'fighting',
            playerCurrentHp: 50,
            playerCurrentMp: 5,
            healPlayerHp: healPlayerHpSpy,
        } as unknown as ReturnType<typeof useCombatStore.getState>);
        renderHook(() => useMpRegen());
        act(() => { vi.advanceTimersByTime(1100); });
        expect(healPlayerHpSpy).toHaveBeenCalled();
        expect(updateCharacterSpy).not.toHaveBeenCalled();
    });

    it('does NOT heal player when HP is already at max', () => {
        useCharacterStore.setState({
            character: makeChar({ hp_regen: 3, max_hp: 100 }),
        });
        useCombatStore.setState({
            phase: 'fighting',
            playerCurrentHp: 100,
            playerCurrentMp: 5,
            healPlayerHp: healPlayerHpSpy,
        } as unknown as ReturnType<typeof useCombatStore.getState>);
        renderHook(() => useMpRegen());
        act(() => { vi.advanceTimersByTime(1100); });
        expect(healPlayerHpSpy).not.toHaveBeenCalled();
    });

    it('does NOT heal player when already dead (currentHp=0)', () => {
        useCharacterStore.setState({
            character: makeChar({ hp_regen: 10 }),
        });
        useCombatStore.setState({
            phase: 'fighting',
            playerCurrentHp: 0,
            playerCurrentMp: 5,
            healPlayerHp: healPlayerHpSpy,
        } as unknown as ReturnType<typeof useCombatStore.getState>);
        renderHook(() => useMpRegen());
        act(() => { vi.advanceTimersByTime(1100); });
        expect(healPlayerHpSpy).not.toHaveBeenCalled();
    });
});

describe('useMpRegen — between waves (victory)', () => {
    it('heals HP between waves but pauses MP regen', () => {
        useCharacterStore.setState({
            character: makeChar({ hp_regen: 3, mp_regen: 5 }),
        });
        useCombatStore.setState({
            phase: 'victory',
            playerCurrentHp: 50,
            playerCurrentMp: 5,
            healPlayerHp: healPlayerHpSpy,
        } as unknown as ReturnType<typeof useCombatStore.getState>);
        renderHook(() => useMpRegen());
        act(() => { vi.advanceTimersByTime(1100); });
        expect(healPlayerHpSpy).toHaveBeenCalled();
        expect(updateCharacterSpy).not.toHaveBeenCalled();
    });
});

describe('useMpRegen — regen cap', () => {
    it('caps regen at 5% of effective max even with massive raw values', () => {
        useCharacterStore.setState({
            character: makeChar({ hp_regen: 9999, max_hp: 100, hp: 10 }),
        });
        renderHook(() => useMpRegen());
        act(() => { vi.advanceTimersByTime(1100); });
        const last = updateCharacterSpy.mock.calls.at(-1)?.[0];
        expect(last.hp).toBe(15);
    });
});
