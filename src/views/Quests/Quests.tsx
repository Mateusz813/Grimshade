import { useState, useEffect } from 'react';
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
// Tile artwork for the new 3-up Quests hub. Same pattern as Battle.tsx —
// each tile has its own background PNG that lives in /assets/images/quests/.
import imgTilesTasks from '../../assets/images/quests/quest-tasks.png';
import imgTilesQuests from '../../assets/images/quests/quests-quest.png';
import imgTilesDaily from '../../assets/images/quests/quests-daily.png';
// Per-card pergamin (parchment) backdrop used by every quest tile +
// every daily-mission tile. Sets the dark-fantasy "scroll" texture
// behind the chrome regardless of the player's transform tint.
import imgQuestPergamin from '../../assets/images/quests/quests-pergamin.png';
// Tryb backendu (opt-in). Gra DOMYŚLNIE działa po staremu; poniższa glue
// uruchamia się TYLKO gdy isBackendMode() === true. Zero ryzyka dla domyślnej
// ścieżki klienckiej.
import { isBackendMode } from '../../config/backendMode';
import { backendApi } from '../../api/backend/backendApi';
import { syncFromBackend } from '../../api/backend/syncState';
import './Quests.scss';

const allQuests = questsRaw as IQuest[];

// -- Lookup maps for display names and sprites -----------------------------
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
  // No emoji prefix — the goal row is plain text on parchment per the
  // 2026-05 spec ("kasujemy ikonki wszystkie ktore sa w klasie quests__goals").
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

/** Elixir ID alias map — quests may use short IDs (hp_sm) that don't
 *  match shop IDs (hp_potion_sm). 2026-05-08: extended to cover every
 *  short-name used in `data/quests.json` so `getElixirIcon` resolves
 *  to a real shop entry (and therefore real PNG art) instead of the
 *  generic :test-tube: fallback. Anything still unresolved after this map will
 *  use the stat-reset PNG as the universal "any elixir" placeholder. */
