import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { applyCombatLeaveDeath, type TLeaveSource } from './combatLeavePenalty';
import { useCharacterStore } from '../stores/characterStore';
import { useSkillStore } from '../stores/skillStore';
import { useInventoryStore } from '../stores/inventoryStore';
import { useDeathStore } from '../stores/deathStore';
import { useCombatStore } from '../stores/combatStore';
import { deathsApi } from '../api/v1/deathsApi';
import type { ICharacter } from '../api/v1/characterApi';

const backendFlag = vi.hoisted(() => ({ on: false }));
const backendApiMock = vi.hoisted(() => ({
    logDeath: vi.fn(),
}));
vi.mock('../config/backendMode', () => ({
    isBackendMode: () => backendFlag.on,
    isBackendConfigured: () => backendFlag.on,
    getBackendBaseUrl: () => (backendFlag.on ? 'http://localhost:8088' : ''),
    setBackendMode: (v: boolean) => { backendFlag.on = v; },
}));
vi.mock('../api/backend/backendApi', () => ({ backendApi: backendApiMock }));
const commitMock = vi.hoisted(() => ({ commitStateViaKeepalive: vi.fn(), commitStateToBackend: vi.fn() }));
vi.mock('../api/backend/commit', () => commitMock);


const makeCharacter = (overrides: Partial<ICharacter> = {}): ICharacter => ({
    id: 'char-test-1',
    user_id: 'user-1',
    name: 'Hero',
    class: 'Knight',
    level: 50,
    xp: 1234,
    hp: 100,
    max_hp: 100,
    mp: 50,
    max_mp: 50,
    attack: 20,
    defense: 10,
    attack_speed: 2.0,
    crit_chance: 0.05,
    crit_damage: 2.0,
    magic_level: 0,
    hp_regen: 0,
    mp_regen: 0,
    gold: 0,
    stat_points: 0,
    highest_level: 50,
    equipment: {},
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    ...overrides,
});

const resetStores = (): void => {
    useCharacterStore.setState({ character: null, isLoading: false });
    useInventoryStore.setState({
        bag: [],
        equipment: {
            helmet: null, armor: null, pants: null, gloves: null, shoulders: null,
            boots: null, mainHand: null, offHand: null, ring1: null, ring2: null,
            earrings: null, necklace: null,
        },
        deposit: [],
        gold: 0,
        arenaPoints: 0,
        consumables: {},
        stones: {},
    });
    useSkillStore.setState({
        skillLevels: {},
        skillXp: {},
        activeSkillSlots: [null, null, null, null],
        skillUpgradeLevels: {},
        unlockedSkills: {},
        offlineTrainingSkillId: null,
        trainingSegmentStartedAt: null,
        trainingAccumulatedEffectiveSeconds: 0,
        trainingCurrentSpeedMultiplier: 2,
    });
    useDeathStore.setState({ event: null });
    useCombatStore.getState().resetCombat();
};

let fetchSpy: ReturnType<typeof vi.spyOn>;
let logDeathSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
    resetStores();
    backendFlag.on = false;
    backendApiMock.logDeath.mockReset().mockResolvedValue(undefined);
    fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response(null, { status: 204 }));
    logDeathSpy = vi
        .spyOn(deathsApi, 'logDeath')
        .mockResolvedValue(null);
});

afterEach(() => {
    fetchSpy.mockRestore();
    logDeathSpy.mockRestore();
});


describe('applyCombatLeaveDeath – guard clauses', () => {
    it('no-ops cleanly when there is no active character', () => {
        useCharacterStore.setState({ character: null });
        expect(() => applyCombatLeaveDeath({
            source: 'dungeon',
            sourceName: 'Some Dungeon',
            sourceLevel: 5,
        })).not.toThrow();
        expect(useDeathStore.getState().event).toBeNull();
    });

    it('does not call deathsApi when no character is set', () => {
        useCharacterStore.setState({ character: null });
        applyCombatLeaveDeath({
            source: 'boss',
            sourceName: 'Skeleton King',
            sourceLevel: 25,
        });
        expect(logDeathSpy).not.toHaveBeenCalled();
    });
});


