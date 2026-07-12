import { create } from 'zustand';
import { useCharacterStore } from './characterStore';
import { useInventoryStore } from './inventoryStore';
import monstersData from '../data/monsters.json';
import { computeTaskRewards, type IMonsterRewardSource } from '../systems/taskRewards';

const monstersList = monstersData as unknown as (IMonsterRewardSource & { id: string })[];


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


interface ITaskStore {
  activeTask: IActiveTask | null;
  activeTasks: IActiveTask[];
  completedTasks: ICompletedTask[];
  startTask: (task: ITask) => void;
  addKill: (monsterId: string, monsterLevel: number, killCount?: number) => void;
  claimReward: (taskId: string) => void;
  cancelTask: (taskId: string) => void;
  hasTaskForMonster: (monsterId: string) => boolean;
  getTaskForMonster: (monsterId: string) => IActiveTask | undefined;
}


export const useTaskStore = create<ITaskStore>()(
    (set, get) => ({
      activeTask: null,
      activeTasks: [],
      completedTasks: [],

      startTask: (task) => {
        const { activeTasks } = get();
        if (activeTasks.some((t) => t.monsterId === task.monsterId)) return;
        if (activeTasks.some((t) => t.id === task.id)) return;

        const newTask: IActiveTask = {
          ...task,
          progress: 0,
          startedAt: new Date().toISOString(),
        };

        set({
          activeTasks: [...activeTasks, newTask],
          activeTask: activeTasks.length === 0 ? newTask : get().activeTask,
        });
      },

      addKill: (monsterId, _monsterLevel, killCount = 1) => {
        const { activeTasks } = get();

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

      },

      claimReward: (taskId: string) => {
        const { activeTasks, completedTasks } = get();

        const task = activeTasks.find((t) => t.id === taskId);
        if (!task) return;
        if (task.progress < task.killCount) return;

        const monster = monstersList.find((m) => m.id === task.monsterId);
        const fresh = monster
          ? computeTaskRewards(monster, task.killCount)
          : { rewardGold: task.rewardGold, rewardXp: task.rewardXp };

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
