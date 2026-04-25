import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useCharacterStore } from '../../stores/characterStore';
import { useInventoryStore } from '../../stores/inventoryStore';
import { useDailyQuestStore } from '../../stores/dailyQuestStore';
import { scaleRewards } from '../../systems/dailyQuestSystem';
import type { DailyQuestGoalType } from '../../systems/dailyQuestSystem';
import './DailyQuests.scss';

const GOAL_LABELS: Record<DailyQuestGoalType, string> = {
    kill_any: 'Zabij potworow',
    earn_gold: 'Zdobadz zlota',
    complete_dungeon: 'Ukoncz dungeonow',
    kill_boss: 'Pokonaj bossow',
    use_potion: 'Uzyj potionow',
    deal_damage: 'Zadaj obrazen',
};

const GOAL_ICONS: Record<DailyQuestGoalType, string> = {
    kill_any: '\u2694\uFE0F',
    earn_gold: '\uD83D\uDCB0',
    complete_dungeon: '\uD83C\uDFF0',
    kill_boss: '\uD83D\uDC79',
    use_potion: '\uD83E\uDDEA',
    deal_damage: '\uD83D\uDCA5',
};

const DailyQuests = () => {
    const navigate = useNavigate();
    const character = useCharacterStore((s) => s.character);
    const addGold = useInventoryStore((s) => s.addGold);
    const addXp = useCharacterStore((s) => s.addXp);
    const addConsumable = useInventoryStore((s) => s.addConsumable);
    const { activeQuests, todayQuestDefs, refreshIfNeeded, claimReward } = useDailyQuestStore();

    useEffect(() => {
        if (character) {
            refreshIfNeeded(character.level);
        }
    }, [character, refreshIfNeeded]);

    if (!character) return null;

    const isLocked = character.level < 25;
    const claimedCount = activeQuests.filter((q) => q.claimed).length;
    const completedCount = activeQuests.filter((q) => q.completed).length;
    const totalCount = activeQuests.length;

    const handleClaim = (questId: string) => {
        const rewards = claimReward(questId, character.level);
        if (!rewards) return;
        addGold(rewards.gold);
        addXp(rewards.xp);
        if (rewards.elixir) {
            addConsumable(rewards.elixir, 1);
        }
    };

    return (
        <div className="daily-quests">
            <header className="daily-quests__header page-header">
                <button className="daily-quests__back page-back-btn" onClick={() => navigate('/')}>
                    \u2190 Miasto
                </button>
                <h1 className="daily-quests__title page-title">📅 Questy Dzienne</h1>
            </header>

            {isLocked ? (
                <div className="daily-quests__locked">
                    <span className="daily-quests__locked-icon">\uD83D\uDD12</span>
                    <p>Questy dzienne odblokuja sie na poziomie 25</p>
                    <p className="daily-quests__locked-sub">Twoj poziom: {character.level}</p>
                </div>
            ) : (
                <>
                    <div className="daily-quests__summary">
                        <div className="daily-quests__counter">
                            <span className="daily-quests__counter-done">{claimedCount}</span>
                            <span className="daily-quests__counter-sep">/</span>
                            <span className="daily-quests__counter-total">{totalCount}</span>
                            <span className="daily-quests__counter-label">odebrane</span>
                        </div>
                        <div className="daily-quests__summary-bar">
                            <div
                                className="daily-quests__summary-fill"
                                style={{ width: `${totalCount > 0 ? (claimedCount / totalCount) * 100 : 0}%` }}
                            />
                        </div>
                        <span className="daily-quests__summary-text">
                            {completedCount > claimedCount
                                ? `${completedCount - claimedCount} do odebrania!`
                                : claimedCount === totalCount
                                  ? 'Wszystkie odebrane!'
                                  : `${totalCount - completedCount} w trakcie`}
                        </span>
                    </div>

                    <div className="daily-quests__list">
                        {todayQuestDefs.map((def, idx) => {
                            const active = activeQuests.find((a) => a.questId === def.id);
                            if (!active) return null;
                            const rewards = scaleRewards(def.rewards, character.level);
                            const pct = Math.min(1, active.progress / def.goal.count);
                            const goalIcon = GOAL_ICONS[def.goal.type] ?? '';

                            return (
                                <motion.div
                                    key={def.id}
                                    className={`daily-quests__quest${active.claimed ? ' daily-quests__quest--claimed' : active.completed ? ' daily-quests__quest--completed' : ''}`}
                                    initial={{ opacity: 0, y: 8 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ delay: idx * 0.03 }}
                                >
                                    <div className="daily-quests__quest-header">
                                        <span className="daily-quests__quest-icon">{goalIcon}</span>
                                        <h3 className="daily-quests__quest-name">{def.name_pl}</h3>
                                        {active.claimed && <span className="daily-quests__badge daily-quests__badge--claimed">Odebrane</span>}
                                        {!active.claimed && active.completed && <span className="daily-quests__badge daily-quests__badge--ready">Gotowe!</span>}
                                    </div>

                                    <p className="daily-quests__quest-desc">{def.description_pl}</p>

                                    <div className="daily-quests__progress">
                                        <div className="daily-quests__progress-bar">
                                            <div
                                                className="daily-quests__progress-fill"
                                                style={{ width: `${pct * 100}%` }}
                                            />
                                        </div>
                                        <span className="daily-quests__progress-text">
                                            {active.progress} / {def.goal.count} {GOAL_LABELS[def.goal.type] ?? ''}
                                        </span>
                                    </div>

                                    <div className="daily-quests__rewards">
                                        <span className="daily-quests__reward">\uD83D\uDCB0 {rewards.gold}g</span>
                                        <span className="daily-quests__reward">\u2728 {rewards.xp} XP</span>
                                        {rewards.elixir && <span className="daily-quests__reward">\uD83E\uDDEA Eliksir</span>}
                                    </div>

                                    {active.completed && !active.claimed && (
                                        <button
                                            className="daily-quests__claim-btn"
                                            onClick={() => handleClaim(def.id)}
                                        >
                                            Odbierz nagrode
                                        </button>
                                    )}
                                </motion.div>
                            );
                        })}

                        {todayQuestDefs.length === 0 && (
                            <p className="daily-quests__empty">Brak questow na dzis. Wejdz jutro!</p>
                        )}
                    </div>
                </>
            )}
        </div>
    );
};

export default DailyQuests;
