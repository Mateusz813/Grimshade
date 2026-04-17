import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useQuestStore } from '../../stores/questStore';
import { useCharacterStore } from '../../stores/characterStore';
import { useInventoryStore } from '../../stores/inventoryStore';
import { useDailyQuestStore } from '../../stores/dailyQuestStore';
import { scaleRewards } from '../../systems/dailyQuestSystem';
import { generateRandomItemForClass } from '../../systems/itemGenerator';
import { getItemDisplayInfo } from '../../systems/itemGenerator';
import { ELIXIRS } from '../../stores/shopStore';
import { STONE_NAMES, RARITY_LABELS } from '../../systems/itemSystem';
import ItemIcon from '../../components/ui/ItemIcon/ItemIcon';
import type { Rarity } from '../../systems/itemSystem';
import type { IQuest, IActiveQuest, IQuestGoal } from '../../stores/questStore';
import questsRaw from '../../data/quests.json';
import monstersRaw from '../../data/monsters.json';
import dungeonsRaw from '../../data/dungeons.json';
import bossesRaw from '../../data/bosses.json';
import './Quests.scss';

const allQuests = questsRaw as IQuest[];

// ── Lookup maps for display names and sprites ─────────────────────────────
interface INamedEntity { id: string; name_pl: string; sprite?: string }
const monsterMap = new Map<string, INamedEntity>(
  (monstersRaw as INamedEntity[]).map((m) => [m.id, m]),
);
const dungeonMap = new Map<string, INamedEntity>(
  (dungeonsRaw as INamedEntity[]).map((d) => [d.id, d]),
);
const bossMap = new Map<string, INamedEntity>(
  (bossesRaw as INamedEntity[]).map((b) => [b.id, b]),
);

/** Resolve a goal target (monster/dungeon/boss ID) to a pretty label with emoji. */
const resolveGoalTarget = (
  type: string,
  monsterId?: string,
  dungeonId?: string,
  bossId?: string,
): string => {
  if (type === 'kill' && monsterId) {
    const m = monsterMap.get(monsterId);
    return m ? `${m.sprite ?? '👾'} ${m.name_pl}` : monsterId;
  }
  if (type === 'dungeon' && dungeonId) {
    const d = dungeonMap.get(dungeonId);
    return d ? `🏰 ${d.name_pl}` : dungeonId;
  }
  if (type === 'boss' && bossId) {
    const b = bossMap.get(bossId);
    return b ? `${b.sprite ?? '👹'} ${b.name_pl}` : bossId;
  }
  return monsterId ?? dungeonId ?? bossId ?? '';
};

/** Elixir ID alias map — quests may use short IDs (hp_sm) that don't match shop IDs (hp_potion_sm). */
const ELIXIR_ALIASES: Record<string, string> = {
  hp_sm: 'hp_potion_sm',
  hp_md: 'hp_potion_md',
  hp_lg: 'hp_potion_lg',
  mp_sm: 'mp_potion_sm',
  mp_md: 'mp_potion_md',
  mp_lg: 'mp_potion_lg',
};

const resolveElixirId = (raw: string): string => ELIXIR_ALIASES[raw] ?? raw;

type TabFilter = 'all' | 'active' | 'available' | 'completed';

const RARITY_GOAL_LABELS: Record<string, string> = {
  strong: 'Strong+',
  epic: 'Epic+',
  legendary: 'Legendary+',
  boss: 'Boss-tier',
  any: 'dowolnej rzadkości',
};

const DROP_RARITY_LABELS: Record<string, string> = {
  common: 'Common',
  rare: 'Rare',
  epic: 'Epic',
  legendary: 'Legendary',
  mythic: 'Mythic',
  heroic: 'Heroic',
};

