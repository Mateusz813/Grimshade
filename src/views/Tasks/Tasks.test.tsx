import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const backendHoisted = vi.hoisted(() => ({
    claimTaskMock: vi.fn(),
    syncFromBackendMock: vi.fn(),
    applyStateResponseMock: vi.fn(),
    backendState: { on: false },
}));

vi.mock('../../config/backendMode', () => ({
    isBackendMode: () => backendHoisted.backendState.on,
}));
vi.mock('../../api/backend/backendApi', () => ({
    backendApi: { claimTask: backendHoisted.claimTaskMock },
}));
vi.mock('../../api/backend/syncState', () => ({
    syncFromBackend: backendHoisted.syncFromBackendMock,
    applyStateResponse: backendHoisted.applyStateResponseMock,
}));


const navigateMock = vi.fn();
vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
    return {
        ...actual,
        useNavigate: () => navigateMock,
    };
});

import Tasks from './Tasks';
import { useCharacterStore } from '../../stores/characterStore';
import { useTaskStore } from '../../stores/taskStore';
import { useMasteryStore } from '../../stores/masteryStore';
import type { ICharacter } from '../../api/v1/characterApi';
import type { IActiveTask, ICompletedTask } from '../../stores/taskStore';

const makeChar = (overrides: Partial<ICharacter> = {}): ICharacter => ({
    id: 'char-1',
    user_id: 'user-1',
    name: 'Hero',
    class: 'Knight',
    level: 50,
    xp: 0,
    hp: 100, max_hp: 100, mp: 30, max_mp: 30,
    attack: 15, defense: 12, attack_speed: 2.0,
    crit_chance: 3, crit_damage: 150, magic_level: 0,
    hp_regen: 0, mp_regen: 0,
    gold: 0, stat_points: 0, highest_level: 50,
    equipment: {},
    created_at: '', updated_at: '',
    ...overrides,
} as ICharacter);

const renderTasks = () =>
    render(
        <MemoryRouter>
            <Tasks />
        </MemoryRouter>,
    );

beforeEach(() => {
    navigateMock.mockClear();
    backendHoisted.backendState.on = false;
    backendHoisted.claimTaskMock.mockReset();
    backendHoisted.syncFromBackendMock.mockReset();
    backendHoisted.applyStateResponseMock.mockReset();
    useCharacterStore.setState({ character: makeChar() });
    useTaskStore.setState({
        activeTask: null,
        activeTasks: [],
        completedTasks: [],
    } as never);
    useMasteryStore.setState({ masteries: {}, masteryKills: {} } as never);
});

afterEach(() => {
    cleanup();
});

describe('Tasks — smoke', () => {
    it('renders the root .tasks container with header + title', () => {
        const { container } = renderTasks();
        expect(container.querySelector('.tasks')).not.toBeNull();
        expect(container.querySelector('.tasks__title')?.textContent).toContain('Taski');
    });

    it('renders the slots badge showing 0/2 by default', () => {
        const { container } = renderTasks();
        const slots = container.querySelector('.tasks__slots-badge');
        expect(slots?.textContent).toBe('0/2');
    });

    it('renders both tabs (Dostepne taski + Historia)', () => {
        const { container } = renderTasks();
        const tabs = container.querySelectorAll('.tasks__tab');
        expect(tabs.length).toBe(2);
        expect(tabs[0].textContent).toContain('Dostepne');
        expect(tabs[1].textContent).toContain('Historia');
    });

    it('marks the Available tab as active by default', () => {
        const { container } = renderTasks();
        const activeTab = container.querySelector('.tasks__tab--active');
        expect(activeTab?.textContent).toContain('Dostepne');
    });
});

describe('Tasks — zepsuty zapis (regresja: pusta strona przez crash renderu)', () => {
    it('renderuje aktywny task z brakującymi polami liczbowymi bez crasha', () => {
        useTaskStore.setState({
            activeTask: null,
            activeTasks: [{ id: 't1', monsterId: 'rat', monsterName: 'Szczur' } as unknown as IActiveTask],
            completedTasks: [],
        } as never);
        const { container } = renderTasks();
        expect(container.querySelector('.tasks')).not.toBeNull();
        expect(container.querySelector('.tasks__active')).not.toBeNull();
    });

    it('renderuje historię z brakującymi polami bez crasha', () => {
        useTaskStore.setState({
            activeTask: null,
            activeTasks: [],
            completedTasks: [{ id: 'c1', monsterId: 'rat', monsterName: 'Szczur', completedAt: '' } as unknown as ICompletedTask],
        } as never);
        const { container } = renderTasks();
        fireEvent.click(container.querySelectorAll('.tasks__tab')[1] as HTMLButtonElement);
        expect(container.querySelector('.tasks__history-item')).not.toBeNull();
    });
});

