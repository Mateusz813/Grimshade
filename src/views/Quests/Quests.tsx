import { useState, useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useQuestStore } from '../../stores/questStore';
import { useCharacterStore } from '../../stores/characterStore';
import { useInventoryStore } from '../../stores/inventoryStore';
import { useTransformStore } from '../../stores/transformStore';
import { useDailyQuestStore } from '../../stores/dailyQuestStore';
import { useTaskStore } from '../../stores/taskStore';
import type { ITask } from '../../stores/taskStore';
import { useMasteryStore, MASTERY_MAX_LEVEL, MASTERY_KILL_THRESHOLD } from '../../stores/masteryStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { getMonsterUnlockStatus } from '../../systems/progression';
import { computeTaskRewards } from '../../systems/taskRewards';
import tasksRaw from '../../data/tasks.json';
import { scaleRewards } from '../../systems/dailyQuestSystem';
import { generateRandomItemForClass } from '../../systems/itemGenerator';
import { getItemDisplayInfo } from '../../systems/itemGenerator';
import { ELIXIRS } from '../../stores/shopStore';
import { formatGoldShort } from '../../systems/goldFormat';
import { STONE_NAMES, STONE_ICONS, RARITY_LABELS } from '../../systems/itemSystem';
import ItemIcon from '../../components/ui/ItemIcon/ItemIcon';
import TinyIcon from '../../components/ui/TinyIcon/TinyIcon';
import GameIcon from '../../components/atoms/Twemoji/GameIcon';
import Icon from '../../components/atoms/Icon/Icon';
import EmojiText from '../../components/atoms/Twemoji/EmojiText';
import { MonsterSprite } from '../../components/ui/Sprite/MonsterSprite';
import { getMonsterImageNearest, getElixirImage, getConsumableImage } from '../../systems/spriteAssets';
import Spinner from '../../components/ui/Spinner/Spinner';
import type { Rarity } from '../../systems/itemSystem';
import type { IQuest, IActiveQuest, IQuestGoal } from '../../stores/questStore';
import questsRaw from '../../data/quests.json';
import monstersRaw from '../../data/monsters.json';
import dungeonsRaw from '../../data/dungeons.json';
import bossesRaw from '../../data/bosses.json';
import imgTilesTasks from '../../assets/images/quests/quest-tasks.png';
import imgTilesQuests from '../../assets/images/quests/quests-quest.png';
import imgTilesDaily from '../../assets/images/quests/quests-daily.png';
import imgQuestPergamin from '../../assets/images/quests/quests-pergamin.png';
import { isBackendMode } from '../../config/backendMode';
import { backendApi } from '../../api/backend/backendApi';
import { syncFromBackend } from '../../api/backend/syncState';
import './Quests.scss';

const allQuests = questsRaw as IQuest[];

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

const resolveGoalTarget = (
  type: string,
  monsterId?: string,
  dungeonId?: string,
  bossId?: string,
): string => {
  if (type === 'kill' && monsterId) {
    const m = monsterMap.get(monsterId);
    return m ? m.name_pl : monsterId;
  }
  if (type === 'dungeon' && dungeonId) {
    const d = dungeonMap.get(dungeonId);
    return d ? d.name_pl : dungeonId;
  }
  if (type === 'boss' && bossId) {
    const b = bossMap.get(bossId);
    return b ? b.name_pl : bossId;
  }
  return monsterId ?? dungeonId ?? bossId ?? '';
};

