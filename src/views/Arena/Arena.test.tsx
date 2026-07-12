import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const backendHoisted = vi.hoisted(() => ({
    claimArenaSeasonMock: vi.fn(),
    syncFromBackendMock: vi.fn(),
    backendState: { on: false },
}));

vi.mock('../../config/backendMode', () => ({
    isBackendMode: () => backendHoisted.backendState.on,
}));
vi.mock('../../api/backend/backendApi', () => ({
    backendApi: { claimArenaSeason: backendHoisted.claimArenaSeasonMock },
}));
vi.mock('../../api/backend/syncState', () => ({
    syncFromBackend: backendHoisted.syncFromBackendMock,
}));


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

vi.mock('../../api/v1/characterApi', () => ({
    characterApi: {
        getCharacters: vi.fn().mockResolvedValue([]),
    },
}));

import Arena from './Arena';
import { useArenaStore } from '../../stores/arenaStore';
import { useCharacterStore } from '../../stores/characterStore';
import { useInventoryStore } from '../../stores/inventoryStore';
import { useTransformStore } from '../../stores/transformStore';
import { getSeasonStart } from '../../systems/arenaSystem';
import type { ICharacter } from '../../api/v1/characterApi';
import type { IArenaInstance, IArenaCompetitor } from '../../types/arena';

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

const makeBot = (i: number, lp: number): IArenaCompetitor => ({
    id: `bot_bronze_${i}`,
    name: `Bot${i}`,
    class: 'Knight',
    level: 5,
    color: '#888',
    leaguePoints: lp,
    leaguePointsAchievedAt: new Date(Date.now() - i * 1000).toISOString(),
    seasonArenaPoints: lp * 10,
    isBot: true,
    defense: {
        maxHp: 100, maxMp: 30, attack: 15, defense: 12,
        skillSlots: [null, null, null, null],
        snapshotAt: new Date().toISOString(),
    },
    completedTransforms: [],
});

const makeMe = (id: string, lp: number): IArenaCompetitor => ({
    id: `player_${id}`,
    name: 'Hero',
    class: 'Knight',
    level: 5,
    color: '#e53935',
    leaguePoints: lp,
    leaguePointsAchievedAt: new Date().toISOString(),
    seasonArenaPoints: lp * 10,
    isBot: false,
    defense: {
        maxHp: 100, maxMp: 30, attack: 15, defense: 12,
        skillSlots: [null, null, null, null],
        snapshotAt: new Date().toISOString(),
    },
    completedTransforms: [],
});

const makeArena = (myLp: number = 500): IArenaInstance => {
    const competitors: IArenaCompetitor[] = [
        makeBot(1, myLp + 200),
        makeBot(2, myLp + 100),
        makeMe('char-1', myLp),
        makeBot(3, myLp - 100),
        makeBot(4, myLp - 200),
    ];
    return {
        id: 'bronze_42',
        league: 'bronze',
        competitors,
    };
};

const renderArena = () =>
    render(
        <MemoryRouter>
            <Arena />
        </MemoryRouter>,
    );

beforeEach(() => {
    backendHoisted.backendState.on = false;
    backendHoisted.claimArenaSeasonMock.mockReset();
    backendHoisted.syncFromBackendMock.mockReset();
    useCharacterStore.setState({ character: makeChar() });
    useArenaStore.setState({
        currentArena: makeArena(500),
        seasonStartIso: getSeasonStart().toISOString(),
        dailyAttempts: { day: new Date().toISOString().slice(0, 10), count: 0 },
        defenseSnapshot: {
            maxHp: 100, maxMp: 30, attack: 15, defense: 12,
            skillSlots: [null, null, null, null],
            snapshotAt: new Date().toISOString(),
        },
        matchLog: [],
        pendingRewards: null,
        stats: { matchesWon: 0, matchesDefended: 0 },
    });
    useInventoryStore.setState({ arenaPoints: 1234 });
    useTransformStore.setState({ completedTransforms: [] });
});

afterEach(() => {
    cleanup();
});

describe('Arena — smoke', () => {
    it('renders root .arena container when character + currentArena are present', () => {
        const { container } = renderArena();
        expect(container.querySelector('.arena')).not.toBeNull();
    });

    it('shows a spinner inside .arena when character is null', () => {
        useCharacterStore.setState({ character: null });
        const { container } = renderArena();
        expect(container.querySelector('.arena')).not.toBeNull();
        expect(container.querySelector('.arena__league-strip')).toBeNull();
    });

    it('shows the "Inicjalizuję arenę…" spinner when currentArena is null', () => {
        useArenaStore.setState({
            currentArena: null,
            refreshIfNeeded: () => {},
        });
        renderArena();
        expect(screen.getByText(/Inicjaliz/i)).toBeTruthy();
    });
});

