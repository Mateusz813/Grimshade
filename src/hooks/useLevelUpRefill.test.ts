import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

/**
 * useLevelUpRefill tests
 *
 * On a fresh level-up event in `useLevelUpStore`, the hook fires the
 * caller's `onRefill(maxHp, maxMp)` once with the player's freshly
 * computed effective max — but ONLY while the calling view is `active`.
 * Repeat renders for the same event must NOT re-fire.
 *
 * `getEffectiveChar` is mocked so the test owns the effective max
 * regardless of equipment / training math.
 */

vi.mock('../systems/combatEngine', () => ({
    getEffectiveChar: vi.fn((c) => c),
}));

import { useLevelUpRefill } from './useLevelUpRefill';
import { useLevelUpStore, type ILevelUpEvent } from '../stores/levelUpStore';
import { useCharacterStore, type ICharacter } from '../stores/characterStore';
import { getEffectiveChar } from '../systems/combatEngine';

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

const makeEvent = (overrides: Partial<ILevelUpEvent> = {}): ILevelUpEvent => ({
    newLevel: 6,
    levelsGained: 1,
    statPointsGained: 1,
    inCombat: true,
    ...overrides,
});

beforeEach(() => {
    vi.clearAllMocks();
    (getEffectiveChar as ReturnType<typeof vi.fn>).mockImplementation((c) => c);
    useLevelUpStore.setState({ event: null });
    useCharacterStore.setState({
        character: makeChar({ max_hp: 200, max_mp: 80 }),
        isLoading: false,
    });
});

describe('useLevelUpRefill', () => {
    it('does NOT call onRefill when there is no event', () => {
        const cb = vi.fn();
        renderHook(() => useLevelUpRefill(true, cb));
        expect(cb).not.toHaveBeenCalled();
    });

    it('does NOT call onRefill when inactive', () => {
        const cb = vi.fn();
        useLevelUpStore.setState({ event: makeEvent() });
        renderHook(() => useLevelUpRefill(false, cb));
        expect(cb).not.toHaveBeenCalled();
    });

    it('calls onRefill exactly once with effective max HP / MP when active + event present', () => {
        const cb = vi.fn();
        useLevelUpStore.setState({ event: makeEvent() });
        renderHook(() => useLevelUpRefill(true, cb));
        expect(cb).toHaveBeenCalledTimes(1);
        expect(cb).toHaveBeenCalledWith(200, 80);
    });

    it('uses effective char max when getEffectiveChar returns boosted values', () => {
        (getEffectiveChar as ReturnType<typeof vi.fn>).mockReturnValue({
            ...makeChar(),
            max_hp: 350,
            max_mp: 150,
        });
        const cb = vi.fn();
        useLevelUpStore.setState({ event: makeEvent() });
        renderHook(() => useLevelUpRefill(true, cb));
        expect(cb).toHaveBeenCalledWith(350, 150);
    });

    it('falls back to character.max_hp/max_mp when getEffectiveChar returns null', () => {
        (getEffectiveChar as ReturnType<typeof vi.fn>).mockReturnValue(null);
        const cb = vi.fn();
        useLevelUpStore.setState({ event: makeEvent() });
        renderHook(() => useLevelUpRefill(true, cb));
        expect(cb).toHaveBeenCalledWith(200, 80);
    });

    it('does NOT re-fire for the same event on repeat renders', () => {
        const ev = makeEvent();
        useLevelUpStore.setState({ event: ev });
        const cb = vi.fn();
        const { rerender } = renderHook(() => useLevelUpRefill(true, cb));
        rerender();
        rerender();
        expect(cb).toHaveBeenCalledTimes(1);
    });

    it('fires again when a NEW level-up event arrives', () => {
        const cb = vi.fn();
        useLevelUpStore.setState({ event: makeEvent({ newLevel: 6 }) });
        const { rerender } = renderHook(() => useLevelUpRefill(true, cb));
        expect(cb).toHaveBeenCalledTimes(1);
        // Replace the event reference — hook keys off identity, not value.
        useLevelUpStore.setState({ event: makeEvent({ newLevel: 7 }) });
        rerender();
        expect(cb).toHaveBeenCalledTimes(2);
    });

    it('fires once when active flips from false -> true with a pending event', () => {
        // Active=false skips the effect; flipping to true with the SAME
        // event reference still fires once (the previous render didn't
        // mark it handled).
        const cb = vi.fn();
        useLevelUpStore.setState({ event: makeEvent() });
        const { rerender } = renderHook(
            ({ active }: { active: boolean }) => useLevelUpRefill(active, cb),
            { initialProps: { active: false } },
        );
        expect(cb).not.toHaveBeenCalled();
        rerender({ active: true });
        expect(cb).toHaveBeenCalledTimes(1);
    });

    it('does NOT fire when character is missing', () => {
        useCharacterStore.setState({ character: null });
        useLevelUpStore.setState({ event: makeEvent() });
        const cb = vi.fn();
        renderHook(() => useLevelUpRefill(true, cb));
        expect(cb).not.toHaveBeenCalled();
    });
});
