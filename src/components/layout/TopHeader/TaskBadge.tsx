import { useState, useRef, useEffect } from 'react';
import { useTaskStore } from '../../../stores/taskStore';
import { useQuestStore, getQuestById } from '../../../stores/questStore';
import { useCharacterStore } from '../../../stores/characterStore';
import { useCombatStore } from '../../../stores/combatStore';
import monstersData from '../../../data/monsters.json';
import GameIcon from '../../atoms/Twemoji/GameIcon';

interface IBadgeRow {
    id: string;
    kind: 'task' | 'quest';
    label: string;
    progress: number;
    goal: number;
    completed: boolean;
    monsterId?: string;
    live?: boolean;
}

interface IProps {
    claimableCount?: number;
}

const monstersById = new Map<string, { name_pl: string }>(
    (monstersData as Array<{ id: string; name_pl: string }>).map((m) => [m.id, m]),
);

const TaskBadge = ({ claimableCount = 0 }: IProps) => {
    const activeTasks = useTaskStore((s) => s.activeTasks);
    const activeQuests = useQuestStore((s) => s.activeQuests);
    const charLevel = useCharacterStore((s) => s.character?.level ?? 0);
    const combatPhase = useCombatStore((s) => s.phase);
    const combatBackgroundActive = useCombatStore((s) => s.backgroundActive);
    const combatMonster = useCombatStore((s) => s.monster);
    const combatBaseMonster = useCombatStore((s) => s.baseMonster);
    const inActiveCombat = combatPhase !== 'idle' || combatBackgroundActive;
    const liveMonsterId = inActiveCombat
        ? (combatBaseMonster?.id ?? combatMonster?.id ?? null)
        : null;
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const onDoc = (e: MouseEvent) => {
            if (!ref.current?.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', onDoc);
        return () => document.removeEventListener('mousedown', onDoc);
    }, [open]);

    const rawRows: IBadgeRow[] = [
        ...activeTasks.map<IBadgeRow>((t) => {
            const m = monstersById.get(t.monsterId);
            const name = m?.name_pl ?? t.monsterName ?? t.monsterId;
            return {
                id: `task-${t.id}`,
                kind: 'task',
                label: `${name} ×${t.killCount}`,
                progress: t.progress,
                goal: t.killCount,
                completed: t.progress >= t.killCount,
                monsterId: t.monsterId,
                live: liveMonsterId === t.monsterId,
            };
        }),
        ...activeQuests.flatMap<IBadgeRow>((aq) => {
            const quest = getQuestById(aq.questId);
            if (quest && quest.minLevel > charLevel) return [];
            const questName = quest?.name_pl ?? aq.questId;
            return aq.goals
                .filter((g) => g.type === 'kill')
                .map<IBadgeRow>((g) => {
                    const progress = g.progress ?? 0;
                    return {
                        id: `quest-${aq.questId}-${g.monsterId ?? ''}`,
                        kind: 'quest',
                        label: questName,
                        progress,
                        goal: g.count,
                        completed: progress >= g.count,
                        monsterId: g.monsterId,
                        live: !!g.monsterId && liveMonsterId === g.monsterId,
                    };
                });
        }),
    ];

    const rows: IBadgeRow[] = [
        ...rawRows.filter((r) => r.live && !r.completed),
        ...rawRows.filter((r) => r.completed),
        ...rawRows.filter((r) => !r.live && !r.completed),
    ];

    if (rows.length === 0) return null;

    const hasClaim = claimableCount > 0;
    const hasLive = rows.some((r) => r.live && !r.completed);
    const dotState: 'claim' | 'live' | 'none' =
        hasClaim ? 'claim' : hasLive ? 'live' : 'none';
    const ariaLabel = hasClaim
        ? `Aktywne zadania (${rows.length}) — ${claimableCount} do odebrania`
        : hasLive
            ? `Aktywne zadania (${rows.length}) — task aktywny w walce`
            : `Aktywne zadania (${rows.length})`;

    return (
        <div className="top-header__tasks" ref={ref}>
            <button
                type="button"
                className={[
                    'top-header__tasks-btn',
                    open ? 'top-header__tasks-btn--open' : '',
                    hasClaim ? 'top-header__tasks-btn--claimable' : '',
                    hasLive && !hasClaim ? 'top-header__tasks-btn--live' : '',
                ].filter(Boolean).join(' ')}
                onClick={() => setOpen((o) => !o)}
                aria-expanded={open}
                aria-label={ariaLabel}
            >
                <span className="top-header__tasks-icon">{hasClaim ? <GameIcon name="wrapped-gift" /> : <GameIcon name="clipboard" />}</span>
                <span className="top-header__tasks-count">{rows.length}</span>
                {dotState !== 'none' && (
                    <span
                        className={`top-header__tasks-status-dot top-header__tasks-status-dot--${dotState}`}
                        aria-hidden="true"
                    />
                )}
            </button>

            {open && (
                <div className="top-header__tasks-dropdown" role="menu">
                    {rows.map((q) => (
                        <div
                            key={q.id}
                            className={[
                                'top-header__task-row',
                                q.completed ? 'top-header__task-row--done' : '',
                                q.live && !q.completed ? 'top-header__task-row--live' : '',
                            ].filter(Boolean).join(' ')}
                        >
                            <span className="top-header__task-row-icon">
                                {q.completed ? <GameIcon name="check-mark-button" /> : q.kind === 'task' ? <GameIcon name="clipboard" /> : <GameIcon name="scroll" />}
                            </span>
                            <span className="top-header__task-row-label">
                                {q.label}
                                {q.live && !q.completed && (
                                    <span className="top-header__task-row-live-tag">
                                        <span className="top-header__task-row-live-dot" aria-hidden="true" />
                                        LIVE
                                    </span>
                                )}
                            </span>
                            <span className="top-header__task-row-progress">
                                {Math.min(q.progress, q.goal)}/{q.goal}
                            </span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default TaskBadge;
