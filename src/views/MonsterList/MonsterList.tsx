import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCombatStore, type IMonster } from '../../stores/combatStore';
import { useTaskStore } from '../../stores/taskStore';
import { useQuestStore, getActiveQuestKillProgress } from '../../stores/questStore';
import { useMasteryStore, MASTERY_MAX_LEVEL, MASTERY_KILL_THRESHOLD, HEROIC_DROP_RATE_AT_MAX } from '../../stores/masteryStore';
import { scaleHeroicDropRate, getPotionDropInfo, HP_POTION_DROP_CHANCE, MP_POTION_DROP_CHANCE, getSpellChestDropInfo, getSpellChestIcon, SPELL_CHEST_BASE_CHANCE, getEffectiveRarityChances, formatRarityChance } from '../../systems/lootSystem';
import { getMonsterAttackRange, MONSTER_STAT_MULTIPLIERS } from '../../systems/combat';
import { getMonsterUnlockStatus } from '../../systems/progression';
import { useCharacterStore } from '../../stores/characterStore';
import monstersRaw from '../../data/monsters.json';
import './MonsterList.scss';

const monsters = (monstersRaw as unknown as IMonster[]).slice().sort((a, b) => a.level - b.level);

const RARITY_THRESHOLDS = [0.55, 0.25, 0.12, 0.05, 0.025, 0.005];
const RARITY_NAMES: { key: string; label: string; color: string }[] = [
  { key: 'common', label: 'Common', color: '#ffffff' },
  { key: 'rare', label: 'Rare', color: '#2196f3' },
  { key: 'epic', label: 'Epic', color: '#4caf50' },
  { key: 'legendary', label: 'Legendary', color: '#f44336' },
  { key: 'mythic', label: 'Mythic', color: '#ffc107' },
  { key: 'heroic', label: 'Heroic', color: '#9c27b0' },
];

const MONSTER_MAX_RARITY_INDEX: Record<string, number> = {
  normal: 0,
  strong: 1,
  epic: 2,
  legendary: 3,
  boss: 4,
};

const DROP_CHANCES: Record<string, number> = { normal: 0.08, strong: 0.12, epic: 0.15, legendary: 0.20, boss: 0.30 };

const STONE_NAMES: Record<string, string> = {
  normal: 'Common Stone',
  strong: 'Rare Stone',
  epic: 'Epic Stone',
  legendary: 'Legendary Stone',
  boss: 'Mythic Stone',
};
const STONE_CHANCES: Record<string, number> = {
  normal: 0.10, strong: 0.07, epic: 0.04, legendary: 0.02, boss: 0.01,
};

const VARIANTS = [
  { key: 'normal',    label: 'Normal',    color: '#9e9e9e', chance: '90%',  hpMult: MONSTER_STAT_MULTIPLIERS.normal.hp,    atkMult: MONSTER_STAT_MULTIPLIERS.normal.atk,    defMult: MONSTER_STAT_MULTIPLIERS.normal.def,    xpMult: MONSTER_STAT_MULTIPLIERS.normal.xp,    goldMult: MONSTER_STAT_MULTIPLIERS.normal.gold },
  { key: 'strong',    label: 'Strong',    color: '#2196f3', chance: '7%',   hpMult: MONSTER_STAT_MULTIPLIERS.strong.hp,    atkMult: MONSTER_STAT_MULTIPLIERS.strong.atk,    defMult: MONSTER_STAT_MULTIPLIERS.strong.def,    xpMult: MONSTER_STAT_MULTIPLIERS.strong.xp,    goldMult: MONSTER_STAT_MULTIPLIERS.strong.gold },
  { key: 'epic',      label: 'Epic',      color: '#4caf50', chance: '1.5%', hpMult: MONSTER_STAT_MULTIPLIERS.epic.hp,      atkMult: MONSTER_STAT_MULTIPLIERS.epic.atk,      defMult: MONSTER_STAT_MULTIPLIERS.epic.def,      xpMult: MONSTER_STAT_MULTIPLIERS.epic.xp,      goldMult: MONSTER_STAT_MULTIPLIERS.epic.gold },
  { key: 'legendary', label: 'Legendary', color: '#f44336', chance: '1%',   hpMult: MONSTER_STAT_MULTIPLIERS.legendary.hp, atkMult: MONSTER_STAT_MULTIPLIERS.legendary.atk, defMult: MONSTER_STAT_MULTIPLIERS.legendary.def, xpMult: MONSTER_STAT_MULTIPLIERS.legendary.xp, goldMult: MONSTER_STAT_MULTIPLIERS.legendary.gold },
  { key: 'boss',      label: 'Boss',      color: '#ffc107', chance: '0.5%', hpMult: MONSTER_STAT_MULTIPLIERS.boss.hp,      atkMult: MONSTER_STAT_MULTIPLIERS.boss.atk,      defMult: MONSTER_STAT_MULTIPLIERS.boss.def,      xpMult: MONSTER_STAT_MULTIPLIERS.boss.xp,      goldMult: MONSTER_STAT_MULTIPLIERS.boss.gold },
];