describe('applyCombatLeaveDeath – tryb backendu (regresja anti-cheat)', () => {
    it('utrwala karę autorytatywnym commitem stanu (keepalive), NIE surowym PATCH-em Supabase', () => {
        backendFlag.on = true;
        commitMock.commitStateViaKeepalive.mockClear();
        useCharacterStore.setState({ character: makeCharacter({ level: 50, xp: 1234 }) });

        applyCombatLeaveDeath({ source: 'dungeon', sourceName: 'Loch', sourceLevel: 5 });

        expect(commitMock.commitStateViaKeepalive).toHaveBeenCalledWith('char-test-1');
        const rawSupabaseWrites = fetchSpy.mock.calls.filter(
            (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('/rest/v1/characters'),
        );
        expect(rawSupabaseWrites).toHaveLength(0);
    });
});


describe('applyCombatLeaveDeath – store effects', () => {
    it('logs the leave via deathsApi with result=fled', () => {
        useCharacterStore.setState({ character: makeCharacter({ level: 100, xp: 5000 }) });
        applyCombatLeaveDeath({
            source: 'boss',
            sourceName: 'Skeleton King',
            sourceLevel: 100,
        });
        expect(logDeathSpy).toHaveBeenCalledTimes(1);
        const payload = logDeathSpy.mock.calls[0][0];
        expect(payload.result).toBe('fled');
        expect(payload.source).toBe('boss');
        expect(payload.source_name).toBe('Skeleton King');
        expect(payload.source_level).toBe(100);
    });

    it('records the character level BEFORE penalty in the death log', () => {
        useCharacterStore.setState({ character: makeCharacter({ level: 100, xp: 5000 }) });
        applyCombatLeaveDeath({
            source: 'monster',
            sourceName: 'Wyvern',
            sourceLevel: 100,
        });
        const payload = logDeathSpy.mock.calls[0][0];
        expect(payload.character_level).toBe(100);
    });

    it('updates the character with the post-penalty level + xp', () => {
        useCharacterStore.setState({ character: makeCharacter({ level: 100, xp: 5000 }) });
        applyCombatLeaveDeath({
            source: 'dungeon',
            sourceName: 'Crypt',
            sourceLevel: 100,
        });
        const ch = useCharacterStore.getState().character;
        expect(ch?.level).toBe(99);
        expect(ch?.xp).toBe(4925);
    });

    it('preserves highest_level as the max of the previous highest and level-at-leave', () => {
        useCharacterStore.setState({ character: makeCharacter({ level: 100, xp: 5000, highest_level: 105 }) });
        applyCombatLeaveDeath({
            source: 'monster',
            sourceName: 'X',
            sourceLevel: 100,
        });
        const ch = useCharacterStore.getState().character;
        expect(ch?.highest_level).toBe(105);
    });

    it('promotes highest_level to current level when it was lower', () => {
        useCharacterStore.setState({ character: makeCharacter({ level: 80, xp: 0, highest_level: 60 }) });
        applyCombatLeaveDeath({
            source: 'monster',
            sourceName: 'X',
            sourceLevel: 80,
        });
        const ch = useCharacterStore.getState().character;
        expect(ch?.highest_level).toBe(80);
    });

    it('full-heals the character to effective max HP/MP after the penalty', () => {
        useCharacterStore.setState({
            character: makeCharacter({
                hp: 1, mp: 1, max_hp: 200, max_mp: 100, level: 100, xp: 0,
            }),
        });
        applyCombatLeaveDeath({
            source: 'monster',
            sourceName: 'X',
            sourceLevel: 100,
        });
        const ch = useCharacterStore.getState().character;
        expect(ch?.hp).toBe(200);
        expect(ch?.mp).toBe(100);
    });

    it('triggers the global death overlay with the leave context', () => {
        useCharacterStore.setState({ character: makeCharacter({ level: 100, xp: 5000 }) });
        applyCombatLeaveDeath({
            source: 'transform',
            sourceName: 'Wolf Form',
            sourceLevel: 50,
        });
        const ev = useDeathStore.getState().event;
        expect(ev).not.toBeNull();
        expect(ev?.killedBy).toBe('Wolf Form');
        expect(ev?.sourceLevel).toBe(50);
        expect(ev?.source).toBe('transform');
        expect(ev?.protectionUsed).toBe(false);
        expect(ev?.oldLevel).toBe(100);
        expect(ev?.newLevel).toBe(99);
        expect(ev?.levelsLost).toBe(1);
    });

    it('clears the active combat session after applying the penalty', () => {
        useCharacterStore.setState({ character: makeCharacter({ level: 100, xp: 5000 }) });
        useCombatStore.setState({
            sessionXpEarned: 999,
            sessionGoldEarned: 999,
            sessionDrops: [{ icon: 'crossed-swords', name: 'X', rarity: 'common' }],
        });
        applyCombatLeaveDeath({
            source: 'raid',
            sourceName: 'Raid Boss',
            sourceLevel: 100,
        });
        const cs = useCombatStore.getState();
        expect(cs.sessionXpEarned).toBe(0);
        expect(cs.sessionGoldEarned).toBe(0);
        expect(cs.sessionDrops.length).toBe(0);
    });

    it('reports skillXpLossPercent in the death overlay (25% for death penalty)', () => {
        useCharacterStore.setState({ character: makeCharacter({ level: 100, xp: 5000 }) });
        applyCombatLeaveDeath({
            source: 'boss',
            sourceName: 'B',
            sourceLevel: 100,
        });
        const ev = useDeathStore.getState().event;
        expect(ev?.skillXpLossPercent).toBe(25);
    });

    it('passes the source name verbatim (no "(uciekłeś z gry)" suffix per 2026-05-19 spec)', () => {
        useCharacterStore.setState({ character: makeCharacter({ level: 100 }) });
        applyCombatLeaveDeath({
            source: 'monster',
            sourceName: 'Plain Rat',
            sourceLevel: 1,
        });
        const ev = useDeathStore.getState().event;
        const payload = logDeathSpy.mock.calls[0][0];
        expect(ev?.killedBy).toBe('Plain Rat');
        expect(payload.source_name).toBe('Plain Rat');
    });
});


describe('applyCombatLeaveDeath – level 1 corner case', () => {
    it('keeps level 1 at level 1 but drains its XP (clamped at the floor)', () => {
        useCharacterStore.setState({ character: makeCharacter({ level: 1, xp: 50, highest_level: 1 }) });
        applyCombatLeaveDeath({
            source: 'monster',
            sourceName: 'Tutorial Rat',
            sourceLevel: 1,
        });
        const ch = useCharacterStore.getState().character;
        expect(ch?.level).toBe(1);
        expect(ch?.xp).toBe(0);
    });

    it('records levelsLost=0 in the death overlay at level 1', () => {
        useCharacterStore.setState({ character: makeCharacter({ level: 1, xp: 50 }) });
        applyCombatLeaveDeath({
            source: 'monster',
            sourceName: 'X',
            sourceLevel: 1,
        });
        const ev = useDeathStore.getState().event;
        expect(ev?.levelsLost).toBe(0);
        expect(ev?.newLevel).toBe(1);
    });
});


describe('applyCombatLeaveDeath – source coverage', () => {
    const sources: TLeaveSource[] = ['monster', 'dungeon', 'boss', 'raid', 'transform'];

    for (const source of sources) {
        it(`accepts source="${source}"`, () => {
            useCharacterStore.setState({ character: makeCharacter({ level: 60 }) });
            applyCombatLeaveDeath({ source, sourceName: 'X', sourceLevel: 10 });
            const payload = logDeathSpy.mock.calls[0][0];
            expect(payload.source).toBe(source);
            const ev = useDeathStore.getState().event;
            expect(ev?.source).toBe(source);
        });
    }
});


describe('applyCombatLeaveDeath – penalty math anchors', () => {
    it('lvl 1000 loses 10 levels (the spec anchor: level/100)', () => {
        useCharacterStore.setState({ character: makeCharacter({ level: 1000, xp: 0, highest_level: 1000 }) });
        applyCombatLeaveDeath({
            source: 'monster',
            sourceName: 'X',
            sourceLevel: 1000,
        });
        const ch = useCharacterStore.getState().character;
        expect(ch?.level).toBe(990);
        const ev = useDeathStore.getState().event;
        expect(ev?.levelsLost).toBe(10);
    });

    it('lvl 49 loses 1 level (max(0.20, 0.49) = 0.49 of a level)', () => {
        useCharacterStore.setState({ character: makeCharacter({ level: 49, xp: 1000, highest_level: 49 }) });
        applyCombatLeaveDeath({
            source: 'monster',
            sourceName: 'X',
            sourceLevel: 49,
        });
        const ch = useCharacterStore.getState().character;
        expect(ch?.level).toBe(48);
    });

    it('lvl 50 loses exactly 1 level', () => {
        useCharacterStore.setState({ character: makeCharacter({ level: 50, xp: 1000, highest_level: 50 }) });
        applyCombatLeaveDeath({
            source: 'monster',
            sourceName: 'X',
            sourceLevel: 50,
        });
        const ch = useCharacterStore.getState().character;
        expect(ch?.level).toBe(49);
    });
});


describe('applyCombatLeaveDeath – callers must guard idempotency', () => {
    it('a second consecutive call applies penalty again (no internal guard)', () => {
        useCharacterStore.setState({ character: makeCharacter({ level: 100, xp: 0, highest_level: 100 }) });
        applyCombatLeaveDeath({
            source: 'monster',
            sourceName: 'X',
            sourceLevel: 100,
        });
        expect(useCharacterStore.getState().character?.level).toBe(99);

        applyCombatLeaveDeath({
            source: 'monster',
            sourceName: 'X',
            sourceLevel: 100,
        });
        expect(useCharacterStore.getState().character?.level).toBe(98);
        expect(logDeathSpy).toHaveBeenCalledTimes(2);
    });
});


describe('applyCombatLeaveDeath – backend mode routes the death log', () => {
    it('calls backendApi.logDeath (char id + trimmed payload) and SKIPS deathsApi', () => {
        backendFlag.on = true;
        useCharacterStore.setState({ character: makeCharacter({ id: 'char-9', level: 100, xp: 5000 }) });
        applyCombatLeaveDeath({
            source: 'boss',
            sourceName: 'Skeleton King',
            sourceLevel: 100,
        });
        expect(logDeathSpy).not.toHaveBeenCalled();
        expect(backendApiMock.logDeath).toHaveBeenCalledTimes(1);
        expect(backendApiMock.logDeath).toHaveBeenCalledWith('char-9', {
            source: 'boss',
            source_name: 'Skeleton King',
            source_level: 100,
            result: 'fled',
        });
    });

    it('still applies the local level/XP penalty in backend mode (penalty logic unchanged)', () => {
        backendFlag.on = true;
        useCharacterStore.setState({ character: makeCharacter({ level: 100, xp: 5000, highest_level: 100 }) });
        applyCombatLeaveDeath({
            source: 'dungeon',
            sourceName: 'Crypt',
            sourceLevel: 100,
        });
        const ch = useCharacterStore.getState().character;
        expect(ch?.level).toBe(99);
    });

    it('with the flag OFF the old client path runs (deathsApi called, backendApi not)', () => {
        backendFlag.on = false;
        useCharacterStore.setState({ character: makeCharacter({ level: 100, xp: 5000 }) });
        applyCombatLeaveDeath({
            source: 'raid',
            sourceName: 'Raid Boss',
            sourceLevel: 100,
        });
        expect(logDeathSpy).toHaveBeenCalledTimes(1);
        expect(backendApiMock.logDeath).not.toHaveBeenCalled();
    });
});