describe('Tasks — header back navigation', () => {
    it('navigates to "/" when back button is clicked', () => {
        const { container } = renderTasks();
        const back = container.querySelector('.tasks__back') as HTMLButtonElement;
        fireEvent.click(back);
        expect(navigateMock).toHaveBeenCalledWith('/');
    });
});

describe('Tasks — tab switching', () => {
    it('moves the active modifier when Historia tab is clicked', () => {
        const { container } = renderTasks();
        const historyTab = container.querySelectorAll('.tasks__tab')[1] as HTMLButtonElement;
        fireEvent.click(historyTab);
        expect(historyTab.className).toContain('tasks__tab--active');
    });

    it('renders the empty history message when no completed tasks', () => {
        const { container } = renderTasks();
        const historyTab = container.querySelectorAll('.tasks__tab')[1] as HTMLButtonElement;
        fireEvent.click(historyTab);
        expect(container.querySelector('.tasks__empty')?.textContent).toContain('Brak');
    });
});

describe('Tasks — available list', () => {
    it('renders at least one monster group on the available tab (data ships with tasks.json)', () => {
        const { container } = renderTasks();
        const groups = container.querySelectorAll('.tasks__monster-group');
        expect(groups.length).toBeGreaterThan(0);
    });

    it('renders threshold buttons inside each group', () => {
        const { container } = renderTasks();
        const buttons = container.querySelectorAll('.tasks__threshold-btn');
        expect(buttons.length).toBeGreaterThan(0);
    });
});

describe('Tasks — active task banner', () => {
    const activeTask: IActiveTask = {
        id: 'task_rabbit_10',
        monsterId: 'rabbit',
        monsterLevel: 1,
        monsterName: 'Krolik',
        killCount: 10,
        rewardGold: 100,
        rewardXp: 50,
        progress: 5,
        startedAt: '2026-05-22T00:00:00.000Z',
    };

    it('renders the active banner when one task is active', () => {
        useTaskStore.setState({ activeTasks: [activeTask] } as never);
        const { container } = renderTasks();
        expect(container.querySelector('.tasks__active')).not.toBeNull();
        expect(container.querySelector('.tasks__active-title')?.textContent).toContain('Krolik');
    });

    it('updates the slots badge to N/2 when a task is active', () => {
        useTaskStore.setState({ activeTasks: [activeTask] } as never);
        const { container } = renderTasks();
        expect(container.querySelector('.tasks__slots-badge')?.textContent).toBe('1/2');
    });

    it('renders the claim button when progress >= killCount', () => {
        useTaskStore.setState({
            activeTasks: [{ ...activeTask, progress: 10 }],
        } as never);
        const { container } = renderTasks();
        expect(container.querySelector('.tasks__claim-btn')).not.toBeNull();
    });

    it('does NOT render claim button when in-progress', () => {
        useTaskStore.setState({ activeTasks: [activeTask] } as never);
        const { container } = renderTasks();
        expect(container.querySelector('.tasks__claim-btn')).toBeNull();
    });

    it('calls cancelTask when the X cancel button is clicked', () => {
        const cancelTask = vi.fn();
        useTaskStore.setState({ activeTasks: [activeTask], cancelTask } as never);
        const { container } = renderTasks();
        const cancelBtn = container.querySelector('.tasks__cancel-btn') as HTMLButtonElement;
        fireEvent.click(cancelBtn);
        expect(cancelTask).toHaveBeenCalledWith(activeTask.id);
    });

    it('calls claimReward when the claim button is clicked', () => {
        const claimReward = vi.fn();
        useTaskStore.setState({
            activeTasks: [{ ...activeTask, progress: 10 }],
            claimReward,
        } as never);
        const { container } = renderTasks();
        const claimBtn = container.querySelector('.tasks__claim-btn') as HTMLButtonElement;
        fireEvent.click(claimBtn);
        expect(claimReward).toHaveBeenCalledWith(activeTask.id);
    });
});