const ELIXIR_ALIASES: Record<string, string> = {
  hp_sm: 'hp_potion_sm',
  hp_md: 'hp_potion_md',
  hp_lg: 'hp_potion_lg',
  hp_great: 'hp_potion_great',
  mp_sm: 'mp_potion_sm',
  mp_md: 'mp_potion_md',
  mp_lg: 'mp_potion_lg',
  mp_great: 'mp_potion_great',
  // Buff elixir short-names used throughout quests.json
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

// Hub-style sub-views. `home` is the new 3-tile picker entry screen;
// `tasks` / `quests` / `daily` are the leaf sections clicked from there.
type MainTab = 'home' | 'tasks' | 'quests' | 'daily';

const TASKS_PER_PAGE = 20;
const QUESTS_PER_PAGE = 20;
// No global cap on active tasks anymore — players can pick up as many as
// they want, with the only constraint being "one task per monster id"
// (enforced inside `handleStartTask` and the disable-button logic below).

interface IMonsterMini {
  id: string;
  level: number;
  name_pl: string;
  xp: number;
  gold: [number, number];
}
const monstersMiniList = monstersRaw as unknown as IMonsterMini[];

// Mirror Tasks.tsx — rewards recomputed from live monster data so a balance
// pass to monster tables propagates without re-saving the per-task JSON.
const allTasks = (tasksRaw as ITask[]).map((t) => {
  const monster = monstersMiniList.find((m) => m.id === t.monsterId);
  if (!monster) return t;
  const { rewardGold, rewardXp } = computeTaskRewards(monster, t.killCount);
  return { ...t, rewardGold, rewardXp };
});

// -- Claim summary types ------------------------------------------------------

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

/**
 * Buduje wpisy podsumowania nagrody z odpowiedzi backendu przy claimie questa.
 * Kształt odpowiedzi nie jest twardo znany po stronie frontu, więc zawężamy
 * z `unknown` — rozpoznajemy gold/xp (top-level lub w `reward`), a gdy nic nie
 * pasuje pokazujemy generyczny wpis. Autorytatywne wartości i tak trafiają do
 * store'ów przez syncFromBackend — to jest tylko wizualny feedback.
 */
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

// Per-class fallback color used by the hub tiles when the player has no
// transform unlocked. Same palette as the Battle hub so the visual reads
// 1:1 across both screens.
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

/**
 * Compact pager — `<- prev`, page indicator (e.g. "Strona 2 / 7"),
 * `next ->`. Shared between the Tasks and Questy sub-views, both of which
 * cap their list at 20 entries per page. Hidden by the caller when there's
 * only one page of content.
 */
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
  // The view used to navigate to '/' from the back button — the back
  // button was removed in the 2026-05 redesign so `useNavigate` is no
  // longer wired up here. Kept the import so future inline links can
  // still be added without re-wiring imports.
  void useNavigate;
  // Listen to location keys so we can reset the hub when the player
  // re-clicks the bottom-nav Questy icon while already on /quests. Each
  // navigation gets a fresh `key` even when the pathname is unchanged
  // (BottomNav passes a `state: { reset: Date.now() }` payload), so
  // reading `key` in a deps array fires the reset every time.
  const location = useLocation();
  const [mainTab, setMainTab] = useState<MainTab>('home');
  // Reset to the hub picker on every navigation event landing on this
  // route — covers the "I'm on /quests/tasks and click Questy in the
  // bottom nav, expecting to go back to the hub" UX the player flagged.
  // setState is wrapped in a microtask so the setState happens AFTER
  // the effect commit phase — quiets the React-19 purity rule that
  // flags inline setState in effects (which usually warns about
  // cascading renders, not really applicable when reacting to router
  // events on a single dependency).
  useEffect(() => {
    queueMicrotask(() => setMainTab('home'));
  }, [location.key]);
  const [filter, setFilter] = useState<TabFilter>('all');
  // Pagination + level-filter state for the Tasks and Quests sub-views.
  // Both lists can run into hundreds of entries, and the player needs a way
  // to jump straight to "show me the level-65 stuff" — these two state
  // pairs back the controls below the section header.
  const [taskPage, setTaskPage] = useState(0);
  // 2026-06-24: task filters/sort persist per-character via settingsStore
  // (characterScope) so the player's choices survive reloads. Same names as the
  // old local state so the JSX below is unchanged.
  const taskLvlFilter = useSettingsStore((s) => s.taskFilterLvlFrom); // empty = all, otherwise show level >= input
  const setTaskLvlFilter = useSettingsStore((s) => s.setTaskFilterLvlFrom);
  // Cancel-task confirm modal target. Holds `{id, name}` while the dialog
  // is open, null when closed. The user explicitly asked for a confirm
  // popup before dropping a task — without it accidental clicks would
  // wipe progress.
  const [cancelTaskTarget, setCancelTaskTarget] = useState<{ id: string; name: string } | null>(null);
  // Task-history modal open flag. Replaces the inline history strip that
  // used to live at the bottom of the tasks list.
  const [taskHistoryOpen, setTaskHistoryOpen] = useState(false);
  // Toggle: when on, hides locked / slot-blocked monsters so only the
  // tasks the player can immediately START are shown. Off by default
  // because the full list is informative for planning.
  const taskAvailableOnly = useSettingsStore((s) => s.taskFilterAvailableOnly);
  const setTaskAvailableOnly = useSettingsStore((s) => s.setTaskFilterAvailableOnly);
  // Toggle: when on, hides any monster that already has an active task
  // on it. Useful for finding "fresh" monsters to start grinding without
  // scrolling past every entry the player is already busy on.
  const taskInactiveOnly = useSettingsStore((s) => s.taskFilterInactiveOnly);
  const setTaskInactiveOnly = useSettingsStore((s) => s.setTaskFilterInactiveOnly);
  // Toggle: when on, sort monsters from HIGHEST level to lowest
  // (default direction is ascending). Mirrors how players plan their
  // grind — start from the toughest unlocked monster and walk down.
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
  const { addGold, addItem, addConsumable, addStones } = useInventoryStore();
  const addXp = useCharacterStore((s) => s.addXp);
  // Task store — gives us active+completed tasks and the start/claim/cancel
  // actions previously living inside the standalone Tasks view.
  const {
    activeTasks,
    completedTasks,
    startTask,
    claimReward: claimTaskReward,
    cancelTask,
  } = useTaskStore();
  const masteries = useMasteryStore((s) => s.masteries);
  const masteryKills = useMasteryStore((s) => s.masteryKills);
  // Transform-tinted accent for the hub-tile chrome. Mirrors Battle.tsx
  // so the two hubs share the same border / glow / hover-wave tint.
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
  const { activeQuests: dailyActiveQuests, todayQuestDefs, refreshIfNeeded, claimReward } = useDailyQuestStore();

  // Stabilny prymityw dla backendowego efektu daily — dzięki temu, że deps to
  // string (id), a nie obiekt `character`, podmiana postaci przez
  // syncFromBackend (setCharacter) NIE zapętla efektu odświeżania daily.
  const backendCharId = character?.id ?? null;

  useEffect(() => {
    // Tryb backendu: klient NIE generuje daily — robi to autorytatywny backend
    // (osobny efekt niżej, kluczowany po id postaci). Domyślna ścieżka poniżej
    // pozostaje w 100% nietknięta.
    if (isBackendMode()) return;
    if (character) {
      refreshIfNeeded(character.level);
    }
  }, [character, refreshIfNeeded]);

  // Backend (opt-in): odśwież daily przy wejściu na widok / zmianie postaci.
  // Deps = [backendCharId] (string) — patrz komentarz przy deklaracji.
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
    // 2026-05-08 v2: resolution chain ->
    //   1. unified consumable resolver (covers HP/MP potions AND buff
    //      elixirs in a single lookup)
    //   2. whatever PNG/emoji the elixir record declares
    //   3. universal "any elixir" placeholder = stat-reset PNG (per
    //      user spec: "jezeli nie ma konkretnego eliksiru to
    //      domyslnie dawaj eliksir resetu statystyk")
    //   4. final emoji fallback only if literally no art is shipped
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
          // Handled after loop – ensures every gift-flagged quest gets a random item
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

    // Gift item: every quest claim grants a bonus random item for the player's
    // class. Rarity is rolled from rare/epic/legendary/mythic (never heroic).
    // This fulfills the ":wrapped-gift: prezent" chip shown on the quest card.
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

  // -- Bulk handlers ---------------------------------------------------------

  const claimableQuests = activeQuests.filter((aq) =>
    aq.goals.every((g) => (g.progress ?? 0) >= g.count),
  );

  const handleClaimAll = async () => {
    if (!character || claimableQuests.length === 0) return;

    if (isBackendMode()) {
      // Brak endpointu bulk — claimujemy sekwencyjnie przez pojedynczy
      // /quests/{id}/claim, a stan hydratujemy raz na końcu (backend = autorytet).
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

      // Replicate the same reward logic as handleClaimQuest
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
      // Sekwencyjny claim daily przez /daily-quests/{id}/claim, sync raz na końcu.
      const entries: IClaimSummaryEntry[] = [];
      try {
        for (const aq of claimable) {
          const res = await backendApi.claimDailyQuest(character.id, aq.questId);
          entries.push(...buildBackendClaimEntries(res));
        }
      } catch (e) {
        console.warn('[quests] backend claimDailyQuest (bulk) failed', e);
      }
      try {
        await syncFromBackend(character.id);
      } catch (e) {
        console.warn('[quests] backend sync (claim-all-daily) failed', e);
      }
      if (entries.length > 0) {
        setClaimSummary({ questName: `${claimable.length} questow dziennych`, entries });
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
    return true; // 'all'
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
          /* `--center` caps the button width and pins it to the centre
             of the bulk-actions row so on wide screens the green CTA
             reads as a focused pill rather than a viewport-spanning bar. */
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
              {/* Level chip — same component as regular quests so the
                  two card flavours share visual chrome. Lives on the
                  outer wrapper, NOT inside the pergamin (which clips
                  via overflow: hidden), so the chip can sit at top:-26px
                  above the parchment without being cut off. */}
              <span className="quests__card-level">Lvl {def.minLevel}</span>

              {/* Pergamin scroll — title centred at the top, content
                  below, and the claim button pinned at the very bottom
                  INSIDE the parchment per the 2026-05 spec. */}
              <div className="quests__card-pergamin">
                <div className="quests__daily-quest-header">
                  {/* "Gotowe!" badge removed per spec — the purple
                      glow on the pergamin border + the purple claim
                      button in the action row already signal the
                      "ready to claim" state without a corner badge. */}
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

                {/* Centred "Nagrody:" label above the chip row — same
                    visual treatment as the regular quest cards' label
                    so the two card flavours read as siblings. */}
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

                {/* Action row INSIDE the pergamin — same slot as regular
                    quests so the two card flavours share the same bottom
                    chrome. Renders one of:
                      - purple ":wrapped-gift: Odbierz nagrodę" claim button (ready),
                      - transform-coloured ":check-mark-button: Odebrane" label (claimed). */}
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
              </div>{/* /quests__card-pergamin */}
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

  // -- 3-tile hub picker ------------------------------------------------
  // 1:1 visual copy of the Battle hub: full-width banner tiles with the
  // background PNG, dark legibility veil, transform-accent border + glow,
  // and the hover wave/scale animation. Top-to-bottom order per spec:
  // Taski -> Questy -> Dzienne misje. The wrapper carries `--tile-accent` /
  // `--tile-accent-rgb` so every nested rule that references those vars
  // (border, glow, ::before wave) inherits the live transform colour.
  const renderHomeTab = () => {
    // Per-tile "claimable" flag — drives the pulsing purple border on
    // any hub tile that has rewards waiting. The flags read from the
    // same sources the inner sub-views already use, so the hub stays
    // in sync with what the player sees inside each section.
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

  // -- Tasks helpers (moved from the standalone Tasks view) -------------
  const characterLevel = character?.level ?? 1;
  const getTaskUnlock = (monsterId: string) => {
    const monster = monstersMiniList.find((m) => m.id === monsterId);
    if (!monster) return { unlocked: true as const };
    return getMonsterUnlockStatus(monster, monstersMiniList, characterLevel, masteries);
  };
  const handleStartTask = (task: ITask) => {
    // Only one active task per monster id — pick up the same monster a
    // second time would just collide with the existing progress.
    if (activeTasks.some((t) => t.monsterId === task.monsterId)) return;
    const unlock = getTaskUnlock(task.monsterId);
    if (!unlock.unlocked) return;
    startTask(task);
  };
  const monsterHasActiveTask = (monsterId: string) =>
    activeTasks.some((t) => t.monsterId === monsterId);

  // Mastery bar shown above each monster group when the player has any
  // kills on that monster. At MAX (25/25) the strip swaps into a
  // purple-styled ":crown: Mastery 25/25" pill — no progress bar, since
  // there's nothing left to grind. The card border also turns purple
  // (handled by the existing `--max + ` selector in Tasks.scss + an
  // override in Quests.scss to widen the visual to the WHOLE card).
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
    // Filter pipeline:
    //   1. Optional level floor — keeps tasks whose monster level is
    //      >= the typed number (was an exact-match before; the new spec
    //      reads as "show me everything from level X up").
    //   2. Optional "available only" — drops monsters that are still
    //      level-locked OR already taken by another active task OR
    //      blocked by the slot cap. Same checks as the start-button
    //      disable logic, just hoisted here so the list shrinks too.
    // Then sort (asc by default, desc when the toggle is on) +
    // group + paginate.
    const lvlFilter = taskLvlFilter.trim();
    const lvlNum = lvlFilter ? parseInt(lvlFilter, 10) : NaN;
    const filtered = [...allTasks]
      .filter((t) => (Number.isFinite(lvlNum) ? t.monsterLevel >= lvlNum : true))
      .filter((t) => {
        if (!taskAvailableOnly) return true;
        const unlock = getTaskUnlock(t.monsterId);
        if (!unlock.unlocked) return false;
        // No more global slot cap — only the per-monster lock matters.
        if (
          activeTasks.some((a) => a.monsterId === t.monsterId && a.id !== t.id)
        ) {
          return false;
        }
        return true;
      })
      .filter((t) => {
        // "Inactive only" — drop every monster the player already has
        // an active task on. Lets the player browse fresh targets
        // without scrolling past their current grind list.
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

    // Group by monster so the kill thresholds stack into one card.
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
        {/* Active tasks box — labeled wrapper with an internal scroll
            zone capped at 5 rows on phones / 8 on desktop (heights set
            in SCSS). Each row carries the transform-color border, a
            60-px monster thumbnail + name + level on the left, the
            progress bar centered, and the count + :multiply: / :wrapped-gift: button on
            the right. */}
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
                // Claimable tasks (progress >= killCount) float to the
                // top so the player can collect rewards without scrolling.
                // Secondary sort: by monster level ASCENDING within each
                // group — claimable tasks read low -> high level, then
                // in-progress tasks also read low -> high level. Each
                // monster's level is read from the live monsters table
                // (`monstersMiniList`) so even tasks whose stored
                // `monsterLevel` is stale (manual data fix later)
                // still sort against the canonical level. Falls back to
                // the task's own snapshot if the lookup misses.
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
                      {/* Bar + count live inside the same wrapper so they
                          sit side-by-side in the middle column instead
                          of being two separate grid cells. */}
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

        {/* Filter row: "available only" toggle + descending sort toggle
            + level-floor input. The level input now reads as "from level
            N up" (>= N), not exact match — matches how players think
            about progressing through monsters. */}
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
            {/* History trigger — icon-button next to the counter. The
                inline bottom history strip is gone; rows now live in
                a popup. The badge shows count when there's at least
                one entry. */}
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
            // No more global slot cap — only the per-monster lock keeps
            // a player from picking up two tasks on the same monster.
            const unlock = getTaskUnlock(monsterId);
            const isLocked = !unlock.unlocked;
            // Look up the live monster so we can render its level-keyed
            // PNG (or emoji fallback) before the name in the header.
            const monsterRecord = monstersMiniList.find((m) => m.id === monsterId);
            return (
              <div key={monsterId} className={`tasks__monster-group-wrap${isLocked ? ' tasks__monster-group-wrap--locked' : ''}`}>
                {renderMasteryBar(monsterId)}
                <div
                  className={`tasks__monster-group tasks__monster-group--with-corner-lvl${monsterTaken ? ' tasks__monster-group--taken' : ''}${isLocked ? ' tasks__monster-group--locked' : ''}`}
                  title={isLocked ? unlock.reason : undefined}
                  // Stamp the transform accent on the group root so the
                  // active-task border, "Aktywny" badge text, and Lvl
                  // badge can all read it via var(--task-accent).
                  style={{ '--task-accent': tileAccent } as React.CSSProperties}
                >
                  {/* Lvl chip in the absolute top-right corner of the
                      whole monster card (not inside the header row).
                      Per the 2026-05 spec: the player's eye reads
                      monster name + image first, the level lives in
                      the corner as a "stat tag" instead of being
                      vertically aligned with the name. */}
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
                        // fill: false so the className-based 100×100
                        // sizing wins. With fill: true (default)
                        // MonsterSprite stamps `width: 100% / height:
                        // 100%` inline, which overrides any class rule
                        // and made the thumb stretch to fill its row.
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

        {/* Bottom inline history removed — see the modal mounted at the
            view root, opened by the :books: button next to the meta counter. */}
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
      {/* Single-line filter strip: category chips + level-filter input
          + meta counter. The level input shares the height with the
          category chips so the row reads as one unified control bar. */}
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
        // Apply the optional level filter on top of the category filter.
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
              style={{
                '--card-pergamin': `url(${imgQuestPergamin})`,
                '--card-accent': tileAccent,
              } as React.CSSProperties}
            >
              {/* Level chip floats ABOVE the pergamin (top: -26px,
                  centred). Lives on the outer wrapper — not inside the
                  pergamin — because the pergamin uses `overflow: hidden`
                  to clip its torn edges and would clip the chip otherwise. */}
              <span className="quests__card-level">Lvl {quest.minLevel}</span>

              {/* Pergamin scroll — hosts the title, description, goals,
                  reward chips, and action buttons. Everything that should
                  read as "written on the parchment" lives in here. */}
              <div className="quests__card-pergamin">
                <div className="quests__card-header">
                  <div className="quests__card-title-row">
                    {completed && <span className="quests__check"><GameIcon name="check-mark-button" /></span>}
                    {tooHigh && <span className="quests__lock"><GameIcon name="locked" /></span>}
                    <h3 className="quests__card-name">{quest.name_pl}</h3>
                  </div>
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
                        {/* No check-mark icon — spec strips ALL icons from the
                            goals zone so the parchment reads as pure text. */}
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
                  let icon = 'wrapped-gift';
                  let text = '';
                  let titleText = '';
                  // 2026-05-08 v3: utility elixir rewards get the
                  // gold->purple gradient chip (matches Shop +
                  // Market + Inventory). HP/MP potion rewards keep
                  // the default chip chrome.
                  let chipClass = 'quests__reward-chip';
                  if (r.type === 'gold') {
                    icon = 'money-bag';
                    // Header-style compact format: "7,35 k" / "1,20 cc" / "1,00 sc".
                    // Keeps reward chips short on small screens and reads the
                    // same way as the gold counter in TopHeader.
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
                    // Spec: keep only the icon for the random-gift chip — the
                    // "losowy" label was redundant noise next to the present.
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

              {/* Action buttons live INSIDE the pergamin, pinned to the
                  bottom of the parchment. Spec ("guziki akcyjne maja byc
                  wewnatrz boxa ale na samym dole questu") means they read
                  as controls written ON the scroll, not floating chrome. */}
              <div className="quests__card-actions-row">
                {active && !canClaim && (
                  <button
                    className="quests__action-btn quests__action-btn--abandon"
                    onClick={() => setAbandonTarget({ id: quest.id, name: quest.name_pl })}
                  >
                    <Icon name="x" /> Porzuć
                  </button>
                )}
                {/* Spacer keeps the start/claim/status item right-aligned
                    when an abandon button is present. Without it the two
                    siblings would crowd to the left. */}
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
              </div>{/* /quests__card-pergamin */}
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
      {/* Header (back + "Questy" title) removed per the 2026-05 spec —
          navigation is now the 3-tile hub below + a section-internal
          back button. The old tabs are gone too; they're replaced by the
          tile picker the player lands on by default. */}

      {/* Section back button removed per the 2026-05 spec — bottom-nav
          Questy click re-enters the route which keeps state, but the
          player can navigate between sections via the bottom-nav and
          their browser-back. */}

      {mainTab === 'home' && renderHomeTab()}
      {mainTab === 'tasks' && renderTasksTab()}
      {mainTab === 'quests' && renderQuestsTab()}
      {mainTab === 'daily' && renderDailyTab()}

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

      {/* -- Abandon All confirmation modal ------------------------------ */}
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

      {/* -- Task-history modal ------------------------------------------- */}
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
                  // Always render an actual image — `getMonsterImageNearest`
                  // walks the registry to find the closest available tier
                  // (mid-level monsters like 79 reuse the level-80 art
                  // since not every level has its own PNG). This avoids
                  // the emoji-fallback "purple sparkle" the player saw
                  // on every history row.
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

      {/* -- Cancel-task confirmation modal ------------------------------- */}
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

      {/* -- Abandon confirmation modal ------------------------------------ */}
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
