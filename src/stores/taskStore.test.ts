import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useTaskStore, type ITask } from './taskStore';


const addGoldMock = vi.fn();
const addXpMock = vi.fn();

vi.mock('./inventoryStore', () => ({
    useInventoryStore: {
        getState: () => ({
            addGold: addGoldMock,
        }),
    },
}));

vi.mock('./characterStore', () => ({
    useCharacterStore: {
        getState: () => ({
            addXp: addXpMock,
        }),
    },
}));


const makeTask = (overrides: Partial<ITask> = {}): ITask => ({
    id: 'task_rat_10',
    monsterId: 'rat',
    monsterLevel: 1,
    monsterName: 'Szczur',
    killCount: 10,
    rewardGold: 100,
    rewardXp: 50,
    ...overrides,
});


const resetStore = (): void => {
    useTaskStore.setState({
        activeTask: null,
        activeTasks: [],
        completedTasks: [],
    });
    addGoldMock.mockClear();
    addXpMock.mockClear();
};


describe('taskStore — initial state', () => {
    beforeEach(resetStore);

    it('starts with no active or completed tasks', () => {
        const s = useTaskStore.getState();
        expect(s.activeTask).toBeNull();
        expect(s.activeTasks).toEqual([]);
        expect(s.completedTasks).toEqual([]);
    });
});

describe('taskStore — startTask (addTask)', () => {
    beforeEach(resetStore);

    it('registers a new active task with progress 0 and startedAt timestamp', () => {
        const task = makeTask();
        useTaskStore.getState().startTask(task);
        const s = useTaskStore.getState();
        expect(s.activeTasks).toHaveLength(1);
        expect(s.activeTasks[0].id).toBe(task.id);
        expect(s.activeTasks[0].progress).toBe(0);
        expect(typeof s.activeTasks[0].startedAt).toBe('string');
        expect(s.activeTask?.id).toBe(task.id);
    });

    it('refuses to add a duplicate task for the same monster', () => {
        useTaskStore.getState().startTask(makeTask({ id: 'a', monsterId: 'rat' }));
        useTaskStore.getState().startTask(makeTask({ id: 'b', monsterId: 'rat' }));
        expect(useTaskStore.getState().activeTasks).toHaveLength(1);
    });

    it('refuses to add a task with the same id twice', () => {
        useTaskStore.getState().startTask(makeTask({ id: 'a', monsterId: 'rat' }));
        useTaskStore.getState().startTask(makeTask({ id: 'a', monsterId: 'goblin' }));
        expect(useTaskStore.getState().activeTasks).toHaveLength(1);
    });

    it('allows multiple parallel tasks for different monsters', () => {
        useTaskStore.getState().startTask(makeTask({ id: 'a', monsterId: 'rat' }));
        useTaskStore.getState().startTask(makeTask({ id: 'b', monsterId: 'goblin' }));
        useTaskStore.getState().startTask(makeTask({ id: 'c', monsterId: 'spider' }));
        expect(useTaskStore.getState().activeTasks).toHaveLength(3);
    });
});

describe('taskStore — addKill', () => {
    beforeEach(resetStore);

    it('increments the progress of an active task matching the monster id', () => {
        useTaskStore.getState().startTask(makeTask({ monsterId: 'rat', killCount: 10 }));
        useTaskStore.getState().addKill('rat', 1);
        expect(useTaskStore.getState().activeTasks[0].progress).toBe(1);
    });

    it('respects an explicit kill count (e.g. bulk SKIP)', () => {
        useTaskStore.getState().startTask(makeTask({ monsterId: 'rat', killCount: 100 }));
        useTaskStore.getState().addKill('rat', 1, 25);
        expect(useTaskStore.getState().activeTasks[0].progress).toBe(25);
    });

    it('defaults to +1 progress when killCount is omitted', () => {
        useTaskStore.getState().startTask(makeTask({ monsterId: 'rat', killCount: 10 }));
        useTaskStore.getState().addKill('rat', 1);
        useTaskStore.getState().addKill('rat', 1);
        expect(useTaskStore.getState().activeTasks[0].progress).toBe(2);
    });

    it('does nothing when no task matches the killed monster', () => {
        useTaskStore.getState().startTask(makeTask({ monsterId: 'rat' }));
        useTaskStore.getState().addKill('goblin', 1);
        expect(useTaskStore.getState().activeTasks[0].progress).toBe(0);
    });

    it('only updates the task matching the monster id (parallel tasks isolated)', () => {
        useTaskStore.getState().startTask(makeTask({ id: 'a', monsterId: 'rat' }));
        useTaskStore.getState().startTask(makeTask({ id: 'b', monsterId: 'goblin' }));
        useTaskStore.getState().addKill('rat', 1, 5);
        const s = useTaskStore.getState();
        expect(s.activeTasks.find((t) => t.id === 'a')?.progress).toBe(5);
        expect(s.activeTasks.find((t) => t.id === 'b')?.progress).toBe(0);
    });

    it('can exceed the killCount target (claimReward is the gate, not addKill)', () => {
        useTaskStore.getState().startTask(makeTask({ monsterId: 'rat', killCount: 10 }));
        useTaskStore.getState().addKill('rat', 1, 50);
        expect(useTaskStore.getState().activeTasks[0].progress).toBe(50);
    });
});