const ELIXIR_ALIASES: Record<string, string> = {
  hp_sm: 'hp_potion_sm',
  hp_md: 'hp_potion_md',
  hp_lg: 'hp_potion_lg',
  hp_great: 'hp_potion_great',
  mp_sm: 'mp_potion_sm',
  mp_md: 'mp_potion_md',
  mp_lg: 'mp_potion_lg',
  mp_great: 'mp_potion_great',
  xp_elixir: 'xp_boost',
  skill_xp_elixir: 'skill_xp_boost',
  cooldown_elixir: 'cd_reduction_elixir',
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

type MainTab = 'home' | 'tasks' | 'quests' | 'daily';

const TASKS_PER_PAGE = 20;
const QUESTS_PER_PAGE = 20;

interface IMonsterMini {
  id: string;
  level: number;
  name_pl: string;
  xp: number;
  gold: [number, number];
}
const monstersMiniList = monstersRaw as unknown as IMonsterMini[];

const allTasks = (tasksRaw as ITask[]).map((t) => {
  const monster = monstersMiniList.find((m) => m.id === t.monsterId);
  if (!monster) return t;
  const { rewardGold, rewardXp } = computeTaskRewards(monster, t.killCount);
  return { ...t, rewardGold, rewardXp };
});


interface IClaimSummaryEntry {
  icon: string;
  label: string;
  rarity?: string;
  upgradeLevel?: number;
  itemLevel?: number;
}

interface IClaimSummary {
  questName: string;
  entries: IClaimSummaryEntry[];
}

const buildBackendClaimEntries = (res: unknown): IClaimSummaryEntry[] => {
  const entries: IClaimSummaryEntry[] = [];
  if (res && typeof res === 'object') {
    const obj = res as Record<string, unknown>;
    const reward = obj.reward && typeof obj.reward === 'object'
      ? (obj.reward as Record<string, unknown>)
      : obj;
    if (typeof reward.gold === 'number') {
      entries.push({ icon: 'money-bag', label: formatGoldShort(reward.gold) });
    }
    if (typeof reward.xp === 'number') {
      entries.push({ icon: 'sparkles', label: `${reward.xp.toLocaleString('pl-PL')} XP` });
    }
  }
  if (entries.length === 0) {
    entries.push({ icon: 'wrapped-gift', label: 'Nagroda odebrana' });
  }
  return entries;
};

const RARITY_COLORS: Record<string, string> = {
  common: '#9e9e9e', rare: '#2196f3', epic: '#4caf50',
  legendary: '#f44336', mythic: '#ffc107', heroic: '#9c27b0', unique: '#ff5722',
};

const HUB_CLASS_COLORS: Record<string, string> = {
  Knight: '#e53935', Mage: '#7b1fa2', Cleric: '#ffc107', Archer: '#4caf50',
  Rogue: '#424242', Necromancer: '#795548', Bard: '#ff9800',
};

const hexToRgb = (hex: string): string => {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return '233, 69, 96';
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `${r}, ${g}, ${b}`;
};

const Pagination = ({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (next: number) => void;
}) => (
  <div className="quests__pagination">
    <button
      type="button"
      className="quests__pagination-btn"
      disabled={page <= 0}
      onClick={() => onChange(Math.max(0, page - 1))}
    >
      <Icon name="arrowLeft" /> Poprzednia
    </button>
    <span className="quests__pagination-info">
      Strona {page + 1} / {totalPages}
    </span>
    <button
      type="button"
      className="quests__pagination-btn"
      disabled={page >= totalPages - 1}
      onClick={() => onChange(Math.min(totalPages - 1, page + 1))}
    >
      Następna <Icon name="arrowRight" />
    </button>
  </div>
);

const Quests = () => {
  void useNavigate;
  const location = useLocation();
  const [mainTab, setMainTab] = useState<MainTab>('home');
  useEffect(() => {
    queueMicrotask(() => setMainTab('home'));
  }, [location.key]);
  const [filter, setFilter] = useState<TabFilter>('all');
  const [taskPage, setTaskPage] = useState(0);
  const taskLvlFilter = useSettingsStore((s) => s.taskFilterLvlFrom) ?? '';
  const setTaskLvlFilter = useSettingsStore((s) => s.setTaskFilterLvlFrom);
  const [cancelTaskTarget, setCancelTaskTarget] = useState<{ id: string; name: string } | null>(null);
  const [taskHistoryOpen, setTaskHistoryOpen] = useState(false);
  const taskAvailableOnly = useSettingsStore((s) => s.taskFilterAvailableOnly);
  const setTaskAvailableOnly = useSettingsStore((s) => s.setTaskFilterAvailableOnly);
  const taskInactiveOnly = useSettingsStore((s) => s.taskFilterInactiveOnly);
  const setTaskInactiveOnly = useSettingsStore((s) => s.setTaskFilterInactiveOnly);
  const taskSortDesc = useSettingsStore((s) => s.taskFilterSortDesc);
  const setTaskSortDesc = useSettingsStore((s) => s.setTaskFilterSortDesc);
  const [questPage, setQuestPage] = useState(0);
  const [questLvlFilter, setQuestLvlFilter] = useState<string>('');
  const [claimSummary, setClaimSummary] = useState<IClaimSummary | null>(null);
  const [abandonTarget, setAbandonTarget] = useState<{ id: string; name: string } | null>(null);
  const [showAbandonAllConfirm, setShowAbandonAllConfirm] = useState(false);
  const { activeQuests, completedQuestIds, startQuest, abandonQuest, claimQuest, isCompleted, isActive } = useQuestStore();
  const character = useCharacterStore((s) => s.character);
  const updateCharacter = useCharacterStore((s) => s.updateCharacter);
  const { addGold, addItem, addConsumable, addStones } = useInventoryStore(useShallow((s) => ({ addGold: s.addGold, addItem: s.addItem, addConsumable: s.addConsumable, addStones: s.addStones })));
  const addXp = useCharacterStore((s) => s.addXp);
  const {
    activeTasks,
    completedTasks,
    startTask,
    claimReward: claimTaskReward,
    cancelTask,
  } = useTaskStore(useShallow((s) => ({ activeTasks: s.activeTasks, completedTasks: s.completedTasks, startTask: s.startTask, claimReward: s.claimReward, cancelTask: s.cancelTask })));
  const masteries = useMasteryStore((s) => s.masteries);
  const masteryKills = useMasteryStore((s) => s.masteryKills);
  const getHighestTransformColor = useTransformStore((s) => s.getHighestTransformColor);
  const transformColor = getHighestTransformColor();
  const classColorFallback = character ? (HUB_CLASS_COLORS[character.class] ?? '#e94560') : '#e94560';
  const tileAccent = (() => {
    if (!transformColor) return classColorFallback;
    if (transformColor.solid) return transformColor.solid;
    if (transformColor.gradient) return transformColor.gradient[0];
    return classColorFallback;
  })();
  const tileAccentRgb = hexToRgb(tileAccent);
  const { activeQuests: dailyActiveQuests, todayQuestDefs, refreshIfNeeded, claimReward } = useDailyQuestStore(useShallow((s) => ({ activeQuests: s.activeQuests, todayQuestDefs: s.todayQuestDefs, refreshIfNeeded: s.refreshIfNeeded, claimReward: s.claimReward })));

  const backendCharId = character?.id ?? null;

  useEffect(() => {
    if (isBackendMode()) return;
    if (character) {
      refreshIfNeeded(character.level);
    }
  }, [character, refreshIfNeeded]);

  useEffect(() => {
    if (!isBackendMode() || !backendCharId) return;
    void (async () => {
      try {
        await backendApi.refreshDailyQuests(backendCharId);
        await syncFromBackend(backendCharId);
      } catch (e) {
        console.warn('[quests] backend refreshDailyQuests failed', e);
      }
    })();
  }, [backendCharId]);

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

  const handleClaimDaily = async (questId: string) => {
    if (!character) return;

    if (isBackendMode()) {
      try {
        await backendApi.claimDailyQuest(character.id, questId);
        await syncFromBackend(character.id);
        return;
      } catch (e) {
        console.warn('[quests] backend claimDailyQuest failed', e);
        return;
      }
    }

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
    return (
      getConsumableImage(id)
      ?? (elixir?.icon)
      ?? getElixirImage('stat_reset')
      ?? 'test-tube'
    );
  };

  const getElixirDescription = (rawId: string): string => {
    const id = resolveElixirId(rawId);
    const elixir = ELIXIRS.find((e) => e.id === id);
    return elixir ? elixir.description_pl : '';
  };

  const handleClaimQuest = async (questId: string) => {
    const quest = allQuests.find((q) => q.id === questId);
    if (!quest || !character) return;

    if (isBackendMode()) {
      try {
        const res = await backendApi.claimQuest(character.id, questId);
        await syncFromBackend(character.id);
        setClaimSummary({ questName: quest.name_pl, entries: buildBackendClaimEntries(res) });
        return;
      } catch (e) {
        console.warn('[quests] backend claimQuest failed', e);
        return;
      }
    }

    const summaryEntries: IClaimSummaryEntry[] = [];

    for (const reward of quest.rewards) {
      const amount = reward.amount ?? 1;

      switch (reward.type) {
        case 'gold': {
          addGold(amount);
          summaryEntries.push({ icon: 'money-bag', label: formatGoldShort(amount) });
          break;
        }

        case 'xp': {
          const xpResult = addXp(amount);
          let xpLabel = `${amount.toLocaleString('pl-PL')} XP`;
          if (xpResult.levelsGained > 0) {
            xpLabel += ` (Level Up! -> ${xpResult.newLevel})`;
          }
          summaryEntries.push({ icon: 'sparkles', label: xpLabel });
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
              const itemIcon = displayInfo ? displayInfo.icon : 'wrapped-gift';
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
            summaryEntries.push({ icon: STONE_ICONS[stoneKey] ?? 'gem-stone', label: `${stoneName} x${amount}` });
          }
          break;
        }

        case 'gift': {
          break;
        }

        case 'stat_points': {
          updateCharacter({
            stat_points: (character.stat_points ?? 0) + amount,
          });
          summaryEntries.push({ icon: 'star', label: `+${amount} punktow statystyk` });
          break;
        }
      }
    }

    const hasExplicitItem = quest.rewards.some((r) => r.type === 'item');
    if (!hasExplicitItem) {
      const GIFT_RARITIES: Rarity[] = ['rare', 'epic', 'legendary', 'mythic'];
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
        const itemIcon = displayInfo ? displayInfo.icon : 'wrapped-gift';
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


  const claimableQuests = activeQuests.filter((aq) =>
    aq.goals.every((g) => (g.progress ?? 0) >= g.count),
  );

  const handleClaimAll = async () => {
    if (!character || claimableQuests.length === 0) return;

    if (isBackendMode()) {
      const entries: IClaimSummaryEntry[] = [];
      const count = claimableQuests.length;
      try {
        for (const aq of claimableQuests) {
          const res = await backendApi.claimQuest(character.id, aq.questId);
          entries.push(...buildBackendClaimEntries(res));
        }
      } catch (e) {
        console.warn('[quests] backend claimQuest (bulk) failed', e);
      }
      try {
        await syncFromBackend(character.id);
      } catch (e) {
        console.warn('[quests] backend sync (claim-all) failed', e);
      }
      if (entries.length > 0) {
        setClaimSummary({ questName: `${count} questow`, entries });
      }
      return;
    }

    const allEntries: IClaimSummaryEntry[] = [];

    for (const aq of claimableQuests) {
      const quest = allQuests.find((q) => q.id === aq.questId);
      if (!quest) continue;

      for (const reward of quest.rewards) {
        const amount = reward.amount ?? 1;
        switch (reward.type) {
          case 'gold': {
            addGold(amount);
            allEntries.push({ icon: 'money-bag', label: formatGoldShort(amount) });
            break;
          }
          case 'xp': {
            const xpResult = addXp(amount);
            let xpLabel = `${amount.toLocaleString('pl-PL')} XP`;
            if (xpResult.levelsGained > 0) {
              xpLabel += ` (Level Up! -> ${xpResult.newLevel})`;
            }
            allEntries.push({ icon: 'sparkles', label: xpLabel });
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
                const itemIcon = displayInfo ? displayInfo.icon : 'wrapped-gift';
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
              allEntries.push({ icon: STONE_ICONS[stoneKey] ?? 'gem-stone', label: `${stoneName} x${amount}` });
            }
            break;
          }
          case 'stat_points': {
            updateCharacter({ stat_points: (character.stat_points ?? 0) + amount });
            allEntries.push({ icon: 'star', label: `+${amount} punktow statystyk` });
            break;
          }
        }
      }

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
          const itemIcon = displayInfo ? displayInfo.icon : 'wrapped-gift';
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

  const handleClaimAllDaily = async () => {
    if (!character) return;
    const claimable = dailyActiveQuests.filter((a) => a.completed && !a.claimed);

    if (isBackendMode()) {
      const entries: IClaimSummaryEntry[] = [];
      let claimedCount = 0;
      for (const aq of claimable) {
        try {
          const res = await backendApi.claimDailyQuest(character.id, aq.questId);
          entries.push(...buildBackendClaimEntries(res));
          await syncFromBackend(character.id);
          claimedCount += 1;
        } catch (e) {
          console.warn('[quests] backend claimDailyQuest (bulk item) failed', e);
        }
      }
      if (entries.length > 0) {
        setClaimSummary({ questName: `${claimedCount} questow dziennych`, entries });
      }
      return;
    }

    const allEntries: IClaimSummaryEntry[] = [];

    for (const aq of claimable) {
      const def = todayQuestDefs.find((d) => d.id === aq.questId);
      if (!def) continue;
      const rewards = claimReward(aq.questId, character.level);
      if (!rewards) continue;
      addGold(rewards.gold);
      addXp(rewards.xp);
      allEntries.push({ icon: 'money-bag', label: formatGoldShort(rewards.gold) });
      allEntries.push({ icon: 'sparkles', label: `${rewards.xp.toLocaleString('pl-PL')} XP` });
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
    return true;
  }).sort((a, b) => a.minLevel - b.minLevel);

  const activeCount = activeQuests.length;
  const completedCount = completedQuestIds.length;
  const availableCount = allQuests.filter(isQuestAvailable).length;

  const isDailyLocked = (character?.level ?? 0) < 25;

  const renderDailyTab = () => {
    if (!character) {
      return (
        <div className="quests__loading">
          <Spinner size="lg" />
        </div>
      );
    }

    if (isDailyLocked) {
      return (
        <div className="quests__daily-locked">
          <span className="quests__daily-locked-icon"><GameIcon name="locked" /></span>
          <p>Questy dzienne odblokuja sie na poziomie 25</p>
          <p className="quests__daily-locked-sub">Twoj poziom: {character.level}</p>
        </div>
      );
    }

    const dailyClaimable = dailyActiveQuests.filter((a) => a.completed && !a.claimed);

    return (
      <>
        {dailyClaimable.length > 0 && (
          <div className="quests__bulk-actions quests__bulk-actions--center">
            <button className="quests__bulk-btn quests__bulk-btn--claim" onClick={handleClaimAllDaily}>
              <GameIcon name="wrapped-gift" /> Odbierz wszystkie daily ({dailyClaimable.length})
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
              style={{
                '--card-pergamin': `url(${imgQuestPergamin})`,
                '--card-accent': tileAccent,
              } as React.CSSProperties}
            >
              <span className="quests__card-level">Lvl {def.minLevel}</span>

              <div className="quests__card-pergamin">
                <div className="quests__daily-quest-header">
                  <h3 className="quests__daily-quest-name">{def.name_pl}</h3>
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

                <span className="quests__daily-rewards-label">Nagrody:</span>
                <div className="quests__daily-rewards">
                  <span className="quests__daily-reward"><GameIcon name="money-bag" /> {formatGoldShort(rewards.gold)}</span>
                  <span className="quests__daily-reward"><GameIcon name="sparkles" /> {rewards.xp.toLocaleString('pl-PL')} XP</span>
                  {rewards.elixir && (
                    <span className="quests__daily-reward">
                      <TinyIcon icon={getElixirImage(rewards.elixir) ?? 'test-tube'} size="sm" /> Eliksir
                    </span>
                  )}
                </div>

                {(active.completed || active.claimed) && (
                  <div className="quests__card-actions-row">
                    <span className="quests__card-actions-spacer" />
                    {active.completed && !active.claimed && (
                      <button
                        className="quests__action-btn quests__action-btn--claim"
                        onClick={() => handleClaimDaily(def.id)}
                      >
                        <GameIcon name="wrapped-gift" /> Odbierz nagrodę
                      </button>
                    )}
                    {active.claimed && (
                      <span className="quests__completed-label"><GameIcon name="check-mark-button" /> Odebrane</span>
                    )}
                  </div>
                )}
              </div>
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

  const renderHomeTab = () => {
    const tasksClaimable = activeTasks.some((t) => t.progress >= t.killCount);
    const questsClaimable = claimableQuests.length > 0;
    const dailyClaimable = dailyActiveQuests.some((a) => a.completed && !a.claimed);
    const hubTiles: Array<{ id: MainTab; label: string; bg: string; claimable: boolean }> = [
      { id: 'tasks',  label: 'Taski',         bg: imgTilesTasks,  claimable: tasksClaimable  },
      { id: 'quests', label: 'Questy',        bg: imgTilesQuests, claimable: questsClaimable },
      { id: 'daily',  label: 'Dzienne misje', bg: imgTilesDaily,  claimable: dailyClaimable  },
    ];
    return (
      <div
        className="quests__hub"
        style={{
          '--tile-accent': tileAccent,
          '--tile-accent-rgb': tileAccentRgb,
        } as React.CSSProperties}
      >
        <div className="quests__hub-inner">
          {hubTiles.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`quests__hub-tile quests__hub-tile--${t.id}${t.claimable ? ' quests__hub-tile--claimable' : ''}`}
              onClick={() => setMainTab(t.id)}
              aria-label={t.label}
            >
              <span
                className="quests__hub-tile-bg"
                aria-hidden="true"
                style={{ backgroundImage: `url(${t.bg})` }}
              />
              <span className="quests__hub-tile-shade" aria-hidden="true" />
              <span className="quests__hub-tile-title">{t.label}</span>
              {t.claimable && (
                <span className="quests__hub-tile-claim-dot" aria-hidden="true" />
              )}
            </button>
          ))}
        </div>
      </div>
    );
  };

  const characterLevel = character?.level ?? 1;
  const getTaskUnlock = (monsterId: string) => {
    const monster = monstersMiniList.find((m) => m.id === monsterId);
    if (!monster) return { unlocked: true as const };
    return getMonsterUnlockStatus(monster, monstersMiniList, characterLevel, masteries);
  };
  const handleStartTask = (task: ITask) => {
    if (activeTasks.some((t) => t.monsterId === task.monsterId)) return;
    const unlock = getTaskUnlock(task.monsterId);
    if (!unlock.unlocked) return;
    startTask(task);
  };
  const monsterHasActiveTask = (monsterId: string) =>
    activeTasks.some((t) => t.monsterId === monsterId);

  const renderMasteryBar = (monsterId: string) => {
    const level = masteries[monsterId]?.level ?? 0;
    const kills = masteryKills[monsterId] ?? 0;
    if (level === 0 && kills === 0) return null;
    const isMax = level >= MASTERY_MAX_LEVEL;
    const required = isMax ? 0 : MASTERY_KILL_THRESHOLD * (level + 1);
    const pct = isMax ? 100 : Math.min(100, Math.floor((kills / required) * 100));
    if (isMax) {
      return (
        <div className="tasks__inline-mastery tasks__inline-mastery--max tasks__inline-mastery--max-pill">
          <span className="tasks__inline-mastery-max-text">
            <GameIcon name="crown" /> Mastery {MASTERY_MAX_LEVEL}/{MASTERY_MAX_LEVEL}
          </span>
        </div>
      );
    }
    return (
      <div className="tasks__inline-mastery">
        <span className="tasks__inline-mastery-badge">
          Mastery {level}/{MASTERY_MAX_LEVEL}
        </span>
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
      </div>
    );
  };

  const renderTasksTab = () => {
    const lvlFilter = taskLvlFilter.trim();
    const lvlNum = lvlFilter ? parseInt(lvlFilter, 10) : NaN;
    const filtered = [...allTasks]
      .filter((t) => (Number.isFinite(lvlNum) ? t.monsterLevel >= lvlNum : true))
      .filter((t) => {
        if (!taskAvailableOnly) return true;
        const unlock = getTaskUnlock(t.monsterId);
        if (!unlock.unlocked) return false;
        if (
          activeTasks.some((a) => a.monsterId === t.monsterId && a.id !== t.id)
        ) {
          return false;
        }
        return true;
      })
      .filter((t) => {
        if (!taskInactiveOnly) return true;
        return !activeTasks.some((a) => a.monsterId === t.monsterId);
      })
      .sort((a, b) => {
        if (a.monsterLevel !== b.monsterLevel) {
          return taskSortDesc
            ? b.monsterLevel - a.monsterLevel
            : a.monsterLevel - b.monsterLevel;
        }
        return a.killCount - b.killCount;
      });

    const groupedEntries: Array<[string, ITask[]]> = [];
    const seen = new Map<string, ITask[]>();
    for (const t of filtered) {
      const list = seen.get(t.monsterId) ?? [];
      list.push(t);
      if (!seen.has(t.monsterId)) {
        seen.set(t.monsterId, list);
        groupedEntries.push([t.monsterId, list]);
      }
    }

    const totalPages = Math.max(1, Math.ceil(groupedEntries.length / TASKS_PER_PAGE));
    const safePage = Math.min(taskPage, totalPages - 1);
    const pageStart = safePage * TASKS_PER_PAGE;
    const pageGroups = groupedEntries.slice(pageStart, pageStart + TASKS_PER_PAGE);

    return (
      <>
        {activeTasks.length > 0 && (
          <div
            className="tasks__active-box"
            style={{ '--task-accent': tileAccent } as React.CSSProperties}
          >
            <div className="tasks__active-box-head">
              <span className="tasks__active-box-title"><GameIcon name="clipboard" /> Aktywne taski</span>
              <span className="tasks__active-box-count">{activeTasks.length}</span>
            </div>
            <div className="tasks__active-list tasks__active-list--compact">
            {[...activeTasks]
              .sort((a, b) => {
                const aDone = a.progress >= a.killCount ? 1 : 0;
                const bDone = b.progress >= b.killCount ? 1 : 0;
                if (aDone !== bDone) return bDone - aDone;
                const aLvl = monstersMiniList.find((m) => m.id === a.monsterId)?.level ?? a.monsterLevel ?? 0;
                const bLvl = monstersMiniList.find((m) => m.id === b.monsterId)?.level ?? b.monsterLevel ?? 0;
                return aLvl - bLvl;
              })
              .map((activeTask) => {
              const isComplete = activeTask.progress >= activeTask.killCount;
              const pct = Math.min(100, Math.floor((activeTask.progress / activeTask.killCount) * 100));
              const activeMonster = monstersMiniList.find((m) => m.id === activeTask.monsterId);
              const activeLvl = activeMonster?.level ?? 1;
              return (
                <div
                  key={activeTask.id}
                  className={`tasks__active-row${isComplete ? ' tasks__active-row--done' : ''}`}
                  style={{ '--task-accent': tileAccent } as React.CSSProperties}
                >
                  <div className="tasks__active-row-left">
                    <MonsterSprite
                      level={activeLvl}
                      sprite={(activeMonster as { sprite?: string } | undefined)?.sprite}
                      name={activeTask.monsterName}
                      className="tasks__active-row-thumb"
                      fill={false}
                    />
                    <div className="tasks__active-row-meta">
                      <span className="tasks__active-row-name">
                        {activeTask.monsterName} × {activeTask.killCount.toLocaleString('pl-PL')}
                      </span>
                      <span className="tasks__active-row-lvl">Lvl {activeLvl}</span>
                    </div>
                  </div>
                  {isComplete ? (
                    <button
                      type="button"
                      className="tasks__active-row-claim"
                      onClick={() => claimTaskReward(activeTask.id)}
                    >
                      <GameIcon name="wrapped-gift" /> Odbierz
                    </button>
                  ) : (
                    <>
                      <div className="tasks__active-row-progress">
                        <div className="tasks__active-row-bar">
                          <div className="tasks__active-row-bar-fill" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="tasks__active-row-count">
                          {activeTask.progress.toLocaleString('pl-PL')} / {activeTask.killCount.toLocaleString('pl-PL')}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="tasks__active-row-cancel"
                        onClick={() => setCancelTaskTarget({ id: activeTask.id, name: activeTask.monsterName })}
                        title="Zrezygnuj z taska"
                        aria-label="Zrezygnuj z taska"
                      >
                        <Icon name="x" />
                      </button>
                    </>
                  )}
                </div>
              );
            })}
            </div>
          </div>
        )}

        <div className="quests__sub-controls">
          <button
            type="button"
            className={`quests__filter-chip${taskAvailableOnly ? ' quests__filter-chip--on' : ''}`}
            onClick={() => { setTaskAvailableOnly(!taskAvailableOnly); setTaskPage(0); }}
            title="Pokaż tylko taski, które możesz teraz zacząć"
          >
            <GameIcon name="check-mark-button" /> Dostępne taski
          </button>
          <button
            type="button"
            className={`quests__filter-chip${taskInactiveOnly ? ' quests__filter-chip--on' : ''}`}
            onClick={() => { setTaskInactiveOnly(!taskInactiveOnly); setTaskPage(0); }}
            title="Pokaż tylko monstera bez aktywnego taska"
          >
            <GameIcon name="stop-sign" /> Nieaktywne taski
          </button>
          <button
            type="button"
            className={`quests__filter-chip${taskSortDesc ? ' quests__filter-chip--on' : ''}`}
            onClick={() => { setTaskSortDesc(!taskSortDesc); setTaskPage(0); }}
            title="Sortuj od najwyższego poziomu"
          >
            <GameIcon name="down-arrow" /> Sortuj od najwyższego lvl
          </button>
          <input
            type="number"
            min={1}
            placeholder="Lvl od…"
            className="quests__lvl-filter"
            value={taskLvlFilter}
            onChange={(e) => { setTaskLvlFilter(e.target.value); setTaskPage(0); }}
          />
          <span className="quests__sub-controls-meta">
            {activeTasks.length} aktywne · {groupedEntries.length} potworów
            <button
              type="button"
              className="quests__history-btn"
              onClick={() => setTaskHistoryOpen(true)}
              title="Historia ukończonych tasków"
              aria-label="Historia tasków"
            >
              <GameIcon name="books" />
              {completedTasks.length > 0 && (
                <span className="quests__history-btn-badge">{completedTasks.length}</span>
              )}
            </button>
          </span>
        </div>

        <div className="tasks__list">
          {pageGroups.map(([monsterId, tasks]) => {
            const monsterTaken = monsterHasActiveTask(monsterId);
            const unlock = getTaskUnlock(monsterId);
            const isLocked = !unlock.unlocked;
            const monsterRecord = monstersMiniList.find((m) => m.id === monsterId);
            return (
              <div key={monsterId} className={`tasks__monster-group-wrap${isLocked ? ' tasks__monster-group-wrap--locked' : ''}`}>
                {renderMasteryBar(monsterId)}
                <div
                  className={`tasks__monster-group tasks__monster-group--with-corner-lvl${monsterTaken ? ' tasks__monster-group--taken' : ''}${isLocked ? ' tasks__monster-group--locked' : ''}`}
                  title={isLocked ? unlock.reason : undefined}
                  style={{ '--task-accent': tileAccent } as React.CSSProperties}
                >
                  <span className="tasks__monster-level tasks__monster-level--corner">
                    Lvl {tasks[0].monsterLevel}
                  </span>
                  <div className="tasks__monster-header">
                    <span className="tasks__monster-name">
                      <MonsterSprite
                        level={tasks[0].monsterLevel}
                        sprite={(monsterRecord as { sprite?: string } | undefined)?.sprite}
                        name={tasks[0].monsterName}
                        className="tasks__monster-thumb"
                        fill={false}
                      />
                      <span className="tasks__monster-name-label">{tasks[0].monsterName}</span>
                      {monsterTaken && <span className="tasks__monster-active-badge"><GameIcon name="clipboard" /> Aktywny</span>}
                      {isLocked && <span className="tasks__monster-locked-badge"><EmojiText>{unlock.shortLabel}</EmojiText></span>}
                    </span>
                  </div>
                  <div className="tasks__threshold-list">
                    {tasks.map((task) => {
                      const activeForThis = activeTasks.find((t) => t.id === task.id);
                      const isActive = !!activeForThis;
                      const isCompletedTask = isActive && activeForThis!.progress >= activeForThis!.killCount;
                      const isDisabled = !isActive && (monsterTaken || isLocked);
                      return (
                        <button
                          key={task.id}
                          className={[
                            'tasks__threshold-btn',
                            isActive ? 'tasks__threshold-btn--active' : '',
                            isCompletedTask ? 'tasks__threshold-btn--done' : '',
                          ].filter(Boolean).join(' ')}
                          onClick={() => handleStartTask(task)}
                          disabled={isDisabled}
                          title={
                            isLocked && !isActive
                              ? unlock.reason
                              : monsterTaken && !isActive
                                ? 'Masz juz task na tego potwora'
                                : undefined
                          }
                        >
                          <span className="tasks__threshold-kills">
                            {isActive ? `${activeForThis!.progress}/` : ''}{task.killCount} zabojstw
                          </span>
                          <span className="tasks__threshold-reward">
                            <GameIcon name="money-bag" /> {formatGoldShort(task.rewardGold)} · <GameIcon name="star" /> {task.rewardXp.toLocaleString('pl-PL')} XP
                          </span>
                          {isCompletedTask && <span className="tasks__threshold-done"><GameIcon name="check-mark-button" /> Gotowe!</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
          {pageGroups.length === 0 && (
            <p className="quests__empty">Brak taskow w tej kategorii.</p>
          )}
        </div>

        {totalPages > 1 && (
          <Pagination page={safePage} totalPages={totalPages} onChange={setTaskPage} />
        )}

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
        <div className="quests__bulk-actions quests__bulk-actions--inline">
          {hasClaimable && (
            <button className="quests__bulk-btn quests__bulk-btn--claim" onClick={handleClaimAll}>
              <GameIcon name="wrapped-gift" /> Odbierz wszystkie ({claimableQuests.length})
            </button>
          )}
          {hasAvailable && (
            <button className="quests__bulk-btn quests__bulk-btn--accept" onClick={handleAcceptAll}>
              <GameIcon name="scroll" /> Weź wszystkie
            </button>
          )}
          {hasActive && (
            <button className="quests__bulk-btn quests__bulk-btn--abandon" onClick={() => setShowAbandonAllConfirm(true)}>
              <Icon name="x" /> Porzuć wszystkie ({activeQuests.length})
            </button>
          )}
        </div>
      )}
      <div className="quests__filters quests__filters--with-lvl">
        {([
          ['all', `Wszystkie (${allQuests.length})`],
          ['active', `Aktywne (${activeCount})`],
          ['available', `Dostępne (${availableCount})`],
          ['completed', `Ukończone (${completedCount})`],
        ] as [TabFilter, string][]).map(([f, label]) => (
          <button
            key={f}
            className={`quests__filter-btn${filter === f ? ' quests__filter-btn--active' : ''}`}
            onClick={() => { setFilter(f); setQuestPage(0); }}
          >
            {label}
          </button>
        ))}
        <input
          type="number"
          min={1}
          placeholder="Lvl od…"
          className="quests__lvl-filter quests__lvl-filter--inline"
          value={questLvlFilter}
          onChange={(e) => { setQuestLvlFilter(e.target.value); setQuestPage(0); }}
        />
        <span className="quests__sub-controls-meta">
          {filteredQuests.length} questów
        </span>
      </div>

      {(() => {
        const lvlFilter = questLvlFilter.trim();
        const lvlNum = lvlFilter ? parseInt(lvlFilter, 10) : NaN;
        const list = Number.isFinite(lvlNum)
          ? filteredQuests.filter((q) => q.minLevel === lvlNum)
          : filteredQuests;
        const totalPages = Math.max(1, Math.ceil(list.length / QUESTS_PER_PAGE));
        const safePage = Math.min(questPage, totalPages - 1);
        const start = safePage * QUESTS_PER_PAGE;
        const pageList = list.slice(start, start + QUESTS_PER_PAGE);
        return (
          <>
      <div className="quests__list">
        {pageList.length === 0 && (
          <p className="quests__empty">Brak questów w tej kategorii.</p>
        )}
        {pageList.map((quest) => {
          const aq = getActiveQuest(quest.id);
          const completed = isCompleted(quest.id);
          const active = isActive(quest.id);
          const available = isQuestAvailable(quest);
          const tooHigh = charLevel < quest.minLevel;
          const canClaim = active && isQuestComplete(quest.id);

          return (
            <div
              key={quest.id}
              className={[
                'quests__card',
                completed ? 'quests__card--completed' : '',
                active ? 'quests__card--active' : '',
                tooHigh ? 'quests__card--locked' : '',
              ].filter(Boolean).join(' ')}
              style={{
                '--card-pergamin': `url(${imgQuestPergamin})`,
                '--card-accent': tileAccent,
              } as React.CSSProperties}
            >
              <span className="quests__card-level">Lvl {quest.minLevel}</span>

              <div className="quests__card-pergamin">
                <div className="quests__card-header">
                  <div className="quests__card-title-row">
                    {completed && <span className="quests__check"><GameIcon name="check-mark-button" /></span>}
                    {tooHigh && <span className="quests__lock"><GameIcon name="locked" /></span>}
                    <h3 className="quests__card-name">{quest.name_pl}</h3>
                  </div>
                </div>

              <p className="quests__card-desc">{quest.description_pl}</p>

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

              <div className="quests__rewards">
                <span className="quests__rewards-label">Nagrody:</span>
                {[...quest.rewards, { type: 'gift' as const, amount: 1 }].map((r, i) => {
                  let icon = 'wrapped-gift';
                  let text = '';
                  let titleText = '';
                  let chipClass = 'quests__reward-chip';
                  if (r.type === 'gold') {
                    icon = 'money-bag';
                    text = formatGoldShort(r.amount ?? 0);
                    titleText = `${text} zlota`;
                  } else if (r.type === 'xp') {
                    icon = 'sparkles';
                    text = (r.amount ?? 0).toLocaleString('pl-PL');
                    titleText = `${text} XP`;
                  } else if (r.type === 'elixir') {
                    const eid = r.elixirId ?? '';
                    icon = getElixirIcon(eid);
                    const eName = getElixirName(eid);
                    const eDesc = getElixirDescription(eid);
                    text = `×${r.amount ?? 1}`;
                    titleText = `${eName} ×${r.amount ?? 1}${eDesc ? ` — ${eDesc}` : ''}`;
                    const resolvedId = resolveElixirId(eid);
                    if (!resolvedId.startsWith('hp_potion_') && !resolvedId.startsWith('mp_potion_')) {
                      chipClass += ' quests__reward-chip--elixir';
                    }
                  } else if (r.type === 'stat_points') {
                    icon = 'star';
                    text = `+${r.amount ?? 0}`;
                    titleText = `+${r.amount ?? 0} pkt. statystyk`;
                  } else if (r.type === 'item') {
                    const rarity = (r.rarity ?? 'rare') as Rarity;
                    icon = 'wrapped-gift';
                    text = `×${r.amount ?? 1}`;
                    titleText = `${RARITY_LABELS[rarity] ?? rarity} Item ×${r.amount ?? 1}`;
                  } else if (r.type === 'stones' || r.type === 'stone') {
                    const stoneKey = r.stoneId ?? r.stoneType ?? '';
                    icon = STONE_ICONS[stoneKey] ?? 'gem-stone';
                    text = `×${r.amount ?? 1}`;
                    titleText = `${STONE_NAMES[stoneKey] ?? stoneKey} ×${r.amount ?? 1}`;
                  } else if (r.type === 'gift') {
                    icon = 'wrapped-gift';
                    text = '';
                    titleText = 'Losowy przedmiot (Rare / Epic / Legendary / Mythic)';
                  }
                  return (
                    <span key={i} className={chipClass} title={titleText}>
                      <span className="quests__reward-chip-icon"><TinyIcon icon={icon} size="sm" /></span>
                      {text && <span className="quests__reward-chip-text">{text}</span>}
                    </span>
                  );
                })}
              </div>

              <div className="quests__card-actions-row">
                {active && !canClaim && (
                  <button
                    className="quests__action-btn quests__action-btn--abandon"
                    onClick={() => setAbandonTarget({ id: quest.id, name: quest.name_pl })}
                  >
                    <Icon name="x" /> Porzuć
                  </button>
                )}
                <span className="quests__card-actions-spacer" />
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
                    <GameIcon name="wrapped-gift" /> Odbierz nagrodę
                  </button>
                )}
                {completed && (
                  <span className="quests__completed-label"><GameIcon name="check-mark-button" /> Ukończono</span>
                )}
                {tooHigh && !completed && (
                  <span className="quests__locked-label">
                    <GameIcon name="locked" /> Wymagany poziom {quest.minLevel}
                  </span>
                )}
              </div>
              </div>
            </div>
          );
        })}
      </div>
      {totalPages > 1 && (
        <Pagination page={safePage} totalPages={totalPages} onChange={setQuestPage} />
      )}
          </>
        );
      })()}
    </>
    );
  };

  return (
    <div className="quests">


      {mainTab === 'home' && renderHomeTab()}
      {mainTab === 'tasks' && renderTasksTab()}
      {mainTab === 'quests' && renderQuestsTab()}
      {mainTab === 'daily' && renderDailyTab()}

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
                    <span className="quests__claim-modal-icon"><TinyIcon icon={entry.icon} size="lg" /></span>
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

      {showAbandonAllConfirm && (
        <div className="quests__overlay" onClick={() => setShowAbandonAllConfirm(false)}>
          <motion.div
            className="quests__abandon-modal"
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            onClick={(e) => e.stopPropagation()}
          >
            <span className="quests__abandon-modal-icon"><GameIcon name="warning" /></span>
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
                <Icon name="x" /> Porzuc wszystkie
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {taskHistoryOpen && (
        <div className="quests__overlay" onClick={() => setTaskHistoryOpen(false)}>
          <motion.div
            className="quests__claim-modal quests__history-modal"
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="quests__history-modal-head">
              <span className="quests__history-modal-title"><GameIcon name="books" /> Historia tasków</span>
              <button
                className="quests__modal-close"
                onClick={() => setTaskHistoryOpen(false)}
                aria-label="Zamknij"
              >
                ×
              </button>
            </div>
            {completedTasks.length === 0 ? (
              <p className="quests__empty">Brak ukończonych tasków.</p>
            ) : (
              <div className="quests__history-list">
                {completedTasks.map((ct) => {
                  const monster = monstersMiniList.find((m) => m.name_pl === ct.monsterName);
                  const lvl = monster?.level ?? 0;
                  const imgUrl = getMonsterImageNearest(lvl);
                  return (
                    <div key={ct.id} className="quests__history-row">
                      {imgUrl ? (
                        <img
                          className="quests__history-row-thumb"
                          src={imgUrl}
                          alt={ct.monsterName}
                          draggable={false}
                        />
                      ) : (
                        <MonsterSprite
                          level={lvl}
                          sprite={(monster as { sprite?: string } | undefined)?.sprite}
                          name={ct.monsterName}
                          className="quests__history-row-thumb"
                          fill={false}
                        />
                      )}
                      <div className="quests__history-row-info">
                        <span className="quests__history-row-name">{ct.monsterName}</span>
                        <span className="quests__history-row-task">
                          <GameIcon name="check-mark-button" /> {ct.killCount.toLocaleString('pl-PL')} zabójstw
                        </span>
                      </div>
                      <span className="quests__history-row-rewards">
                        <GameIcon name="money-bag" /> +{formatGoldShort(ct.rewardGold)} · <GameIcon name="star" /> +{(ct.rewardXp || 0).toLocaleString('pl-PL')} XP
                      </span>
                      <span className="quests__history-row-date">
                        {new Date(ct.completedAt).toLocaleDateString('pl-PL')}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </motion.div>
        </div>
      )}

      {cancelTaskTarget && (
        <div className="quests__overlay" onClick={() => setCancelTaskTarget(null)}>
          <motion.div
            className="quests__abandon-modal"
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            onClick={(e) => e.stopPropagation()}
          >
            <span className="quests__abandon-modal-icon"><GameIcon name="warning" /></span>
            <h2 className="quests__abandon-modal-title">Zrezygnować z taska?</h2>
            <p className="quests__abandon-modal-quest">{cancelTaskTarget.name}</p>
            <p className="quests__abandon-modal-warn">
              Cały postęp na tym tasku zostanie utracony.
            </p>
            <div className="quests__abandon-modal-actions">
              <button
                className="quests__abandon-modal-btn quests__abandon-modal-btn--cancel"
                onClick={() => setCancelTaskTarget(null)}
              >
                Anuluj
              </button>
              <button
                className="quests__abandon-modal-btn quests__abandon-modal-btn--confirm"
                onClick={() => {
                  cancelTask(cancelTaskTarget.id);
                  setCancelTaskTarget(null);
                }}
              >
                <Icon name="x" /> Zrezygnuj
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {abandonTarget && (
        <div className="quests__overlay" onClick={() => setAbandonTarget(null)}>
          <motion.div
            className="quests__abandon-modal"
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            onClick={(e) => e.stopPropagation()}
          >
            <span className="quests__abandon-modal-icon"><GameIcon name="warning" /></span>
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
                <Icon name="x" /> Porzuć
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
};

export default Quests;
