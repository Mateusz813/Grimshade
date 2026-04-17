import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTaskStore } from '../../stores/taskStore';
import type { ITask } from '../../stores/taskStore';
import { useMasteryStore, MASTERY_MAX_LEVEL, MASTERY_KILL_THRESHOLD } from '../../stores/masteryStore';
import { useCharacterStore } from '../../stores/characterStore';
import { getMonsterUnlockStatus } from '../../systems/progression';
import tasksRaw from '../../data/tasks.json';
import monstersData from '../../data/monsters.json';
import { computeTaskRewards } from '../../systems/taskRewards';
import './Tasks.scss';

interface IMonsterMini {
  id: string;
  level: number;
  name_pl: string;
  xp: number;
  gold: [number, number];
}

const monsters = monstersData as unknown as IMonsterMini[];

// Recompute rewards from live monster data so tasks stay in sync with rebalance.
const allTasks = (tasksRaw as ITask[]).map((t) => {
  const monster = monsters.find((m) => m.id === t.monsterId);
  if (!monster) return t;
  const { rewardGold, rewardXp } = computeTaskRewards(monster, t.killCount);
  return { ...t, rewardGold, rewardXp };
});

type TabType = 'available' | 'history';

const MAX_ACTIVE_TASKS = 2;

const Tasks = () => {
  const navigate = useNavigate();
  const [tab, setTab] = useState<TabType>('available');
  const {
    activeTasks,
    completedTasks,
    startTask,
    claimReward,
    cancelTask,
  } = useTaskStore();
  const masteries = useMasteryStore((s) => s.masteries);
  const masteryKills = useMasteryStore((s) => s.masteryKills);
  const character = useCharacterStore((s) => s.character);
  const characterLevel = character?.level ?? 1;

  const getUnlockForMonster = (monsterId: string) => {
    const monster = monsters.find((m) => m.id === monsterId);
    if (!monster) return { unlocked: true as const };
    return getMonsterUnlockStatus(monster, monsters, characterLevel, masteries);
  };

  const handleStartTask = (task: ITask) => {
    if (activeTasks.length >= MAX_ACTIVE_TASKS) return;
    if (activeTasks.some((t) => t.monsterId === task.monsterId)) return;
    const unlock = getUnlockForMonster(task.monsterId);
    if (!unlock.unlocked) return;
    startTask(task);
  };

  const handleClaimReward = (taskId: string) => {
    claimReward(taskId);
  };

  // Sort tasks by monster level, then by kill count
  const sortedTasks = [...allTasks].sort((a, b) => {
    if (a.monsterLevel !== b.monsterLevel) return a.monsterLevel - b.monsterLevel;
    return a.killCount - b.killCount;
  });

  // Group tasks by monster
  const tasksByMonster = sortedTasks.reduce<Record<string, ITask[]>>((acc, task) => {
    const key = task.monsterId;
    if (!acc[key]) acc[key] = [];
    acc[key].push(task);
    return acc;
  }, {});

  // Helper: is a specific monster already taken?
  const monsterHasActiveTask = (monsterId: string) =>
    activeTasks.some((t) => t.monsterId === monsterId);

  // Helper: render inline mastery bar for a monster (only when kills > 0 or level > 0)
  const renderMasteryBar = (monsterId: string) => {
    const level = masteries[monsterId]?.level ?? 0;
    const kills = masteryKills[monsterId] ?? 0;
    if (level === 0 && kills === 0) return null;
    const isMax = level >= MASTERY_MAX_LEVEL;
    const required = isMax ? 0 : MASTERY_KILL_THRESHOLD * (level + 1);
    const pct = isMax ? 100 : Math.min(100, Math.floor((kills / required) * 100));
    return (
      <div className={`tasks__inline-mastery${isMax ? ' tasks__inline-mastery--max' : ''}`}>
        <span className={`tasks__inline-mastery-badge${isMax ? ' tasks__inline-mastery-badge--max' : ''}`}>
          {isMax ? '👑 MAX' : `Mastery ${level}/${MASTERY_MAX_LEVEL}`}
        </span>
        {!isMax && (
          <div className="tasks__inline-mastery-bar-wrap">
            <div className="tasks__inline-mastery-bar">
              <div
                className="tasks__inline-mastery-bar-fill"
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="tasks__inline-mastery-kills">
              {kills.toLocaleString('pl-PL')}/{required.toLocaleString('pl-PL')}
            </span>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="tasks">
      <header className="tasks__header">
        <button className="tasks__back" onClick={() => navigate('/')}>← Miasto</button>
        <h1 className="tasks__title">📋 Taski</h1>
        <span className="tasks__slots-badge">
          {activeTasks.length}/{MAX_ACTIVE_TASKS}
        </span>
      </header>

      {/* Active tasks banners */}
      {activeTasks.length > 0 && (
        <div className="tasks__active-list">
          {activeTasks.map((activeTask) => {
            const isComplete = activeTask.progress >= activeTask.killCount;
            const pct = Math.min(100, Math.floor((activeTask.progress / activeTask.killCount) * 100));
            return (
              <div key={activeTask.id} className="tasks__active">
                <div className="tasks__active-header">
                  <span className="tasks__active-label">
                    Aktywny Task {activeTasks.length > 1 ? `(${activeTasks.indexOf(activeTask) + 1}/${activeTasks.length})` : ''}
                  </span>
                  <button
                    className="tasks__cancel-btn"
                    onClick={() => cancelTask(activeTask.id)}
                    title="Anuluj task"
                  >
                    ✕
                  </button>
                </div>
                <div className="tasks__active-title">
                  Zabij {activeTask.killCount.toLocaleString('pl-PL')} × {activeTask.monsterName}
                </div>
                <div className="tasks__active-progress-row">
                  <div className="tasks__active-bar">
                    <div
                      className="tasks__active-bar-fill"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="tasks__active-count">
                    {activeTask.progress.toLocaleString('pl-PL')} / {activeTask.killCount.toLocaleString('pl-PL')}
                  </span>
                </div>
                <div className="tasks__active-reward">
                  Nagroda: 💰 {activeTask.rewardGold.toLocaleString('pl-PL')} gold · ⭐ {activeTask.rewardXp.toLocaleString('pl-PL')} XP
                </div>
                {isComplete && (
                  <button className="tasks__claim-btn" onClick={() => handleClaimReward(activeTask.id)}>
                    🎁 Odbierz nagrode
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="tasks__tabs">
        <button
          className={`tasks__tab${tab === 'available' ? ' tasks__tab--active' : ''}`}
          onClick={() => setTab('available')}
        >
          Dostepne taski
        </button>
        <button
          className={`tasks__tab${tab === 'history' ? ' tasks__tab--active' : ''}`}
          onClick={() => setTab('history')}
        >
          Historia ({completedTasks.length})
        </button>
      </div>

      {tab === 'available' && (
        <div className="tasks__list">
          {Object.entries(tasksByMonster).map(([monsterId, tasks]) => {
            const monsterTaken = monsterHasActiveTask(monsterId);
            const slotsFullOrMonsterTaken = activeTasks.length >= MAX_ACTIVE_TASKS || monsterTaken;
            const unlock = getUnlockForMonster(monsterId);
            const isLocked = !unlock.unlocked;
            return (
              <div key={monsterId} className={`tasks__monster-group-wrap${isLocked ? ' tasks__monster-group-wrap--locked' : ''}`}>
                {renderMasteryBar(monsterId)}
                <div className={`tasks__monster-group${monsterTaken ? ' tasks__monster-group--taken' : ''}${isLocked ? ' tasks__monster-group--locked' : ''}`} title={isLocked ? unlock.reason : undefined}>
                  <div className="tasks__monster-header">
                    <span className="tasks__monster-name">
                      {tasks[0].monsterName}
                      {monsterTaken && <span className="tasks__monster-active-badge">📋 Aktywny</span>}
                      {isLocked && <span className="tasks__monster-locked-badge">{unlock.shortLabel}</span>}
                    </span>
                    <span className="tasks__monster-level">Lvl {tasks[0].monsterLevel}</span>
                  </div>
                  <div className="tasks__threshold-list">
                    {tasks.map((task) => {
                      const activeForThis = activeTasks.find((t) => t.id === task.id);
                      const isActive = !!activeForThis;
                      const isCompleted = isActive && activeForThis!.progress >= activeForThis!.killCount;
                      // Disable if: slots full and not this task's active, or monster already taken by another task, or monster locked
                      const isDisabled = !isActive && (slotsFullOrMonsterTaken || isLocked);
                      return (
                        <button
                          key={task.id}
                          className={[
                            'tasks__threshold-btn',
                            isActive ? 'tasks__threshold-btn--active' : '',
                            isCompleted ? 'tasks__threshold-btn--done' : '',
                          ].filter(Boolean).join(' ')}
                          onClick={() => handleStartTask(task)}
                          disabled={isDisabled}
                          title={
                            isLocked && !isActive
                              ? unlock.reason
                              : activeTasks.length >= MAX_ACTIVE_TASKS && !isActive
                                ? 'Masz juz 2 aktywne taski'
                                : monsterTaken && !isActive
                                  ? 'Masz juz task na tego potwora'
                                  : undefined
                          }
                        >
                          <span className="tasks__threshold-kills">
                            {isActive ? `${activeForThis!.progress}/` : ''}{task.killCount} zabojstw
                          </span>
                          <span className="tasks__threshold-reward">
                            💰 {task.rewardGold.toLocaleString('pl-PL')}g · ⭐ {task.rewardXp.toLocaleString('pl-PL')} XP
                          </span>
                          {isCompleted && <span className="tasks__threshold-done">✓ Gotowe!</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tab === 'history' && (
        <div className="tasks__history">
          {completedTasks.length === 0 ? (
            <p className="tasks__empty">Brak ukonczonych taskow.</p>
          ) : (
            completedTasks.map((ct) => (
              <div key={ct.id} className="tasks__history-item">
                <div className="tasks__history-name">
                  ✓ {ct.killCount.toLocaleString('pl-PL')} × {ct.monsterName}
                </div>
                <div className="tasks__history-reward">
                  💰 +{ct.rewardGold.toLocaleString('pl-PL')}g · ⭐ +{(ct.rewardXp || 0).toLocaleString('pl-PL')} XP
                </div>
                <div className="tasks__history-date">
                  {new Date(ct.completedAt).toLocaleDateString('pl-PL')}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};

export default Tasks;
