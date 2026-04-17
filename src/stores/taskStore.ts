import { create } from 'zustand';
import { useCharacterStore } from './characterStore';
import { useInventoryStore } from './inventoryStore';
import { useMasteryStore } from './masteryStore';
import monstersData from '../data/monsters.json';
import { computeTaskRewards, type IMonsterRewardSource } from '../systems/taskRewards';

const monstersList = monstersData as unknown as (IMonsterRewardSource & { id: string })[];

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ITask {
  id: string;
  monsterId: string;
  monsterLevel: number;
  monsterName: string;
  killCount: number;
  rewardGold: number;
  rewardXp: number;
}

export interface IActiveTask extends ITask {
  progress: number;
  startedAt: string;
}

export interface ICompletedTask {
  id: string;
  taskId: string;
  monsterName: string;
  killCount: number;
  rewardGold: number;
  rewardXp: number;
  completedAt: string;
}

/** Maximum number of simultaneous active REGULAR tasks. */
const MAX_ACTIVE_TASKS = 2;

interface ITaskStore {
  /** @deprecated Use activeTasks instead. Kept for migration. */
  activeTask: IActiveTask | null;
  activeTasks: IActiveTask[];
  completedTasks: ICompletedTask[];
  startTask: (task: ITask) => void;
  addKill: (monsterId: string, monsterLevel: number, killCount?: number) => void;
  claimReward: (taskId: string) => void;
  cancelTask: (taskId: string) => void;
  /** Helper: check if a specific monster already has an active task. */
  hasTaskForMonster: (monsterId: string) => boolean;
  /** Helper: get active task for a specific monster (if any). */
  getTaskForMonster: (monsterId: string) => IActiveTask | undefined;
}

// ── Store ─────────────────────────────────────────────────────────────────────

export const useTaskStore = create<ITaskStore>()(
    (set, get) => ({
      activeTask: null,
      activeTasks: [],
      completedTasks: [],

      startTask: (task) => {
        const { activeTasks } = get();
        // Max 2 active regular tasks
        if (activeTasks.length >= MAX_ACTIVE_TASKS) return;
        // Cannot take two tasks for the same monster
        if (activeTasks.some((t) => t.monsterId === task.monsterId)) return;
        // Cannot take a task that is already active (same task id)
        if (activeTasks.some((t) => t.id === task.id)) return;

        const newTask: IActiveTask = {
          ...task,
          progress: 0,
          startedAt: new Date().toISOString(),
        };

        set({
          activeTasks: [...activeTasks, newTask],
          // Keep activeTask in sync (first task) for backward compat
          activeTask: activeTasks.length === 0 ? newTask : get().activeTask,
        });
      },

      addKill: (monsterId, _monsterLevel, killCount = 1) => {
        const { activeTasks } = get();

        // Update regular tasks
        const idx = activeTasks.findIndex((t) => t.monsterId === monsterId);
        if (idx !== -1) {
          const updated = [...activeTasks];
          updated[idx] = {
            ...updated[idx],
            progress: updated[idx].progress + killCount,
          };
          set({
            activeTasks: updated,
            activeTask: updated[0] ?? null,
          });
        }

        // Auto-track mastery kills (replaces old mastery task system)
        useMasteryStore.getState().addMasteryKills(monsterId, killCount);
      },

      claimReward: (taskId: string) => {
        const { activeTasks, completedTasks } = get();

        // Regular task claim
        const task = activeTasks.find((t) => t.id === taskId);
        if (!task) return;
        if (task.progress < task.killCount) return;

        // Recompute rewards from live monster data to guarantee any stale
        // numbers baked into in-progress tasks (pre-rebalance) are corrected.
        const monster = monstersList.find((m) => m.id === task.monsterId);
        const fresh = monster
          ? computeTaskRewards(monster, task.killCount)
          : { rewardGold: task.rewardGold, rewardXp: task.rewardXp };

        // Add rewards
        useInventoryStore.getState().addGold(fresh.rewardGold);
        useCharacterStore.getState().addXp(fresh.rewardXp);

        const completed: ICompletedTask = {
          id: `completed_${Date.now()}`,
          taskId: task.id,
          monsterName: task.monsterName,
          killCount: task.killCount,
          rewardGold: fresh.rewardGold,
          rewardXp: fresh.rewardXp,
          completedAt: new Date().toISOString(),
        };

        // Keep last 20 completed tasks
        const newCompleted = [completed, ...completedTasks].slice(0, 20);
        const remaining = activeTasks.filter((t) => t.id !== taskId);

        set({
          activeTasks: remaining,
          activeTask: remaining[0] ?? null,
          completedTasks: newCompleted,
        });
      },

      cancelTask: (taskId: string) => {
        const { activeTasks } = get();

        // Cancel regular task
        const remaining = activeTasks.filter((t) => t.id !== taskId);
        set({
          activeTasks: remaining,
          activeTask: remaining[0] ?? null,
        });
      },

      hasTaskForMonster: (monsterId: string) => {
        return get().activeTasks.some((t) => t.monsterId === monsterId);
      },

      getTaskForMonster: (monsterId: string) => {
        return get().activeTasks.find((t) => t.monsterId === monsterId);
      },
    }),
);
