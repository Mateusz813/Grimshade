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