describe('Arena — chrome renders', () => {
    it('renders the league strip with the arena points chip', () => {
        const { container } = renderArena();
        expect(container.querySelector('.arena__league-strip')).not.toBeNull();
        expect(container.querySelector('.arena__league-ap')?.textContent).toMatch(/1.234|1234/);
    });

    it('renders the defense snapshot card (avatar + stats line + walcz button)', () => {
        const { container } = renderArena();
        expect(container.querySelector('.arena__defense')).not.toBeNull();
        expect(container.querySelector('.arena__defense-avatar')).not.toBeNull();
        expect(container.querySelector('.arena__defense-fight')).not.toBeNull();
        const stats = container.querySelector('.arena__defense-stats')?.textContent ?? '';
        expect(stats).toMatch(/HP|ATK|DEF/);
    });

    it('renders the leaderboard list with one .arena__row per competitor', () => {
        const { container } = renderArena();
        const rows = container.querySelectorAll('.arena__row');
        expect(rows.length).toBe(5);
    });

    it('marks the player\'s own row with the --me modifier', () => {
        const { container } = renderArena();
        const meRow = container.querySelector('.arena__row--me');
        expect(meRow).not.toBeNull();
    });

    it('renders my-position summary strip with rank + LP + attempts counter', () => {
        const { container } = renderArena();
        expect(container.querySelector('.arena__pos-strip')).not.toBeNull();
        expect(container.querySelector('.arena__pos-rank')?.textContent).toMatch(/#\d+/);
        expect(container.querySelector('.arena__pos-attempts')?.textContent).toMatch(/0\/10/);
    });
});

describe('Arena — modals open and close', () => {
    it('opens the Rewards modal when the "Nagrody" chip is clicked', () => {
        const { container } = renderArena();
        const rewardsBtn = Array.from(container.querySelectorAll('.arena__action-chip'))
            .find((b) => b.textContent?.includes('Nagrody'));
        expect(rewardsBtn).toBeTruthy();
        fireEvent.click(rewardsBtn!);
        expect(container.querySelector('.arena__modal')).not.toBeNull();
        expect(container.querySelector('.arena__reward-row')).not.toBeNull();
    });

    it('opens the History modal with the empty-state copy when matchLog is empty', () => {
        const { container } = renderArena();
        const historyBtn = Array.from(container.querySelectorAll('.arena__action-chip'))
            .find((b) => b.textContent?.includes('Historia'));
        fireEvent.click(historyBtn!);
        expect(screen.getByText(/Brak walk/i)).toBeTruthy();
    });

    it('opens the Fight picker when the Walcz button is clicked', () => {
        const { container } = renderArena();
        const fightBtn = container.querySelector('.arena__defense-fight') as HTMLButtonElement;
        fireEvent.click(fightBtn);
        expect(screen.getByText(/Wybierz przeciwnika/i)).toBeTruthy();
    });

    it('closes a modal when the × button is clicked', () => {
        const { container } = renderArena();
        const rewardsBtn = Array.from(container.querySelectorAll('.arena__action-chip'))
            .find((b) => b.textContent?.includes('Nagrody'));
        fireEvent.click(rewardsBtn!);
        expect(container.querySelector('.arena__modal')).not.toBeNull();
        const closeBtn = container.querySelector('.arena__modal-close') as HTMLButtonElement;
        fireEvent.click(closeBtn);
        expect(container.querySelector('.arena__modal')).toBeNull();
    });
});

describe('Arena — daily-attempts edge case', () => {
    it('disables the "Walcz" button when the player has used all 10 attempts', () => {
        useArenaStore.setState({
            dailyAttempts: { day: new Date().toISOString().slice(0, 10), count: 10 },
        });
        const { container } = renderArena();
        const fightBtn = container.querySelector('.arena__defense-fight') as HTMLButtonElement;
        expect(fightBtn.disabled).toBe(true);
    });
});

describe('Arena — backend mode season claim', () => {
    const seedClaimable = () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-07-06T12:00:00.000Z'));
        useArenaStore.setState({
            currentArena: makeArena(500),
            seasonStartIso: getSeasonStart().toISOString(),
            pendingRewards: { league: 'bronze', finalRank: 3 },
        });
    };

    afterEach(() => {
        vi.useRealTimers();
    });

    it('claims through the backend + syncs, skipping the client store, when backend mode is on', async () => {
        backendHoisted.backendState.on = true;
        backendHoisted.claimArenaSeasonMock.mockResolvedValue({});
        backendHoisted.syncFromBackendMock.mockResolvedValue(undefined);
        const claimSeasonRewards = vi.fn();
        seedClaimable();
        useArenaStore.setState({ claimSeasonRewards } as never);
        const { container } = renderArena();
        const claimBtn = container.querySelector('.arena__action-chip--claim') as HTMLButtonElement;
        expect(claimBtn).not.toBeNull();
        fireEvent.click(claimBtn);
        await waitFor(() =>
            expect(backendHoisted.claimArenaSeasonMock).toHaveBeenCalledWith('char-1'),
        );
        expect(backendHoisted.syncFromBackendMock).toHaveBeenCalledWith('char-1');
        expect(claimSeasonRewards).not.toHaveBeenCalled();
    });

    it('falls back to the client claimSeasonRewards when backend mode is off', () => {
        backendHoisted.backendState.on = false;
        const claimSeasonRewards = vi.fn().mockReturnValue(null);
        seedClaimable();
        useArenaStore.setState({ claimSeasonRewards } as never);
        const { container } = renderArena();
        const claimBtn = container.querySelector('.arena__action-chip--claim') as HTMLButtonElement;
        expect(claimBtn).not.toBeNull();
        fireEvent.click(claimBtn);
        expect(claimSeasonRewards).toHaveBeenCalledTimes(1);
        expect(backendHoisted.claimArenaSeasonMock).not.toHaveBeenCalled();
    });
});

