import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, cleanup } from '@testing-library/react';


vi.mock('../api/v1/characterApi', () => ({
    characterApi: {
        bumpStat: vi.fn().mockResolvedValue(undefined),
    },
}));

import { useLeaderboardStatSync } from './useLeaderboardStatSync';
import { characterApi } from '../api/v1/characterApi';
import { useCharacterStore, type ICharacter } from '../stores/characterStore';
import { useMasteryStore } from '../stores/masteryStore';
import { useQuestStore } from '../stores/questStore';
import { useDailyQuestStore } from '../stores/dailyQuestStore';
import { useSkillStore } from '../stores/skillStore';

const makeChar = (id = 'char-1'): ICharacter => ({
    id,
    user_id: 'user-1',
    name: 'Hero',
    class: 'Knight',
    level: 50,
    xp: 0,
    hp: 500, max_hp: 500, mp: 100, max_mp: 100,
    attack: 50, defense: 30, attack_speed: 2.0,
    crit_chance: 5, crit_damage: 200, magic_level: 0,
    hp_regen: 0, mp_regen: 0,
    gold: 0, stat_points: 0, highest_level: 50,
    equipment: {},
    created_at: '', updated_at: '',
} as ICharacter);

beforeEach(() => {
    vi.clearAllMocks();
    useMasteryStore.setState({ masteries: {} });
    useQuestStore.setState({ completedQuestIds: [] } as unknown as ReturnType<typeof useQuestStore.getState>);
    useDailyQuestStore.setState({ activeQuests: [] } as unknown as ReturnType<typeof useDailyQuestStore.getState>);
    useSkillStore.setState({ skillUpgradeLevels: {} });
});

afterEach(() => {
    cleanup();
});

describe('useLeaderboardStatSync', () => {
    it('does NOT fire when there is no character', () => {
        useCharacterStore.setState({ character: null });
        renderHook(() => useLeaderboardStatSync());
        expect(characterApi.bumpStat).not.toHaveBeenCalled();
    });

    it('back-fills mastery_points as the sum of mastery levels', () => {
        useCharacterStore.setState({ character: makeChar() });
        useMasteryStore.setState({
            masteries: {
                rat: { level: 5 },
                wolf: { level: 7 },
                goblin: { level: 3 },
            },
        });
        renderHook(() => useLeaderboardStatSync());
        const call = (characterApi.bumpStat as ReturnType<typeof vi.fn>).mock.calls
            .find((c) => c[0]?.column === 'mastery_points');
        expect(call).toBeDefined();
        expect(call?.[0].value).toBe(15);
        expect(call?.[0].mode).toBe('set');
    });

    it('back-fills quests_oneshot_done with the length of completedQuestIds', () => {
        useCharacterStore.setState({ character: makeChar() });
        useQuestStore.setState({
            completedQuestIds: ['q1', 'q2', 'q3'],
        } as unknown as ReturnType<typeof useQuestStore.getState>);
        renderHook(() => useLeaderboardStatSync());
        const call = (characterApi.bumpStat as ReturnType<typeof vi.fn>).mock.calls
            .find((c) => c[0]?.column === 'quests_oneshot_done');
        expect(call?.[0].value).toBe(3);
        expect(call?.[0].mode).toBe('set');
    });

    it('back-fills quests_daily_done with TODAY claimed count using "max" mode', () => {
        useCharacterStore.setState({ character: makeChar() });
        useDailyQuestStore.setState({
            activeQuests: [
                { questId: 'd1', claimed: true, completed: true, progress: 10 },
                { questId: 'd2', claimed: true, completed: true, progress: 10 },
                { questId: 'd3', claimed: false, completed: true, progress: 10 },
            ],
        } as unknown as ReturnType<typeof useDailyQuestStore.getState>);
        renderHook(() => useLeaderboardStatSync());
        const call = (characterApi.bumpStat as ReturnType<typeof vi.fn>).mock.calls
            .find((c) => c[0]?.column === 'quests_daily_done');
        expect(call?.[0].value).toBe(2);
        expect(call?.[0].mode).toBe('max');
    });

    it('back-fills skill_upgrades_done with the sum of upgrade levels', () => {
        useCharacterStore.setState({ character: makeChar() });
        useSkillStore.setState({
            skillUpgradeLevels: {
                fireball: 4,
                ice_lance: 2,
                shield_bash: 6,
            },
        });
        renderHook(() => useLeaderboardStatSync());
        const call = (characterApi.bumpStat as ReturnType<typeof vi.fn>).mock.calls
            .find((c) => c[0]?.column === 'skill_upgrades_done');
        expect(call?.[0].value).toBe(12);
        expect(call?.[0].mode).toBe('set');
    });

    it('fires all four bump calls in one pass', () => {
        useCharacterStore.setState({ character: makeChar() });
        renderHook(() => useLeaderboardStatSync());
        expect(characterApi.bumpStat).toHaveBeenCalledTimes(4);
    });

    it('passes the current character id to every bump call', () => {
        useCharacterStore.setState({ character: makeChar('hero-99') });
        renderHook(() => useLeaderboardStatSync());
        const calls = (characterApi.bumpStat as ReturnType<typeof vi.fn>).mock.calls;
        for (const [args] of calls) {
            expect(args.characterId).toBe('hero-99');
        }
    });

    it('does NOT re-fire on subsequent re-renders for the same character', () => {
        useCharacterStore.setState({ character: makeChar('same-id') });
        const { rerender } = renderHook(() => useLeaderboardStatSync());
        expect(characterApi.bumpStat).toHaveBeenCalledTimes(4);
        useCharacterStore.setState({
            character: { ...makeChar('same-id'), gold: 999 } as ICharacter,
        });
        rerender();
        const ids = (characterApi.bumpStat as ReturnType<typeof vi.fn>).mock.calls
            .map((c) => c[0]?.characterId);
        expect(ids.filter((i) => i === 'same-id').length).toBe(4);
    });

    it('re-fires when the character actually switches (different id)', () => {
        useCharacterStore.setState({ character: makeChar('alpha') });
        const { rerender } = renderHook(() => useLeaderboardStatSync());
        expect(characterApi.bumpStat).toHaveBeenCalledTimes(4);
        useCharacterStore.setState({ character: makeChar('beta') });
        rerender();
        expect(characterApi.bumpStat).toHaveBeenCalledTimes(8);
    });
});