describe('taskStore — claimReward (claimTask)', () => {
    beforeEach(resetStore);

    it('is a no-op when no task with the id exists', () => {
        useTaskStore.getState().claimReward('non-existent');
        expect(addGoldMock).not.toHaveBeenCalled();
        expect(addXpMock).not.toHaveBeenCalled();
    });

    it('is a no-op when progress is below killCount', () => {
        useTaskStore.getState().startTask(makeTask({ id: 'a', monsterId: 'rat', killCount: 10 }));
        useTaskStore.getState().addKill('rat', 1, 5);
        useTaskStore.getState().claimReward('a');
        expect(addGoldMock).not.toHaveBeenCalled();
        expect(addXpMock).not.toHaveBeenCalled();
        expect(useTaskStore.getState().activeTasks).toHaveLength(1);
    });

    it('pays out rewards and removes the task when completed', () => {
        useTaskStore.getState().startTask(makeTask({
            id: 'a', monsterId: 'rat', killCount: 10, rewardGold: 100, rewardXp: 50,
        }));
        useTaskStore.getState().addKill('rat', 1, 10);
        useTaskStore.getState().claimReward('a');
        expect(addGoldMock).toHaveBeenCalledTimes(1);
        expect(addXpMock).toHaveBeenCalledTimes(1);
        expect(addGoldMock.mock.calls[0][0]).toBeGreaterThan(0);
        expect(addXpMock.mock.calls[0][0]).toBeGreaterThan(0);
        expect(useTaskStore.getState().activeTasks).toHaveLength(0);
    });

    it('records a completedTask entry with metadata', () => {
        useTaskStore.getState().startTask(makeTask({
            id: 'a', monsterId: 'rat', killCount: 10, monsterName: 'Szczur',
        }));
        useTaskStore.getState().addKill('rat', 1, 10);
        useTaskStore.getState().claimReward('a');
        const s = useTaskStore.getState();
        expect(s.completedTasks).toHaveLength(1);
        expect(s.completedTasks[0].monsterName).toBe('Szczur');
        expect(s.completedTasks[0].taskId).toBe('a');
        expect(typeof s.completedTasks[0].completedAt).toBe('string');
    });

    it('keeps at most 20 completed tasks (FIFO drop)', () => {
        const seeded = Array.from({ length: 20 }, (_, i) => ({
            id: `completed_${i}`,
            taskId: `task_${i}`,
            monsterName: 'Mob',
            killCount: 1,
            rewardGold: 0,
            rewardXp: 0,
            completedAt: new Date().toISOString(),
        }));
        useTaskStore.setState({ completedTasks: seeded });
        useTaskStore.getState().startTask(makeTask({
            id: 'fresh', monsterId: 'rat', killCount: 1,
        }));
        useTaskStore.getState().addKill('rat', 1, 1);
        useTaskStore.getState().claimReward('fresh');
        const s = useTaskStore.getState();
        expect(s.completedTasks).toHaveLength(20);
        expect(s.completedTasks[0].taskId).toBe('fresh');
        expect(s.completedTasks.find((t) => t.taskId === 'task_19')).toBeUndefined();
    });

    it('falls back to the stored reward values when monster is missing from JSON', () => {
        useTaskStore.getState().startTask(makeTask({
            id: 'unknown',
            monsterId: 'fictional_monster_id_xyz',
            killCount: 1,
            rewardGold: 42,
            rewardXp: 99,
        }));
        useTaskStore.getState().addKill('fictional_monster_id_xyz', 1, 1);
        useTaskStore.getState().claimReward('unknown');
        expect(addGoldMock).toHaveBeenCalledWith(42);
        expect(addXpMock).toHaveBeenCalledWith(99);
    });
});

describe('taskStore — cancelTask', () => {
    beforeEach(resetStore);

    it('removes an active task without paying out', () => {
        useTaskStore.getState().startTask(makeTask({ id: 'a' }));
        useTaskStore.getState().cancelTask('a');
        expect(useTaskStore.getState().activeTasks).toHaveLength(0);
        expect(addGoldMock).not.toHaveBeenCalled();
        expect(addXpMock).not.toHaveBeenCalled();
    });

    it('is a no-op when the id does not match any active task', () => {
        useTaskStore.getState().startTask(makeTask({ id: 'a' }));
        useTaskStore.getState().cancelTask('nope');
        expect(useTaskStore.getState().activeTasks).toHaveLength(1);
    });
});

describe('taskStore — hasTaskForMonster (hasActiveTask)', () => {
    beforeEach(resetStore);

    it('returns false when no tasks are active', () => {
        expect(useTaskStore.getState().hasTaskForMonster('rat')).toBe(false);
    });

    it('returns true for a monster with an active task', () => {
        useTaskStore.getState().startTask(makeTask({ monsterId: 'rat' }));
        expect(useTaskStore.getState().hasTaskForMonster('rat')).toBe(true);
    });

    it('returns false for a monster without an active task (multi-task setup)', () => {
        useTaskStore.getState().startTask(makeTask({ id: 'a', monsterId: 'rat' }));
        useTaskStore.getState().startTask(makeTask({ id: 'b', monsterId: 'goblin' }));
        expect(useTaskStore.getState().hasTaskForMonster('spider')).toBe(false);
    });
});

describe('taskStore — getTaskForMonster (getActiveTask)', () => {
    beforeEach(resetStore);

    it('returns undefined when no task targets the monster', () => {
        expect(useTaskStore.getState().getTaskForMonster('rat')).toBeUndefined();
    });

    it('returns the active task matching the monster id', () => {
        useTaskStore.getState().startTask(makeTask({ id: 'a', monsterId: 'rat' }));
        const task = useTaskStore.getState().getTaskForMonster('rat');
        expect(task?.id).toBe('a');
        expect(task?.monsterId).toBe('rat');
    });

    it('returns the right one when multiple tasks are active', () => {
        useTaskStore.getState().startTask(makeTask({ id: 'a', monsterId: 'rat' }));
        useTaskStore.getState().startTask(makeTask({ id: 'b', monsterId: 'goblin' }));
        const found = useTaskStore.getState().getTaskForMonster('goblin');
        expect(found?.id).toBe('b');
    });
});
