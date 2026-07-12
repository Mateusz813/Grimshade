import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';


vi.mock('framer-motion', async () => {
    const actual = await vi.importActual<typeof import('framer-motion')>('framer-motion');
    return {
        ...actual,
        AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
        motion: new Proxy({}, {
            get: () => (props: Record<string, unknown>) => {
                const { children, ...rest } = props as { children?: React.ReactNode };
                return <div {...(rest as Record<string, unknown>)}>{children}</div>;
            },
        }),
    };
});

vi.mock('../../hooks/useCombatFx', () => ({
    useCombatFx: () => ({
        enemyFloats: {},
        allyFloats: {},
        enemySkill: {},
        allySkill: {},
        allySummonSpawn: {},
        pushEnemyFloat: vi.fn(),
        pushAllyFloat: vi.fn(),
        triggerEnemySkillAnim: vi.fn(),
        triggerAllySkillAnim: vi.fn(),
        triggerAllySummonSpawn: vi.fn(),
        resetFx: vi.fn(),
        resetAllyFx: vi.fn(),
    }),
}));

import ArenaMatch from './ArenaMatch';
import { useArenaStore } from '../../stores/arenaStore';
import { useCharacterStore } from '../../stores/characterStore';
import { useSkillStore } from '../../stores/skillStore';
import { useTransformStore } from '../../stores/transformStore';
import { getSeasonStart } from '../../systems/arenaSystem';
import type { ICharacter } from '../../api/v1/characterApi';
import type { IArenaCompetitor, IArenaInstance } from '../../types/arena';

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

const makeOpponent = (id: string): IArenaCompetitor => ({
    id,
    name: 'Rival',
    class: 'Mage',
    level: 5,
    color: '#7b1fa2',
    leaguePoints: 500,
    leaguePointsAchievedAt: new Date().toISOString(),
    seasonArenaPoints: 5000,
    isBot: true,
    defense: {
        maxHp: 100, maxMp: 60, attack: 12, defense: 10,
        skillSlots: [null, null, null, null],
        snapshotAt: new Date().toISOString(),
    },
    completedTransforms: [],
});

const seedMatchCtx = (opponentId: string = 'bot_bronze_1') => {
    sessionStorage.setItem('arena.match', JSON.stringify({
        arenaId: 'bronze_42',
        myCompetitorId: 'player_char-1',
        opponentId,
        attackerIsHigher: false,
        opponentName: 'Rival',
        opponentClass: 'Mage',
        opponentLevel: 5,
    }));
};

const seedArenaWithOpponent = (opponentId: string = 'bot_bronze_1') => {
    const arena: IArenaInstance = {
        id: 'bronze_42',
        league: 'bronze',
        competitors: [makeOpponent(opponentId)],
    };
    useArenaStore.setState({
        currentArena: arena,
        seasonStartIso: getSeasonStart().toISOString(),
        dailyAttempts: { day: new Date().toISOString().slice(0, 10), count: 0 },
        matchLog: [],
        pendingRewards: null,
    });
};

const renderMatch = () =>
    render(
        <MemoryRouter>
            <ArenaMatch />
        </MemoryRouter>,
    );

beforeEach(() => {
    useCharacterStore.setState({ character: makeChar() });
    useSkillStore.setState({ activeSkillSlots: [null, null, null, null], skillLevels: {} });
    useTransformStore.setState({ completedTransforms: [] });
    sessionStorage.clear();
});

afterEach(() => {
    cleanup();
    sessionStorage.clear();
});

describe('ArenaMatch — smoke', () => {
    it('renders the .arena.arena--match root when ctx + character + arena are present', () => {
        seedMatchCtx();
        seedArenaWithOpponent();
        const { container } = renderMatch();
        expect(container.querySelector('.arena--match')).not.toBeNull();
    });

    it('mounts the combat HUD shell (.combat-ui from CombatHudHost)', () => {
        seedMatchCtx();
        seedArenaWithOpponent();
        const { container } = renderMatch();
        expect(container.querySelector('.combat-ui')).not.toBeNull();
    });
});

describe('ArenaMatch — fallback "Brak kontekstu walki"', () => {
    it('renders the fallback when sessionStorage ctx is missing', () => {
        seedArenaWithOpponent();
        const { container } = renderMatch();
        expect(container.querySelector('.arena--match')).toBeNull();
        expect(container.textContent).toMatch(/Brak kontekstu walki/i);
    });

    it('renders the fallback when character is null', () => {
        seedMatchCtx();
        seedArenaWithOpponent();
        useCharacterStore.setState({ character: null });
        const { container } = renderMatch();
        expect(container.textContent).toMatch(/Brak kontekstu walki/i);
    });

    it('renders the fallback when currentArena is null', () => {
        seedMatchCtx();
        useArenaStore.setState({ currentArena: null });
        const { container } = renderMatch();
        expect(container.textContent).toMatch(/Brak kontekstu walki/i);
    });
});

describe('ArenaMatch — class variants', () => {
    it('mounts when the player is a Mage (different skill set)', () => {
        seedMatchCtx();
        seedArenaWithOpponent();
        useCharacterStore.setState({ character: makeChar({ class: 'Mage' }) });
        const { container } = renderMatch();
        expect(container.querySelector('.arena--match')).not.toBeNull();
    });

    it('mounts when the opponent class is Necromancer', () => {
        seedMatchCtx();
        const arena: IArenaInstance = {
            id: 'bronze_42',
            league: 'bronze',
            competitors: [{ ...makeOpponent('bot_bronze_1'), class: 'Necromancer' }],
        };
        useArenaStore.setState({
            currentArena: arena,
            seasonStartIso: getSeasonStart().toISOString(),
            dailyAttempts: { day: new Date().toISOString().slice(0, 10), count: 0 },
            matchLog: [],
            pendingRewards: null,
        });
        const { container } = renderMatch();
        expect(container.querySelector('.arena--match')).not.toBeNull();
    });
});