interface IDropTier {
  key: string;
  label: string;
  color: string;
  chancePerRoll: number;
}

interface IDropBreakdown {
  tiers: IDropTier[];
}

const getDropBreakdown = (variant: string, heroicRateForBoss: number = 0): IDropBreakdown => {
  const maxRarityIdx = MONSTER_MAX_RARITY_INDEX[variant] ?? 0;
  const dropChance = DROP_CHANCES[variant] ?? 0.08;

  const applicableThresholds = RARITY_THRESHOLDS.slice(0, maxRarityIdx + 1);
  const totalWeight = applicableThresholds.reduce((a, b) => a + b, 0);

  const tiers: IDropTier[] = applicableThresholds.map((t, i) => ({
    key: RARITY_NAMES[i].key,
    label: RARITY_NAMES[i].label,
    color: RARITY_NAMES[i].color,
    chancePerRoll: (t / totalWeight) * dropChance * 100,
  }));

  // Show heroic tier in boss variant when mastery is maxed
  if (variant === 'boss' && heroicRateForBoss > 0) {
    tiers.push({
      key: 'heroic',
      label: 'Heroic',
      color: '#9c27b0',
      chancePerRoll: heroicRateForBoss * 100,
    });
  }

  return { tiers };
};

const MonsterList = () => {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState<string | null>(null);
  const { setSelectedMonster } = useCombatStore();
  const activeTasks = useTaskStore((s) => s.activeTasks);
  const activeQuests = useQuestStore((s) => s.activeQuests);
  const masteries = useMasteryStore((s) => s.masteries);
  const masteryKills = useMasteryStore((s) => s.masteryKills);
  const getMasteryBonuses = useMasteryStore((s) => s.getMasteryBonuses);
  const character = useCharacterStore((s) => s.character);
  const characterLevel = character?.level ?? 1;

  /** Get all quest kill goals for a given monster id (includes quest name) */
  const getQuestGoalsForMonster = (monsterId: string) =>
    getActiveQuestKillProgress(activeQuests, monsterId);

  const handleFight = (m: IMonster) => {
    const unlock = getMonsterUnlockStatus(m, monsters, characterLevel, masteries);
    if (!unlock.unlocked) return;
    setSelectedMonster(m);
    navigate('/combat');
  };

  const toggleExpand = (id: string) => {
    setExpanded((prev) => (prev === id ? null : id));
  };

  return (
    <div className="monster-list">
      <header className="monster-list__header">
        <button className="monster-list__back" onClick={() => navigate('/')}>← Miasto</button>
        <h1 className="monster-list__title">🗺️ Lista Potworów</h1>
      </header>

      <div className="monster-list__count">
        {monsters.length} potworów · lvl {monsters[0]?.level}–{monsters[monsters.length - 1]?.level}
      </div>

      <div className="monster-list__grid">
        {monsters.map((m) => {
          const isOpen = expanded === m.id;
          const monsterTask = activeTasks.find((t) => t.monsterId === m.id);
          const hasTask = !!monsterTask;
          const taskPct = hasTask ? Math.min(100, Math.floor((monsterTask.progress / monsterTask.killCount) * 100)) : 0;
          const taskDone = hasTask && monsterTask.progress >= monsterTask.killCount;
          const questGoals = getQuestGoalsForMonster(m.id);
          const hasQuest = questGoals.length > 0;
          const masteryData = masteries[m.id] ?? { level: 0 };
          const isMaxMastery = masteryData.level >= MASTERY_MAX_LEVEL;
          const unlock = getMonsterUnlockStatus(m, monsters, characterLevel, masteries);
          const isLocked = !unlock.unlocked;
          return (
            <div
              key={m.id}
              className={`monster-list__card${hasTask ? ' monster-list__card--task' : ''}${taskDone ? ' monster-list__card--task-done' : ''}${hasQuest ? ' monster-list__card--quest' : ''}${isMaxMastery ? ' monster-list__card--mastery-max' : ''}${isLocked ? ' monster-list__card--locked' : ''}`}
              title={isLocked ? unlock.reason : undefined}
            >
              <div
                className="monster-list__card-main"
                onClick={() => toggleExpand(m.id)}
              >
                <span className="monster-list__sprite">{m.sprite}</span>
                <div className="monster-list__info">
                  <span className="monster-list__name">{m.name_pl}</span>
                  <span className="monster-list__level-badge">Lvl {m.level}</span>
                  {isLocked && (
                    <span className={`monster-list__lock-badge monster-list__lock-badge--${unlock.lockKind}`} title={unlock.reason}>
                      {unlock.shortLabel}
                    </span>
                  )}
                  {isLocked && unlock.lockKind === 'mastery' && unlock.requiredMonster && (() => {
                    const req = unlock.requiredMonster;
                    const killsNow = masteryKills[req.id] ?? 0;
                    const remaining = Math.max(0, MASTERY_KILL_THRESHOLD - killsNow);
                    return (
                      <span className="monster-list__unlock-progress" title={`Zdobądź Mastery 1/25 na ${req.name_pl}`}>
                        🔒 {req.name_pl}: {killsNow.toLocaleString('pl-PL')}/{MASTERY_KILL_THRESHOLD.toLocaleString('pl-PL')} (zostało {remaining.toLocaleString('pl-PL')})
                      </span>
                    );
                  })()}
                  {masteryData.level > 0 && (
                    <span className={`monster-list__mastery-badge${isMaxMastery ? ' monster-list__mastery-badge--max' : ''}`}>
                      {isMaxMastery ? '👑' : '🏅'} Mastery {masteryData.level}/{MASTERY_MAX_LEVEL}
                    </span>
                  )}
                  {hasTask && (
                    <span className="monster-list__task-badge">
                      {taskDone ? '✅' : '📋'} {monsterTask.progress}/{monsterTask.killCount}
                    </span>
                  )}
                  {questGoals.map((qg) => (
                    <span key={qg.questId} className="monster-list__quest-badge" title={qg.questName}>
                      {qg.done ? '✅' : '📜'} {qg.questName}: {qg.progress}/{qg.count}
                    </span>
                  ))}
                </div>
                <div className="monster-list__stats">
                  <span title="HP">❤️ {m.hp.toLocaleString('pl-PL')}</span>
                  {(() => {
                    const r = getMonsterAttackRange(m);
                    return <span title="Attack">⚔️ {r.min}-{r.max}</span>;
                  })()}
                  <span title="Defense">🛡️ {m.defense}</span>
                  <span title="Speed">🏃 {m.speed}</span>
                  {m.magical ? <span title="Magical - bypasses block/dodge">✨</span> : null}
                </div>
                <div className="monster-list__xp">
                  +{m.xp.toLocaleString('pl-PL')} XP
                  {masteryData.level > 0 && (() => {
                    const pct = masteryData.level * 2;
                    const bonus = Math.floor(m.xp * (pct / 100));
                    return (
                      <span
                        className="monster-list__mastery-xp-bonus"
                        title={`+${pct}% XP & Gold za Mastery ${masteryData.level}/${MASTERY_MAX_LEVEL} (2% za 1 pkt masterii)`}
                      >
                        {' '}+{bonus.toLocaleString('pl-PL')}
                      </span>
                    );
                  })()}
                </div>
                <span className={`monster-list__arrow${isOpen ? ' monster-list__arrow--open' : ''}`}>▼</span>
              </div>

              {isOpen && (
                <div className="monster-list__details">
                  <div className="monster-list__gold">
                    💰 Gold: {m.gold[0]}–{m.gold[1]} &nbsp; ✨ XP: {m.xp}
                    {masteryData.level > 0 && (() => {
                      const pct = masteryData.level * 2;
                      const xpBonus = Math.floor(m.xp * (pct / 100));
                      const goldMinBonus = Math.floor(m.gold[0] * (pct / 100));
                      const goldMaxBonus = Math.floor(m.gold[1] * (pct / 100));
                      return (
                        <span
                          className="monster-list__mastery-xp-bonus"
                          title={`+${pct}% XP & Gold za Mastery ${masteryData.level}/${MASTERY_MAX_LEVEL} (2% za 1 pkt masterii)`}
                        >
                          {' '}(+{xpBonus} XP, +{goldMinBonus}–{goldMaxBonus} Gold)
                        </span>
                      );
                    })()}
                  </div>

                  <div className="monster-list__drops-summary">
                    🎒 Losowy ekwipunek Lvl {m.level} (bronie, zbroje, akcesoria)
                  </div>

                  {(() => {
                    const pi = getPotionDropInfo(m.level);
                    return (
                      <div className="monster-list__potion-drops">
                        <span className="monster-list__potion-drop">
                          ❤️ {pi.hpLabel} ({pi.hpHeal}) — {(HP_POTION_DROP_CHANCE * 100).toFixed(0)}%
                        </span>
                        <span className="monster-list__potion-drop">
                          💧 {pi.mpLabel} ({pi.mpHeal}) — {(MP_POTION_DROP_CHANCE * 100).toFixed(0)}%
                        </span>
                      </div>
                    );
                  })()}

                  {(() => {
                    const chestInfo = getSpellChestDropInfo(m.level);
                    if (chestInfo.levels.length === 0) return null;
                    const chestLevelsLabel = chestInfo.levels.length === 1
                      ? `Lvl ${chestInfo.levels[0]}`
                      : `Lvl ${chestInfo.levels[0]}–${chestInfo.levels[chestInfo.levels.length - 1]}`;
                    return (
                      <div className="monster-list__potion-drops">
                        <span className="monster-list__potion-drop" style={{ fontWeight: 600, color: '#ab47bc' }}>
                          📦 Spell Chest ({chestLevelsLabel})
                        </span>
                        <span className="monster-list__potion-drop">
                          Normal {(SPELL_CHEST_BASE_CHANCE.normal * 100).toFixed(1)}% · Strong {(SPELL_CHEST_BASE_CHANCE.strong * 100).toFixed(1)}% · Epic {(SPELL_CHEST_BASE_CHANCE.epic * 100).toFixed(1)}% · Legendary {(SPELL_CHEST_BASE_CHANCE.legendary * 100).toFixed(1)}% · Boss {(SPELL_CHEST_BASE_CHANCE.boss * 100).toFixed(1)}%
                        </span>
                      </div>
                    );
                  })()}

                  {(() => {
                    const effChances = getEffectiveRarityChances(getMasteryBonuses(m.id));
                    return (
                  <div className="monster-list__variants">
                    {VARIANTS.map((v) => {
                      const heroicRate = isMaxMastery ? scaleHeroicDropRate(HEROIC_DROP_RATE_AT_MAX, m.level) : 0;
                      const bd = getDropBreakdown(v.key, heroicRate);
                      const stoneChance = STONE_CHANCES[v.key] ?? 0;
                      const stoneName = STONE_NAMES[v.key] ?? 'Stone';
                      const chanceLabel = formatRarityChance(effChances[v.key as keyof typeof effChances]);
                      return (
                        <div
                          key={v.key}
                          className={`monster-list__variant${v.key !== 'normal' ? ` monster-list__variant--${v.key}` : ''}`}
                        >
                          <span className="monster-list__variant-name" style={{ color: v.color }}>{v.label}</span>
                          <span className="monster-list__variant-chance">{chanceLabel}</span>
                          {(() => {
                            const base = getMonsterAttackRange(m);
                            const vMin = Math.max(1, Math.floor(base.min * v.atkMult));
                            const vMax = Math.max(vMin, Math.floor(base.max * v.atkMult));
                            return (
                              <span className="monster-list__variant-stats">
                                HP: {Math.floor(m.hp * v.hpMult).toLocaleString('pl-PL')} · ATK: {vMin}-{vMax} · DEF: {Math.floor(m.defense * v.defMult)}
                              </span>
                            );
                          })()}
                          <span className="monster-list__variant-xp">
                            {(() => {
                              const pct = masteryData.level * 2;
                              const mult = 1 + pct / 100;
                              const baseXp = Math.floor(m.xp * v.xpMult);
                              const baseGoldMin = Math.floor(m.gold[0] * v.goldMult);
                              const baseGoldMax = Math.floor(m.gold[1] * v.goldMult);
                              const effXp = Math.floor(baseXp * mult);
                              const effGoldMin = Math.floor(baseGoldMin * mult);
                              const effGoldMax = Math.floor(baseGoldMax * mult);
                              return (
                                <>
                                  ⭐ {effXp.toLocaleString('pl-PL')} XP · 💰 {effGoldMin.toLocaleString('pl-PL')}–{effGoldMax.toLocaleString('pl-PL')} Gold
                                  {masteryData.level > 0 && (
                                    <span
                                      className="monster-list__mastery-xp-bonus"
                                      title={`+${pct}% XP & Gold za Mastery ${masteryData.level}/${MASTERY_MAX_LEVEL} (2% za 1 pkt masterii)`}
                                    >
                                      {' '}+{pct}%
                                    </span>
                                  )}
                                </>
                              );
                            })()}
                          </span>

                          <div className="monster-list__variant-drops">
                            {bd.tiers.map((tier) => (
                              <div key={tier.key} className="monster-list__variant-tier">
                                <span className="monster-list__tier-dot" style={{ background: tier.color, boxShadow: `0 0 4px ${tier.color}` }} />
                                <span className="monster-list__tier-name" style={{ color: tier.color }}>{tier.label}</span>
                                <span className="monster-list__tier-chance">{tier.chancePerRoll.toFixed(2)}%</span>
                              </div>
                            ))}
                            <div className="monster-list__variant-stone">
                              💎 {stoneName} ({(stoneChance * 100).toFixed(0)}%)
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                    );
                  })()}

                  {hasTask && (
                    <div className="monster-list__task-progress">
                      <div className="monster-list__task-progress-label">
                        📋 Task: {monsterTask.progress}/{monsterTask.killCount} {taskDone ? '✅ Gotowe!' : `(${taskPct}%)`}
                      </div>
                      <div className="monster-list__task-progress-bar">
                        <div
                          className={`monster-list__task-progress-fill${taskDone ? ' monster-list__task-progress-fill--done' : ''}`}
                          style={{ width: `${taskPct}%` }}
                        />
                      </div>
                    </div>
                  )}
                  {/* Mastery level + kill progress */}
                  {(() => {
                    const mKills = masteryKills[m.id] ?? 0;
                    const mRequired = isMaxMastery ? 0 : MASTERY_KILL_THRESHOLD * (masteryData.level + 1);
                    const mPct = isMaxMastery ? 100 : (mRequired > 0 ? Math.min(100, Math.floor((mKills / mRequired) * 100)) : 0);
                    return (
                      <div className={`monster-list__mastery${isMaxMastery ? ' monster-list__mastery--max' : ''}`}>
                        <div className="monster-list__mastery-header">
                          <span>{isMaxMastery ? '👑' : '🏅'} Mastery</span>
                          <span className="monster-list__mastery-level">
                            {masteryData.level}/{MASTERY_MAX_LEVEL}
                            {isMaxMastery && ' MAX'}
                          </span>
                        </div>
                        {!isMaxMastery && (
                          <div className="monster-list__mastery-bar-wrap">
                            <div className="monster-list__mastery-bar">
                              <div
                                className="monster-list__mastery-bar-fill"
                                style={{ width: `${mPct}%` }}
                              />
                            </div>
                            <span className="monster-list__mastery-kills">
                              {mKills.toLocaleString('pl-PL')}/{mRequired.toLocaleString('pl-PL')} kills
                            </span>
                          </div>
                        )}
                        {masteryData.level > 0 && (
                          <div className="monster-list__mastery-bonuses">
                            <span>+{masteryData.level}% Strong</span>
                            <span>+{(masteryData.level * 0.5).toFixed(1)}% Epic</span>
                            <span>+{(masteryData.level * 0.25).toFixed(2)}% Legendary</span>
                            <span>+{(masteryData.level * 0.1).toFixed(1)}% Boss</span>
                            {isMaxMastery && <span style={{ color: '#9c27b0' }}>+{(scaleHeroicDropRate(HEROIC_DROP_RATE_AT_MAX, m.level) * 100).toFixed(2)}% Heroic drop</span>}
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  <button
                    className="monster-list__fight-btn"
                    onClick={() => handleFight(m)}
                    disabled={isLocked}
                    title={isLocked ? unlock.reason : undefined}
                  >
                    {isLocked ? `🔒 ${unlock.shortLabel}` : '⚔️ Walcz!'}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default MonsterList;