describe('Tasks — backend mode claim', () => {
    const activeTask: IActiveTask = {
        id: 'task_rabbit_10',
        monsterId: 'rabbit',
        monsterLevel: 1,
        monsterName: 'Krolik',
        killCount: 10,
        rewardGold: 100,
        rewardXp: 50,
        progress: 10,
        startedAt: '2026-05-22T00:00:00.000Z',
    };

    it('applies the claim response inline (no extra state round-trip) when backend mode is on', async () => {
        backendHoisted.backendState.on = true;
        backendHoisted.claimTaskMock.mockResolvedValue({ character: {}, state: {} });
        backendHoisted.applyStateResponseMock.mockReturnValue(true);
        const claimReward = vi.fn();
        useTaskStore.setState({
            activeTasks: [{ ...activeTask, progress: 10 }],
            claimReward,
        } as never);
        const { container } = renderTasks();
        const claimBtn = container.querySelector('.tasks__claim-btn') as HTMLButtonElement;
        fireEvent.click(claimBtn);
        await waitFor(() =>
            expect(backendHoisted.claimTaskMock).toHaveBeenCalledWith('char-1', activeTask.id),
        );
        expect(backendHoisted.applyStateResponseMock).toHaveBeenCalledWith({ character: {}, state: {} }, 'char-1');
        expect(backendHoisted.syncFromBackendMock).not.toHaveBeenCalled();
        expect(claimReward).not.toHaveBeenCalled();
    });

    it('falls back to a full state sync when the claim response carries no state', async () => {
        backendHoisted.backendState.on = true;
        backendHoisted.claimTaskMock.mockResolvedValue({});
        backendHoisted.applyStateResponseMock.mockReturnValue(false);
        backendHoisted.syncFromBackendMock.mockResolvedValue(undefined);
        useTaskStore.setState({
            activeTasks: [{ ...activeTask, progress: 10 }],
            claimReward: vi.fn(),
        } as never);
        const { container } = renderTasks();
        fireEvent.click(container.querySelector('.tasks__claim-btn') as HTMLButtonElement);
        await waitFor(() =>
            expect(backendHoisted.syncFromBackendMock).toHaveBeenCalledWith('char-1'),
        );
    });

    it('falls back to the client claimReward when backend mode is off', () => {
        backendHoisted.backendState.on = false;
        const claimReward = vi.fn();
        useTaskStore.setState({
            activeTasks: [{ ...activeTask, progress: 10 }],
            claimReward,
        } as never);
        const { container } = renderTasks();
        const claimBtn = container.querySelector('.tasks__claim-btn') as HTMLButtonElement;
        fireEvent.click(claimBtn);
        expect(claimReward).toHaveBeenCalledWith(activeTask.id);
        expect(backendHoisted.claimTaskMock).not.toHaveBeenCalled();
    });
});

describe('Tasks — history tab', () => {
    const completed: ICompletedTask = {
        id: 'cmp_rabbit_10',
        taskId: 'task_rabbit_10',
        monsterName: 'Krolik',
        killCount: 10,
        rewardGold: 100,
        rewardXp: 50,
        completedAt: '2026-05-21T12:00:00.000Z',
    };

    it('renders history rows when completedTasks is non-empty', () => {
        useTaskStore.setState({ completedTasks: [completed] } as never);
        const { container } = renderTasks();
        const historyTab = container.querySelectorAll('.tasks__tab')[1] as HTMLButtonElement;
        fireEvent.click(historyTab);
        expect(container.querySelector('.tasks__history-item')).not.toBeNull();
        expect(container.textContent).toContain('Krolik');
    });

    it('reflects the completed count on the History tab label', () => {
        useTaskStore.setState({ completedTasks: [completed, { ...completed, id: 'cmp2' }] } as never);
        const { container } = renderTasks();
        const historyTab = container.querySelectorAll('.tasks__tab')[1] as HTMLButtonElement;
        expect(historyTab.textContent).toContain('(2)');
    });
});

describe('Tasks — edge cases', () => {
    it('handles a null character gracefully (level defaults to 1 inside the view)', () => {
        useCharacterStore.setState({ character: null });
        const { container } = renderTasks();
        expect(container.querySelector('.tasks')).not.toBeNull();
    });
});

