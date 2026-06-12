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
    /** Monster id this row tracks — used to flag the row as "live" when
     *  it matches whatever the player is currently fighting. */
    monsterId?: string;
    /** True when the row's monster is the active combat target. The view
     *  floats live rows to the top and renders them with a green
     *  blinking dot so the player sees their progress ticking. */
    live?: boolean;
}

interface IProps {
    /**
     * Total count of tasks / quests / daily quests that have hit their goal
     * and are waiting to be claimed. When > 0 the badge glows green and a
     * pulsing dot appears next to the count so the player notices from any
     * screen that there's a reward to pick up.
     */
    claimableCount?: number;
}

const monstersById = new Map<string, { name_pl: string }>(
    (monstersData as Array<{ id: string; name_pl: string }>).map((m) => [m.id, m]),
);

/**
 * Global task/quest badge — always visible in the TopHeader (just before
 * the gold counter). Lists ALL active tasks + active kill-quests, regardless
 * of which screen the player is on. Replaces the old per-monster
 * <CombatTaskBadge> that only showed entries for the currently fought
 * enemy. Renders nothing when there's no work in progress.
 */
const TaskBadge = ({ claimableCount = 0 }: IProps) => {
    const activeTasks = useTaskStore((s) => s.activeTasks);
    const activeQuests = useQuestStore((s) => s.activeQuests);
    // Player level — used to hide quests whose `minLevel` is above the
    // current character. Those quests can't actually progress (the store now
    // gates kills by level too), so showing them in the dropdown would just
    // be misleading clutter.
    const charLevel = useCharacterStore((s) => s.character?.level ?? 0);
    // Currently-fought monster — drives the "LIVE" indicator.
    //
    // The naive "use combatStore.monster while phase === 'fighting'"
    // breaks between waves: the engine briefly clears `monster` while
    // it spawns the next wave, so the dropdown row blinks out and
    // back in. We instead read `baseMonster` (the player's CHOSEN
    // target — set on `startNewFight`, cleared on `stopCombat`/death)
    // as the source of truth, and consider the player "in combat" if
    // the hunt is either foreground (`phase !== 'idle'`) or running
    // in the background after a route change. Falls back to the
    // current wave monster if `baseMonster` is somehow missing.
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

    // Click-outside auto-close — same UX as AvatarMenu/BuffPopover.
    useEffect(() => {
        if (!open) return;
        const onDoc = (e: MouseEvent) => {
            if (!ref.current?.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', onDoc);
        return () => document.removeEventListener('mousedown', onDoc);
    }, [open]);

    // Build the unified list — tasks first, then every active kill-quest goal.
    // Each row carries its `monsterId` so we can flag the row as `live`
    // when the player is currently fighting that exact monster.
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
            // Drop quests whose minLevel exceeds the player — they can't
            // progress until the player levels up so showing them adds noise
            // without value. Pairs with the questStore.addProgress level
            // guard so the numbers also stay frozen.
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

    // Sort: live rows first (so the player instantly sees the row that's
    // ticking up while they fight), then claimable rows, then everything
    // else in original order.
    const rows: IBadgeRow[] = [
        ...rawRows.filter((r) => r.live && !r.completed),
        ...rawRows.filter((r) => r.completed),
        ...rawRows.filter((r) => !r.live && !r.completed),
    ];

    if (rows.length === 0) return null;

    const hasClaim = claimableCount > 0;
    const hasLive = rows.some((r) => r.live && !r.completed);
    // Status-dot tone:
    //   - purple pulse -> at least one task / quest is ready to claim
    //   - green pulse  -> no claims yet, but the row for the currently-
    //     fought monster is in progress (the "live" task is ticking)
    //   - no dot       -> nothing live and nothing to collect
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
                {/* Status dot: purple-pulse if anything's claimable, green-
                    pulse if a live task is mid-fight, hidden otherwise. */}
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
