import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * TaskTracker — floating per-task progress card. Hidden on auth /
 * character-select / tasks routes, and when there are no active tasks
 * or no character.
 */

const navigateMock = vi.fn();
vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
    return {
        ...actual,
        useNavigate: () => navigateMock,
    };
});

import TaskTracker from './TaskTracker';
import { useTaskStore, type IActiveTask } from '../../../stores/taskStore';
import { useCharacterStore } from '../../../stores/characterStore';
import type { ICharacter } from '../../../api/v1/characterApi';

const makeChar = (): ICharacter => ({
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
} as ICharacter);

const makeTask = (overrides: Partial<IActiveTask> = {}): IActiveTask => ({
    id: 'task-1',
    monsterId: 'goblin',
    monsterLevel: 5,
    monsterName: 'Goblin',
    killCount: 100,
    rewardGold: 500,
    rewardXp: 1000,
    progress: 0,
    startedAt: new Date().toISOString(),
    ...overrides,
});

beforeEach(() => {
    navigateMock.mockReset();
    useCharacterStore.setState({ character: makeChar() });
    useTaskStore.setState({ activeTasks: [] });
});

afterEach(() => {
    cleanup();
    useTaskStore.setState({ activeTasks: [] });
});

const renderAt = (path: string) =>
    render(
        <MemoryRouter initialEntries={[path]}>
            <TaskTracker />
        </MemoryRouter>,
    );

describe('TaskTracker — visibility', () => {
    it('renders nothing when there is no character', () => {
        useCharacterStore.setState({ character: null });
        useTaskStore.setState({ activeTasks: [makeTask()] });
        const { container } = renderAt('/inventory');
        expect(container.querySelector('.task-tracker')).toBeNull();
    });

    it('renders nothing when there are no active tasks', () => {
        const { container } = renderAt('/inventory');
        expect(container.querySelector('.task-tracker')).toBeNull();
    });

    it('renders nothing on /login (hidden path)', () => {
        useTaskStore.setState({ activeTasks: [makeTask()] });
        const { container } = renderAt('/login');
        expect(container.querySelector('.task-tracker')).toBeNull();
    });

    it('renders nothing on /tasks (we are already there)', () => {
        useTaskStore.setState({ activeTasks: [makeTask()] });
        const { container } = renderAt('/tasks');
        expect(container.querySelector('.task-tracker')).toBeNull();
    });

    it('renders a card for each active task', () => {
        useTaskStore.setState({
            activeTasks: [
                makeTask({ id: 't1', monsterName: 'Goblin', progress: 10 }),
                makeTask({ id: 't2', monsterName: 'Orc', progress: 5 }),
            ],
        });
        renderAt('/inventory');
        expect(screen.getByText('Goblin')).toBeTruthy();
        expect(screen.getByText('Orc')).toBeTruthy();
        // Two distinct tracker items.
        expect(document.querySelectorAll('.task-tracker__item').length).toBe(2);
    });
});

describe('TaskTracker — interactions', () => {
    it('navigates to /tasks when a task card is clicked', () => {
        useTaskStore.setState({ activeTasks: [makeTask()] });
        renderAt('/inventory');
        fireEvent.click(document.querySelector('.task-tracker__item')!);
        expect(navigateMock).toHaveBeenCalledWith('/tasks');
    });

    it('marks a completed task with the --done modifier', () => {
        useTaskStore.setState({
            activeTasks: [makeTask({ progress: 100, killCount: 100 })],
        });
        renderAt('/inventory');
        expect(document.querySelector('.task-tracker__item--done')).toBeTruthy();
    });

    it('renders progress / killCount counter', () => {
        useTaskStore.setState({
            activeTasks: [makeTask({ progress: 17, killCount: 100 })],
        });
        renderAt('/inventory');
        expect(screen.getByText('17')).toBeTruthy();
        expect(screen.getByText('100')).toBeTruthy();
    });
});