/** Returns a fully readable Polish description for a quest goal. */
const formatGoalDescription = (goal: IQuestGoal): string => {
  switch (goal.type) {
    case 'kill': {
      const target = goal.monsterId ? resolveGoalTarget('kill', goal.monsterId) : '';
      return `Zabij ${target}`.trim();
    }
    case 'dungeon': {
      const target = goal.dungeonId ? resolveGoalTarget('dungeon', undefined, goal.dungeonId) : '';
      return `Ukoncz dungeon: ${target}`.trim();
    }
    case 'boss': {
      const target = goal.bossId ? resolveGoalTarget('boss', undefined, undefined, goal.bossId) : '';
      return `Zabij bossa: ${target}`.trim();
    }
    case 'kill_rarity': {
      const rarityLabel = RARITY_GOAL_LABELS[goal.rarity ?? 'any'] ?? (goal.rarity ?? '');
      const levelSuffix = goal.minMonsterLevel ? ` (lvl ${goal.minMonsterLevel}+)` : '';
      return `Zabij potwory ${rarityLabel}${levelSuffix}`;
    }
    case 'level':
      return `Osiagnij poziom ${goal.count}`;
    case 'complete_dungeons_any':
      return 'Ukoncz dowolne dungeony';
    case 'kill_bosses_any':
      return 'Zabij dowolnych bossow';
    case 'drop_rarity': {
      const rarityName = DROP_RARITY_LABELS[goal.rarity ?? 'common'] ?? (goal.rarity ?? '');
      return `Zdobadz przedmioty rzadkosci ${rarityName}`;
    }
    case 'mastery_total':
      return 'Zdobadz lacznie poziomow mastery';
    case 'mastery_max_count':
      return 'Zmaksuj mastery potworow';
    case 'mastery_all_at_level':
      return `Osiagnij mastery na wszystkich potworach`;
    default:
      return goal.type;
  }
};

const DAILY_GOAL_LABELS: Record<string, string> = {
  kill_any: 'Zabij potworow',
  earn_gold: 'Zdobadz zlota',
  complete_dungeon: 'Ukoncz dungeonow',
  kill_boss: 'Pokonaj bossow',
};

type MainTab = 'daily' | 'quests';

// ── Claim summary types ──────────────────────────────────────────────────────

interface IClaimSummaryEntry {
  icon: string;
  label: string;
  /** When set, renders an ItemIcon with rarity background instead of plain emoji */
  rarity?: string;
  /** Item upgrade level, shown on ItemIcon badge */
  upgradeLevel?: number;
  /** Item level, shown on ItemIcon */
  itemLevel?: number;
}

interface IClaimSummary {
  questName: string;
  entries: IClaimSummaryEntry[];
}

const RARITY_COLORS: Record<string, string> = {
  common: '#9e9e9e', rare: '#2196f3', epic: '#4caf50',
  legendary: '#f44336', mythic: '#ffc107', heroic: '#9c27b0', unique: '#ff5722',
};

const Quests = () => {
  const navigate = useNavigate();
  const [mainTab, setMainTab] = useState<MainTab>('quests');
  const [filter, setFilter] = useState<TabFilter>('all');
  const [claimSummary, setClaimSummary] = useState<IClaimSummary | null>(null);
  const [abandonTarget, setAbandonTarget] = useState<{ id: string; name: string } | null>(null);
  const [showAbandonAllConfirm, setShowAbandonAllConfirm] = useState(false);
  const { activeQuests, completedQuestIds, startQuest, abandonQuest, claimQuest, isCompleted, isActive } = useQuestStore();
  const character = useCharacterStore((s) => s.character);
  const updateCharacter = useCharacterStore((s) => s.updateCharacter);
  const { addGold, addItem, addConsumable, addStones } = useInventoryStore();
  const addXp = useCharacterStore((s) => s.addXp);
  const { activeQuests: dailyActiveQuests, todayQuestDefs, refreshIfNeeded, claimReward } = useDailyQuestStore();

  useEffect(() => {
    if (character) {
      refreshIfNeeded(character.level);
    }
  }, [character, refreshIfNeeded]);

  const charLevel = character?.level ?? 0;

  const getActiveQuest = (questId: string): IActiveQuest | undefined =>
    activeQuests.find((aq) => aq.questId === questId);

  const isQuestAvailable = (quest: IQuest): boolean =>
    charLevel >= quest.minLevel && !isCompleted(quest.id) && !isActive(quest.id);

  const isQuestComplete = (questId: string): boolean => {
    const aq = getActiveQuest(questId);
    if (!aq) return false;
    return aq.goals.every((g) => (g.progress ?? 0) >= g.count);
  };

  const handleClaimDaily = (questId: string) => {
    if (!character) return;
    const rewards = claimReward(questId, character.level);
    if (!rewards) return;
    addGold(rewards.gold);
    addXp(rewards.xp);
    if (rewards.elixir) {
      addConsumable(resolveElixirId(rewards.elixir), 1);
    }
  };

  const getElixirName = (rawId: string): string => {
    const id = resolveElixirId(rawId);
    const elixir = ELIXIRS.find((e) => e.id === id);
    return elixir ? elixir.name_pl : rawId;
  };

  const getElixirIcon = (rawId: string): string => {
    const id = resolveElixirId(rawId);
    const elixir = ELIXIRS.find((e) => e.id === id);
    return elixir ? elixir.icon : '🧪';
  };

  const getElixirDescription = (rawId: string): string => {
    const id = resolveElixirId(rawId);
    const elixir = ELIXIRS.find((e) => e.id === id);
    return elixir ? elixir.description_pl : '';
  };

  const handleClaimQuest = (questId: string) => {
    const quest = allQuests.find((q) => q.id === questId);
    if (!quest || !character) return;

    const summaryEntries: IClaimSummaryEntry[] = [];

    for (const reward of quest.rewards) {
      const amount = reward.amount ?? 1;

      switch (reward.type) {
        case 'gold': {
          addGold(amount);
          summaryEntries.push({ icon: '💰', label: `${amount.toLocaleString('pl-PL')} gold` });
          break;
        }

        case 'xp': {
          const xpResult = addXp(amount);
          let xpLabel = `${amount.toLocaleString('pl-PL')} XP`;
          if (xpResult.levelsGained > 0) {
            xpLabel += ` (Level Up! → ${xpResult.newLevel})`;
          }
          summaryEntries.push({ icon: '✨', label: xpLabel });
          break;
        }

        case 'elixir': {
          if (reward.elixirId) {
            const resolvedId = resolveElixirId(reward.elixirId);
            addConsumable(resolvedId, amount);
            const elixName = getElixirName(reward.elixirId);
            const elixIcon = getElixirIcon(reward.elixirId);
            summaryEntries.push({ icon: elixIcon, label: `${elixName} ×${amount}` });
          }
          break;
        }

        case 'item': {
          const itemRarity = (reward.rarity ?? 'rare') as Rarity;
          const itemLevel = quest.minLevel;
          for (let i = 0; i < amount; i++) {
            const generatedItem = generateRandomItemForClass(
              character.class,
              itemLevel,
              itemRarity,
            );
            if (generatedItem) {
              addItem(generatedItem);
              const displayInfo = getItemDisplayInfo(generatedItem.itemId);
              const itemName = displayInfo ? displayInfo.name_pl : generatedItem.itemId;
              const itemIcon = displayInfo ? displayInfo.icon : '🎁';
              const rarityLabel = RARITY_LABELS[itemRarity] ?? itemRarity;
              summaryEntries.push({
                icon: itemIcon,
                label: `${itemName} (${rarityLabel}, lvl ${itemLevel})`,
                rarity: itemRarity,
                itemLevel,
              });
            }
          }
          break;
        }

        case 'stones':
        case 'stone': {
          const stoneKey = reward.stoneId ?? reward.stoneType;
          if (stoneKey) {
            addStones(stoneKey, amount);
            const stoneName = STONE_NAMES[stoneKey] ?? stoneKey;
            summaryEntries.push({ icon: '💎', label: `${stoneName} x${amount}` });
          }
          break;
        }

        case 'gift': {
          // Handled after loop – ensures every gift-flagged quest gets a random item
          break;
        }

        case 'stat_points': {
          updateCharacter({
            stat_points: (character.stat_points ?? 0) + amount,
          });
          summaryEntries.push({ icon: '⭐', label: `+${amount} punktow statystyk` });
          break;
        }
      }
    }

    // Gift item: every quest claim grants a bonus random item for the player's
    // class. Rarity is rolled from rare/epic/legendary/mythic (never heroic).
    // This fulfills the "🎁 prezent" chip shown on the quest card.
    const hasExplicitItem = quest.rewards.some((r) => r.type === 'item');
    if (!hasExplicitItem) {
      const GIFT_RARITIES: Rarity[] = ['rare', 'epic', 'legendary', 'mythic'];
      // Weighted roll: rare 55%, epic 30%, legendary 12%, mythic 3%
      const weights = [0.55, 0.3, 0.12, 0.03];
      const roll = Math.random();
      let cumulative = 0;
      let picked: Rarity = 'rare';
      for (let i = 0; i < GIFT_RARITIES.length; i++) {
        cumulative += weights[i];
        if (roll < cumulative) {
          picked = GIFT_RARITIES[i];
          break;
        }
      }
      const giftItem = generateRandomItemForClass(
        character.class,
        Math.max(1, quest.minLevel),
        picked,
      );
      if (giftItem) {
        addItem(giftItem);
        const displayInfo = getItemDisplayInfo(giftItem.itemId);
        const itemName = displayInfo ? displayInfo.name_pl : giftItem.itemId;
        const itemIcon = displayInfo ? displayInfo.icon : '🎁';
        const rarityLabel = RARITY_LABELS[picked] ?? picked;
        summaryEntries.push({
          icon: itemIcon,
          label: `${itemName} (${rarityLabel}, lvl ${quest.minLevel})`,
          rarity: picked,
          itemLevel: quest.minLevel,
        });
      }
    }

    claimQuest(questId);
    setClaimSummary({ questName: quest.name_pl, entries: summaryEntries });
  };

  // ── Bulk handlers ─────────────────────────────────────────────────────────

  const claimableQuests = activeQuests.filter((aq) =>
    aq.goals.every((g) => (g.progress ?? 0) >= g.count),
  );

  const handleClaimAll = () => {
    if (!character || claimableQuests.length === 0) return;

    const allEntries: IClaimSummaryEntry[] = [];

    for (const aq of claimableQuests) {
      const quest = allQuests.find((q) => q.id === aq.questId);
      if (!quest) continue;

      // Replicate the same reward logic as handleClaimQuest
      for (const reward of quest.rewards) {
        const amount = reward.amount ?? 1;
        switch (reward.type) {
          case 'gold': {
            addGold(amount);
            allEntries.push({ icon: '💰', label: `${amount.toLocaleString('pl-PL')} gold` });
            break;
          }
          case 'xp': {
            const xpResult = addXp(amount);
            let xpLabel = `${amount.toLocaleString('pl-PL')} XP`;
            if (xpResult.levelsGained > 0) {
              xpLabel += ` (Level Up! → ${xpResult.newLevel})`;
            }
            allEntries.push({ icon: '✨', label: xpLabel });
            break;
          }
          case 'elixir': {
            if (reward.elixirId) {
              const resolvedId = resolveElixirId(reward.elixirId);
              addConsumable(resolvedId, amount);
              const elixName = getElixirName(reward.elixirId);
              const elixIcon = getElixirIcon(reward.elixirId);
              allEntries.push({ icon: elixIcon, label: `${elixName} x${amount}` });
            }
            break;
          }
          case 'item': {
            const itemRarity = (reward.rarity ?? 'rare') as Rarity;
            const itemLevel = quest.minLevel;
            for (let i = 0; i < amount; i++) {
              const generatedItem = generateRandomItemForClass(character.class, itemLevel, itemRarity);
              if (generatedItem) {
                addItem(generatedItem);
                const displayInfo = getItemDisplayInfo(generatedItem.itemId);
                const itemName = displayInfo ? displayInfo.name_pl : generatedItem.itemId;
                const itemIcon = displayInfo ? displayInfo.icon : '🎁';
                const rarityLabel = RARITY_LABELS[itemRarity] ?? itemRarity;
                allEntries.push({ icon: itemIcon, label: `${itemName} (${rarityLabel}, lvl ${itemLevel})`, rarity: itemRarity, itemLevel });
              }
            }
            break;
          }
          case 'stones':
          case 'stone': {
            const stoneKey = reward.stoneId ?? reward.stoneType;
            if (stoneKey) {
              addStones(stoneKey, amount);
              const stoneName = STONE_NAMES[stoneKey] ?? stoneKey;
              allEntries.push({ icon: '💎', label: `${stoneName} x${amount}` });
            }
            break;
          }
          case 'stat_points': {
            updateCharacter({ stat_points: (character.stat_points ?? 0) + amount });
            allEntries.push({ icon: '⭐', label: `+${amount} punktow statystyk` });
            break;
          }
        }
      }

      // Gift item
      const hasExplicitItem = quest.rewards.some((r) => r.type === 'item');
      if (!hasExplicitItem) {
        const GIFT_RARITIES: Rarity[] = ['rare', 'epic', 'legendary', 'mythic'];
        const weights = [0.55, 0.3, 0.12, 0.03];
        const roll = Math.random();
        let cumulative = 0;
        let picked: Rarity = 'rare';
        for (let i = 0; i < GIFT_RARITIES.length; i++) {
          cumulative += weights[i];
          if (roll < cumulative) { picked = GIFT_RARITIES[i]; break; }
        }
        const giftItem = generateRandomItemForClass(character.class, Math.max(1, quest.minLevel), picked);
        if (giftItem) {
          addItem(giftItem);
          const displayInfo = getItemDisplayInfo(giftItem.itemId);
          const itemName = displayInfo ? displayInfo.name_pl : giftItem.itemId;
          const itemIcon = displayInfo ? displayInfo.icon : '🎁';
          const rarityLabel = RARITY_LABELS[picked] ?? picked;
          allEntries.push({ icon: itemIcon, label: `${itemName} (${rarityLabel}, lvl ${quest.minLevel})`, rarity: picked, itemLevel: quest.minLevel });
        }
      }

      claimQuest(aq.questId);
    }

    setClaimSummary({ questName: `${claimableQuests.length} questow`, entries: allEntries });
  };

  const handleAcceptAll = () => {
    const available = allQuests.filter(isQuestAvailable);
    for (const quest of available) {
      startQuest(quest);
    }
  };

  const handleAbandonAll = () => {
    const activeIds = activeQuests.map((aq) => aq.questId);
    for (const id of activeIds) {
      abandonQuest(id);
    }
    setShowAbandonAllConfirm(false);
  };

  const handleClaimAllDaily = () => {
    if (!character) return;
    const claimable = dailyActiveQuests.filter((a) => a.completed && !a.claimed);
    const allEntries: IClaimSummaryEntry[] = [];

    for (const aq of claimable) {
      const def = todayQuestDefs.find((d) => d.id === aq.questId);
      if (!def) continue;
      const rewards = claimReward(aq.questId, character.level);
      if (!rewards) continue;
      addGold(rewards.gold);
      addXp(rewards.xp);
      allEntries.push({ icon: '💰', label: `${rewards.gold.toLocaleString('pl-PL')} gold` });
      allEntries.push({ icon: '✨', label: `${rewards.xp.toLocaleString('pl-PL')} XP` });
      if (rewards.elixir) {
        addConsumable(resolveElixirId(rewards.elixir), 1);
        const elixName = getElixirName(rewards.elixir);
        const elixIcon = getElixirIcon(rewards.elixir);
        allEntries.push({ icon: elixIcon, label: `${elixName} x1` });
      }
    }

    if (allEntries.length > 0) {
      setClaimSummary({ questName: `${claimable.length} questow dziennych`, entries: allEntries });
    }
  };

  const filteredQuests = allQuests.filter((q) => {
    if (filter === 'active') return isActive(q.id);
    if (filter === 'completed') return isCompleted(q.id);
    if (filter === 'available') return isQuestAvailable(q);
    return true; // 'all'
  }).sort((a, b) => a.minLevel - b.minLevel);

  const activeCount = activeQuests.length;
  const completedCount = completedQuestIds.length;
  const availableCount = allQuests.filter(isQuestAvailable).length;

  const isDailyLocked = (character?.level ?? 0) < 25;

  const renderDailyTab = () => {
    if (!character) return null;

    if (isDailyLocked) {
      return (
        <div className="quests__daily-locked">
          <span className="quests__daily-locked-icon">🔒</span>
          <p>Questy dzienne odblokuja sie na poziomie 25</p>
          <p className="quests__daily-locked-sub">Twoj poziom: {character.level}</p>
        </div>
      );
    }

    const dailyClaimable = dailyActiveQuests.filter((a) => a.completed && !a.claimed);

    return (
      <>
        {dailyClaimable.length > 0 && (
          <div className="quests__bulk-actions">
            <button className="quests__bulk-btn quests__bulk-btn--claim" onClick={handleClaimAllDaily}>
              🎁 Odbierz wszystkie daily ({dailyClaimable.length})
            </button>
          </div>
        )}
        <div className="quests__daily-list">
        {todayQuestDefs.map((def) => {
          const active = dailyActiveQuests.find((a) => a.questId === def.id);
          if (!active) return null;
          const rewards = scaleRewards(def.rewards, character.level);
          const pct = Math.min(1, active.progress / def.goal.count);

          return (
            <motion.div
              key={def.id}
              className={`quests__daily-quest${active.claimed ? ' quests__daily-quest--claimed' : active.completed ? ' quests__daily-quest--completed' : ''}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <div className="quests__daily-quest-header">
                <h3 className="quests__daily-quest-name">{def.name_pl}</h3>
                {active.claimed && <span className="quests__daily-badge quests__daily-badge--claimed">Odebrane</span>}
                {!active.claimed && active.completed && <span className="quests__daily-badge quests__daily-badge--ready">Gotowe!</span>}
              </div>

              <p className="quests__daily-quest-desc">{def.description_pl}</p>

              <div className="quests__daily-progress">
                <div className="quests__daily-progress-bar">
                  <div
                    className="quests__daily-progress-fill"
                    style={{ width: `${pct * 100}%` }}
                  />
                </div>
                <span className="quests__daily-progress-text">
                  {active.progress} / {def.goal.count} {DAILY_GOAL_LABELS[def.goal.type] ?? ''}
                </span>
              </div>

              <div className="quests__daily-rewards">
                <span className="quests__daily-reward">💰 {rewards.gold}g</span>
                <span className="quests__daily-reward">✨ {rewards.xp} XP</span>
                {rewards.elixir && <span className="quests__daily-reward">🧪 Eliksir</span>}
              </div>

              {active.completed && !active.claimed && (
                <button
                  className="quests__daily-claim-btn"
                  onClick={() => handleClaimDaily(def.id)}
                >
                  Odbierz nagrode
                </button>
              )}
            </motion.div>
          );
        })}

        {todayQuestDefs.length === 0 && (
          <p className="quests__empty">Brak questow na dzis. Wejdz jutro!</p>
        )}
      </div>
      </>
    );
  };

  const renderQuestsTab = () => {
    const hasClaimable = claimableQuests.length > 0;
    const hasAvailable = allQuests.some(isQuestAvailable);
    const hasActive = activeQuests.length > 0;
    const showBulkBar = hasClaimable || hasAvailable || hasActive;

    return (
    <>
      {showBulkBar && (
        <div className="quests__bulk-actions">
          {hasClaimable && (
            <button className="quests__bulk-btn quests__bulk-btn--claim" onClick={handleClaimAll}>
              🎁 Odbierz wszystkie nagrody ({claimableQuests.length})
            </button>
          )}
          {hasAvailable && (
            <button className="quests__bulk-btn quests__bulk-btn--accept" onClick={handleAcceptAll}>
              📜 Wez wszystkie dostepne
            </button>
          )}
          {hasActive && (
            <button className="quests__bulk-btn quests__bulk-btn--abandon" onClick={() => setShowAbandonAllConfirm(true)}>
              ✖ Porzuc wszystkie ({activeQuests.length})
            </button>
          )}
        </div>
      )}
      <div className="quests__filters">
        {([
          ['all', `Wszystkie (${allQuests.length})`],
          ['active', `Aktywne (${activeCount})`],
          ['available', `Dostępne (${availableCount})`],
          ['completed', `Ukończone (${completedCount})`],
        ] as [TabFilter, string][]).map(([f, label]) => (
          <button
            key={f}
            className={`quests__filter-btn${filter === f ? ' quests__filter-btn--active' : ''}`}
            onClick={() => setFilter(f)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="quests__list">
        {filteredQuests.length === 0 && (
          <p className="quests__empty">Brak questów w tej kategorii.</p>
        )}
        {filteredQuests.map((quest) => {
          const aq = getActiveQuest(quest.id);
          const completed = isCompleted(quest.id);
          const active = isActive(quest.id);
          const available = isQuestAvailable(quest);
          const tooHigh = charLevel < quest.minLevel;
          const canClaim = active && isQuestComplete(quest.id);
          // No limit — player can have unlimited concurrent quests

          return (
            <div
              key={quest.id}
              className={[
                'quests__card',
                completed ? 'quests__card--completed' : '',
                active ? 'quests__card--active' : '',
                tooHigh ? 'quests__card--locked' : '',
              ].filter(Boolean).join(' ')}
            >
              <div className="quests__card-header">
                <div className="quests__card-title-row">
                  {completed && <span className="quests__check">✓</span>}
                  {tooHigh && <span className="quests__lock">🔒</span>}
                  <h3 className="quests__card-name">{quest.name_pl}</h3>
                </div>
                <span className="quests__card-level">Min. lvl {quest.minLevel}</span>
              </div>

              <p className="quests__card-desc">{quest.description_pl}</p>

              {/* Goals */}
              <div className="quests__goals">
                {quest.goals.map((goal, idx) => {
                  const aqGoal = aq?.goals[idx];
                  const progress = aqGoal?.progress ?? 0;
                  const pct = Math.min(100, Math.floor((progress / goal.count) * 100));
                  const done = progress >= goal.count;

                  return (
                    <div key={idx} className={`quests__goal${done ? ' quests__goal--done' : ''}`}>
                      <div className="quests__goal-text">
                        <span className="quests__goal-type">
                          {formatGoalDescription(goal)}
                        </span>
                        <span className="quests__goal-count">
                          {active ? `${progress}/` : ''}{goal.count}
                        </span>
                        {done && <span className="quests__goal-check">✓</span>}
                      </div>
                      {active && (
                        <div className="quests__goal-bar">
                          <div
                            className="quests__goal-bar-fill"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Rewards */}
              <div className="quests__rewards">
                <span className="quests__rewards-label">Nagrody:</span>
                {[...quest.rewards, { type: 'gift' as const, amount: 1 }].map((r, i) => {
                  let icon = '🎁';
                  let text = '';
                  let titleText = '';
                  if (r.type === 'gold') {
                    icon = '💰';
                    text = (r.amount ?? 0).toLocaleString('pl-PL');
                    titleText = `${text} zlota`;
                  } else if (r.type === 'xp') {
                    icon = '✨';
                    text = (r.amount ?? 0).toLocaleString('pl-PL');
                    titleText = `${text} XP`;
                  } else if (r.type === 'elixir') {
                    const eid = r.elixirId ?? '';
                    icon = getElixirIcon(eid);
                    const eName = getElixirName(eid);
                    const eDesc = getElixirDescription(eid);
                    text = `×${r.amount ?? 1}`;
                    titleText = `${eName} ×${r.amount ?? 1}${eDesc ? ` — ${eDesc}` : ''}`;
                  } else if (r.type === 'stat_points') {
                    icon = '⭐';
                    text = `+${r.amount ?? 0}`;
                    titleText = `+${r.amount ?? 0} pkt. statystyk`;
                  } else if (r.type === 'item') {
                    const rarity = (r.rarity ?? 'rare') as Rarity;
                    icon = '🎁';
                    text = `×${r.amount ?? 1}`;
                    titleText = `${RARITY_LABELS[rarity] ?? rarity} Item ×${r.amount ?? 1}`;
                  } else if (r.type === 'stones' || r.type === 'stone') {
                    icon = '💎';
                    text = `×${r.amount ?? 1}`;
                    const stoneKey = r.stoneId ?? r.stoneType ?? '';
                    titleText = `${STONE_NAMES[stoneKey] ?? stoneKey} ×${r.amount ?? 1}`;
                  } else if (r.type === 'gift') {
                    icon = '🎁';
                    text = 'losowy';
                    titleText = 'Losowy przedmiot (Rare / Epic / Legendary / Mythic)';
                  }
                  return (
                    <span key={i} className="quests__reward-chip" title={titleText}>
                      <span className="quests__reward-chip-icon">{icon}</span>
                      <span className="quests__reward-chip-text">{text}</span>
                    </span>
                  );
                })}
              </div>

              {/* Action buttons */}
              <div className="quests__actions">
                {available && (
                  <button
                    className="quests__action-btn quests__action-btn--start"
                    onClick={() => startQuest(quest)}
                  >
                    Weź quest
                  </button>
                )}
                {canClaim && (
                  <button
                    className="quests__action-btn quests__action-btn--claim"
                    onClick={() => handleClaimQuest(quest.id)}
                  >
                    🎁 Odbierz nagrodę
                  </button>
                )}
                {active && !canClaim && (
                  <>
                    <span className="quests__in-progress">W trakcie…</span>
                    <button
                      className="quests__action-btn quests__action-btn--abandon"
                      onClick={() => setAbandonTarget({ id: quest.id, name: quest.name_pl })}
                    >
                      ✖ Porzuć
                    </button>
                  </>
                )}
                {completed && (
                  <span className="quests__completed-label">✓ Ukończono</span>
                )}
                {tooHigh && !completed && (
                  <span className="quests__locked-label">
                    🔒 Wymagany poziom {quest.minLevel}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </>
    );
  };

  return (
    <div className="quests">
      <header className="quests__header">
        <button className="quests__back" onClick={() => navigate('/')}>← Miasto</button>
        <h1 className="quests__title">📜 Questy</h1>
      </header>

      <div className="quests__tabs">
        <button
          className={`quests__tab${mainTab === 'daily' ? ' quests__tab--active' : ''}${dailyActiveQuests.some((a) => a.completed && !a.claimed) ? ' quests__tab--claimable' : ''}`}
          onClick={() => setMainTab('daily')}
        >
          📅 Dzienne
          {dailyActiveQuests.some((a) => a.completed && !a.claimed) && <span className="quests__tab-badge">🎁</span>}
        </button>
        <button
          className={`quests__tab${mainTab === 'quests' ? ' quests__tab--active' : ''}${claimableQuests.length > 0 ? ' quests__tab--claimable' : ''}`}
          onClick={() => setMainTab('quests')}
        >
          📜 Questy
          {claimableQuests.length > 0 && <span className="quests__tab-badge">🎁</span>}
        </button>
      </div>

      {mainTab === 'daily' ? renderDailyTab() : renderQuestsTab()}

      {/* Claim summary modal */}
      {claimSummary && (
        <div className="quests__overlay" onClick={() => setClaimSummary(null)}>
          <motion.div
            className="quests__claim-modal"
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="quests__claim-modal-title">Quest ukonczony!</h2>
            <p className="quests__claim-modal-quest">{claimSummary.questName}</p>
            <div className="quests__claim-modal-rewards">
              {claimSummary.entries.map((entry, idx) => (
                <div
                  key={idx}
                  className="quests__claim-modal-row"
                  style={entry.rarity ? {
                    borderColor: RARITY_COLORS[entry.rarity] ?? '#9e9e9e',
                    background: `${RARITY_COLORS[entry.rarity] ?? '#9e9e9e'}18`,
                  } : undefined}
                >
                  {entry.rarity ? (
                    <ItemIcon
                      icon={entry.icon}
                      rarity={entry.rarity}
                      size="sm"
                      itemLevel={entry.itemLevel}
                      upgradeLevel={entry.upgradeLevel}
                      showTooltip={false}
                    />
                  ) : (
                    <span className="quests__claim-modal-icon">{entry.icon}</span>
                  )}
                  <span className="quests__claim-modal-label">{entry.label}</span>
                </div>
              ))}
            </div>
            <button
              className="quests__claim-modal-btn"
              onClick={() => setClaimSummary(null)}
            >
              OK
            </button>
          </motion.div>
        </div>
      )}

      {/* ── Abandon All confirmation modal ────────────────────────────── */}
      {showAbandonAllConfirm && (
        <div className="quests__overlay" onClick={() => setShowAbandonAllConfirm(false)}>
          <motion.div
            className="quests__abandon-modal"
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            onClick={(e) => e.stopPropagation()}
          >
            <span className="quests__abandon-modal-icon">⚠️</span>
            <h2 className="quests__abandon-modal-title">Porzucic wszystkie questy?</h2>
            <p className="quests__abandon-modal-quest">{activeQuests.length} aktywnych questow</p>
            <p className="quests__abandon-modal-warn">
              Caly postep we wszystkich aktywnych questach zostanie utracony. Tej akcji nie mozna cofnac.
            </p>
            <div className="quests__abandon-modal-actions">
              <button
                className="quests__abandon-modal-btn quests__abandon-modal-btn--cancel"
                onClick={() => setShowAbandonAllConfirm(false)}
              >
                Anuluj
              </button>
              <button
                className="quests__abandon-modal-btn quests__abandon-modal-btn--confirm"
                onClick={handleAbandonAll}
              >
                ✖ Porzuc wszystkie
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* ── Abandon confirmation modal ──────────────────────────────────── */}
      {abandonTarget && (
        <div className="quests__overlay" onClick={() => setAbandonTarget(null)}>
          <motion.div
            className="quests__abandon-modal"
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            onClick={(e) => e.stopPropagation()}
          >
            <span className="quests__abandon-modal-icon">⚠️</span>
            <h2 className="quests__abandon-modal-title">Porzucić questa?</h2>
            <p className="quests__abandon-modal-quest">{abandonTarget.name}</p>
            <p className="quests__abandon-modal-warn">
              Cały postęp zostanie utracony. Tej akcji nie można cofnąć.
            </p>
            <div className="quests__abandon-modal-actions">
              <button
                className="quests__abandon-modal-btn quests__abandon-modal-btn--cancel"
                onClick={() => setAbandonTarget(null)}
              >
                Anuluj
              </button>
              <button
                className="quests__abandon-modal-btn quests__abandon-modal-btn--confirm"
                onClick={() => {
                  abandonQuest(abandonTarget.id);
                  setAbandonTarget(null);
                }}
              >
                ✖ Porzuć
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
};

export default Quests;
