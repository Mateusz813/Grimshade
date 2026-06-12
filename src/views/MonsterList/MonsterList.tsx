import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { IMonster } from '../../stores/combatStore';
import { useTaskStore } from '../../stores/taskStore';
import { useQuestStore, getActiveQuestKillProgress } from '../../stores/questStore';
import {
  useMasteryStore,
  MASTERY_MAX_LEVEL,
  MASTERY_KILL_THRESHOLD,
  HEROIC_DROP_RATE_AT_MAX,
} from '../../stores/masteryStore';
import { usePartyStore } from '../../stores/partyStore';
import {
  scaleHeroicDropRate,
  getPotionDropInfo,
  getSpellChestDropInfo,
  getEffectiveRarityChances,
  formatRarityChance,
} from '../../systems/lootSystem';
import { getMonsterAttackRange, MONSTER_STAT_MULTIPLIERS } from '../../systems/combat';
import { getMonsterUnlockStatus } from '../../systems/progression';
import { useCharacterStore } from '../../stores/characterStore';
import { STONE_ICONS } from '../../systems/itemSystem';
import { getPotionImage, getSpellChestImage } from '../../systems/spriteAssets';
import TinyIcon from '../../components/ui/TinyIcon/TinyIcon';
import GameIcon from '../../components/atoms/Twemoji/GameIcon';
import Icon from '../../components/atoms/Icon/Icon';
import EmojiText from '../../components/atoms/Twemoji/EmojiText';
import monstersRaw from '../../data/monsters.json';
import { MonsterSprite } from '../../components/ui/Sprite/MonsterSprite';
import { formatGoldShort } from '../../systems/goldFormat';
// 2026-05-19 v22 spec ("Odtworz widok praktycznie 1:1 jak lista
// potworow w polowaniu /combat"): pull in the same SCSS used by the
// hunt hub so the `combat__mcard-*` / `combat__filter-*` classes
// resolve here too. Combat.scss top-level rules are scoped under
// `.combat`, so wrapping the root in that class below is what
// activates the styling — the file itself is side-effect-only and
// has no global selectors.
import '../Combat/Combat.scss';
import './MonsterList.scss';

const monsters = (monstersRaw as unknown as IMonster[]).slice().sort((a, b) => a.level - b.level);

const RARITY_THRESHOLDS = [0.55, 0.25, 0.12, 0.05, 0.025, 0.005];
const RARITY_TIER_NAMES: { key: string; label: string; color: string }[] = [
  { key: 'common', label: 'Common', color: '#ffffff' },
  { key: 'rare', label: 'Rare', color: '#2196f3' },
  { key: 'epic', label: 'Epic', color: '#4caf50' },
  { key: 'legendary', label: 'Legendary', color: '#f44336' },
  { key: 'mythic', label: 'Mythic', color: '#ffc107' },
  { key: 'heroic', label: 'Heroic', color: '#9c27b0' },
];

const MONSTER_MAX_RARITY_INDEX: Record<string, number> = {
  normal: 0, strong: 1, epic: 2, legendary: 3, boss: 4,
};

const ROLL_COUNTS: Record<string, number> = { normal: 2, strong: 3, epic: 4, legendary: 5, boss: 6 };
const DROP_CHANCES: Record<string, number> = { normal: 0.08, strong: 0.12, epic: 0.15, legendary: 0.20, boss: 0.30 };

const STONE_NAMES_MAP: Record<string, string> = {
  normal: 'Common Stone', strong: 'Rare Stone', epic: 'Epic Stone',
  legendary: 'Legendary Stone', boss: 'Mythic Stone',
};
const VARIANT_TO_STONE_ID: Record<string, string> = {
  normal: 'common_stone', strong: 'rare_stone', epic: 'epic_stone',
  legendary: 'legendary_stone', boss: 'mythic_stone',
};
const STONE_CHANCES_MAP: Record<string, number> = {
  normal: 0.10, strong: 0.07, epic: 0.04, legendary: 0.02, boss: 0.01,
};

const COMBAT_VARIANTS = [
  { key: 'normal',    label: 'Normal',    color: '#9e9e9e', hpMult: MONSTER_STAT_MULTIPLIERS.normal.hp,    atkMult: MONSTER_STAT_MULTIPLIERS.normal.atk,    defMult: MONSTER_STAT_MULTIPLIERS.normal.def,    xpMult: MONSTER_STAT_MULTIPLIERS.normal.xp,    goldMult: MONSTER_STAT_MULTIPLIERS.normal.gold,    taskKills: 1   },
  { key: 'strong',    label: 'Strong',    color: '#2196f3', hpMult: MONSTER_STAT_MULTIPLIERS.strong.hp,    atkMult: MONSTER_STAT_MULTIPLIERS.strong.atk,    defMult: MONSTER_STAT_MULTIPLIERS.strong.def,    xpMult: MONSTER_STAT_MULTIPLIERS.strong.xp,    goldMult: MONSTER_STAT_MULTIPLIERS.strong.gold,    taskKills: 3   },
  { key: 'epic',      label: 'Epic',      color: '#4caf50', hpMult: MONSTER_STAT_MULTIPLIERS.epic.hp,      atkMult: MONSTER_STAT_MULTIPLIERS.epic.atk,      defMult: MONSTER_STAT_MULTIPLIERS.epic.def,      xpMult: MONSTER_STAT_MULTIPLIERS.epic.xp,      goldMult: MONSTER_STAT_MULTIPLIERS.epic.gold,      taskKills: 10  },
  { key: 'legendary', label: 'Legendary', color: '#f44336', hpMult: MONSTER_STAT_MULTIPLIERS.legendary.hp, atkMult: MONSTER_STAT_MULTIPLIERS.legendary.atk, defMult: MONSTER_STAT_MULTIPLIERS.legendary.def, xpMult: MONSTER_STAT_MULTIPLIERS.legendary.xp, goldMult: MONSTER_STAT_MULTIPLIERS.legendary.gold, taskKills: 50  },
  { key: 'boss',      label: 'Boss',      color: '#ffc107', hpMult: MONSTER_STAT_MULTIPLIERS.boss.hp,      atkMult: MONSTER_STAT_MULTIPLIERS.boss.atk,      defMult: MONSTER_STAT_MULTIPLIERS.boss.def,      xpMult: MONSTER_STAT_MULTIPLIERS.boss.xp,      goldMult: MONSTER_STAT_MULTIPLIERS.boss.gold,      taskKills: 200 },
];

interface ICombatDropTier { key: string; label: string; color: string; chancePerRoll: number; }

const getCombatDropBreakdown = (variant: string): { rollCount: number; dropChance: number; tiers: ICombatDropTier[] } => {
  const maxIdx = MONSTER_MAX_RARITY_INDEX[variant] ?? 0;
  const dropChance = DROP_CHANCES[variant] ?? 0.08;
  const rollCount = ROLL_COUNTS[variant] ?? 2;
  const applicable = RARITY_THRESHOLDS.slice(0, maxIdx + 1);
  const totalWeight = applicable.reduce((a, b) => a + b, 0);
  const tiers: ICombatDropTier[] = applicable.map((t, i) => ({
    key: RARITY_TIER_NAMES[i].key,
    label: RARITY_TIER_NAMES[i].label,
    color: RARITY_TIER_NAMES[i].color,
    chancePerRoll: (t / totalWeight) * dropChance * 100,
  }));
  return { rollCount, dropChance: dropChance * 100, tiers };
};

const MonsterList = () => {
  const navigate = useNavigate();
  const activeTasks = useTaskStore((s) => s.activeTasks);
  const activeQuests = useQuestStore((s) => s.activeQuests);
  const masteries = useMasteryStore((s) => s.masteries);
  const masteryKills = useMasteryStore((s) => s.masteryKills);
  const getMasteryBonuses = useMasteryStore((s) => s.getMasteryBonuses);
  const character = useCharacterStore((s) => s.character);
  const characterLevel = character?.level ?? 1;

  // 2026-05-19 v23 spec ("Jak nie jestem liderem party to powinien
  // guzik walki byc zablokowany"): party-member view is read-only —
  // only the leader can pick a monster + start the fight. The flag
  // is true when the player belongs to a party AND isn't its
  // leader; solo / leader / no-party players see the buttons
  // enabled.
  const party = usePartyStore((s) => s.party);
  const isNonLeaderMember = !!party && party.leaderId !== character?.id;

  // 2026-05-19 v23 spec ("filtry sa wspoldzielone z polowaniem a nie
  // powinny byc to powinny byc 2 osobne filtry niezalezne od
  // siebie"): the MonsterList filter bar now uses LOCAL component
  // state instead of the shared `settingsStore.huntFilter*` slice.
  // Toggling a filter here no longer leaks into the /combat hub.
  // State resets on unmount — that's fine, the bestiary is a quick
  // glance + go.
  const [filterAvailableOnly, setFilterAvailableOnly] = useState(false);
  const [filterTaskedOnly,    setFilterTaskedOnly]    = useState(false);
  const [filterMinLevel,      setFilterMinLevel]      = useState(0);
  const [filterSortDesc,      setFilterSortDesc]      = useState(false);

  const [dropModalMonsterId, setDropModalMonsterId] = useState<string | null>(null);
  // 2026-05-19 v24 spec ("dodaj ze jak sie kliknie w ikonke potwora
  // to sie powieksza na caly ekran"): full-screen image preview
  // triggered by clicking the sprite cell on any card. Backdrop
  // click + ESC dismiss.
  const [fullScreenMonsterId, setFullScreenMonsterId] = useState<string | null>(null);

  useEffect(() => {
    if (!fullScreenMonsterId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFullScreenMonsterId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullScreenMonsterId]);

  // 2026-05-19 v23 spec ("Guzik walki nie powinien przenosic do
  // walki tylko do podstrony z polowaniem i widoku /combat"): the
  // :crossed-swords: button just navigates to the /combat hub now — the player
  // re-picks the monster there and the leader-only ready-check
  // fires from that screen, matching the hunt flow exactly.
  const handleFight = (m: IMonster) => {
    if (isNonLeaderMember) return;
    const unlock = getMonsterUnlockStatus(m, monsters, characterLevel, masteries);
    if (!unlock.unlocked) return;
    navigate('/combat');
  };

  const monsterById = useMemo(() => {
    const map = new Map<string, IMonster>();
    for (const m of monsters) map.set(m.id, m);
    return map;
  }, []);

  const filteredMonsters = useMemo(() => {
    return monsters.filter((m) => {
      if (filterMinLevel > 0 && m.level < filterMinLevel) return false;
      if (filterAvailableOnly) {
        const u = getMonsterUnlockStatus(m, monsters, characterLevel, masteries);
        if (!u.unlocked) return false;
      }
      if (filterTaskedOnly) {
        const hasT = activeTasks.some((t) => t.monsterId === m.id);
        const hasQ = getActiveQuestKillProgress(activeQuests, m.id).length > 0;
        if (!hasT && !hasQ) return false;
      }
      return true;
    });
  }, [activeTasks, activeQuests, characterLevel, masteries, filterAvailableOnly, filterTaskedOnly, filterMinLevel]);

  const visibleMonsters = filterSortDesc
    ? [...filteredMonsters].reverse()
    : filteredMonsters;

  const anyFilterActive =
    filterAvailableOnly || filterTaskedOnly || filterMinLevel > 0 || filterSortDesc;

  // 2026-05-19 v22 spec ("Skasuj boxa z napisem miasto"): no back
  // header — navigation lives in the bottom-nav. Root is wrapped in
  // both `combat` (loads the hub / filter / mcard styles) and a
  // `monster-list` modifier so MonsterList-specific overrides can
  // still hook in via `MonsterList.scss`.
  return (
    <div className="combat monster-list">
      <div className="combat__hub">
        <section className="combat__hub-filters">
          <h2 className="combat__hub-section-title">Filtry</h2>
          <div className="combat__filter-bar">
            <label
              className={`combat__filter-toggle${filterAvailableOnly ? ' combat__filter-toggle--active' : ''}`}
              title="Pokaż tylko potwory, na które masz wymagany poziom i mastery"
            >
              <input
                type="checkbox"
                checked={filterAvailableOnly}
                onChange={(e) => setFilterAvailableOnly(e.target.checked)}
              />
              <span className="combat__filter-toggle-label">Tylko dostępne</span>
            </label>
            <label
              className={`combat__filter-toggle${filterTaskedOnly ? ' combat__filter-toggle--active' : ''}`}
              title="Pokaż tylko potwory powiązane z aktywnym taskiem lub questem"
            >
              <input
                type="checkbox"
                checked={filterTaskedOnly}
                onChange={(e) => setFilterTaskedOnly(e.target.checked)}
              />
              <span className="combat__filter-toggle-label">Tylko z taskiem / questem</span>
            </label>
            <label
              className={`combat__filter-toggle${filterSortDesc ? ' combat__filter-toggle--active' : ''}`}
              title="Sortuj listę od najwyższego poziomu"
            >
              <input
                type="checkbox"
                checked={filterSortDesc}
                onChange={(e) => setFilterSortDesc(e.target.checked)}
              />
              <span className="combat__filter-toggle-label">Od najwyższego poziomu</span>
            </label>
            <label className="combat__filter-input" title="Pokaż potwory na podanym poziomie i wyższe">
              <span className="combat__filter-input-label">Lvl od</span>
              <input
                type="number"
                min={0}
                max={1000}
                value={filterMinLevel || ''}
                placeholder="0"
                onChange={(e) => setFilterMinLevel(Number(e.target.value) || 0)}
              />
            </label>
            {anyFilterActive && (
              <button
                type="button"
                className="combat__filter-clear"
                onClick={() => {
                  setFilterAvailableOnly(false);
                  setFilterTaskedOnly(false);
                  setFilterMinLevel(0);
                  setFilterSortDesc(false);
                }}
                title="Wyczyść filtry"
              >
                <Icon name="x" /> Wyczyść
              </button>
            )}
          </div>
        </section>

        <section className="combat__hub-monsters">
          <h2 className="combat__hub-section-title">Przeciwnicy</h2>
          {visibleMonsters.length === 0 ? (
            <div className="combat__hub-empty">Żaden potwór nie pasuje do wybranych filtrów.</div>
          ) : (
            <div className="combat__mcard-grid">
              {visibleMonsters.map((m) => {
                const unlock = getMonsterUnlockStatus(m, monsters, characterLevel, masteries);
                const locked = !unlock.unlocked;
                const monsterTask = activeTasks.find((t) => t.monsterId === m.id);
                const hasTask = !!monsterTask;
                const questBadges = getActiveQuestKillProgress(activeQuests, m.id);
                const hasQuest = questBadges.length > 0;
                const masteryLvl = masteries[m.id]?.level ?? 0;
                const isMaxMasteryHere = masteryLvl >= MASTERY_MAX_LEVEL;
                const range = getMonsterAttackRange(m);
                const masteryPct = masteryLvl * 2;
                const xpBonus = Math.floor(m.xp * (masteryPct / 100));
                const goldBonusMin = Math.floor(m.gold[0] * (masteryPct / 100));
                const goldBonusMax = Math.floor(m.gold[1] * (masteryPct / 100));
                const masteryTooltip = masteryLvl > 0
                  ? `+${masteryPct}% XP & Gold za Mastery ${masteryLvl}/${MASTERY_MAX_LEVEL}`
                  : '';
                const cardClass = [
                  'combat__mcard',
                  locked && 'combat__mcard--locked',
                  !locked && (hasTask || hasQuest) && 'combat__mcard--task',
                  !locked && isMaxMasteryHere && 'combat__mcard--mastery-max',
                ].filter(Boolean).join(' ');
                return (
                  <article key={m.id} className={cardClass}>
                    <div className="combat__mcard-head">
                      {/* 2026-05-19 v24 spec: clicking the sprite
                          opens a fullscreen preview. Locked monsters
                          still show the lock glyph; the click only
                          enlarges revealed art. */}
                      <button
                        type="button"
                        className="combat__mcard-sprite monster-list__sprite-btn"
                        onClick={() => {
                          if (!locked) setFullScreenMonsterId(m.id);
                        }}
                        aria-label={locked ? `Zablokowany: ${m.name_pl}` : `Powiększ obraz: ${m.name_pl}`}
                        title={locked ? unlock.reason : 'Kliknij, aby powiększyć'}
                      >
                        {locked
                          ? <GameIcon name="locked" />
                          : <MonsterSprite level={m.level} sprite={m.sprite} name={m.name_pl} style={{ objectFit: 'contain' }} />}
                      </button>
                      <span className="combat__mcard-name">{m.name_pl}</span>
                      <div className="combat__mcard-chips">
                        <span className="combat__mcard-level" title={`Poziom potwora: ${m.level}`}>
                          Lvl {m.level}
                        </span>
                        <span
                          className={`combat__mcard-mastery${isMaxMasteryHere ? ' combat__mcard-mastery--max' : ''}`}
                          title={`Mastery ${masteryLvl}/${MASTERY_MAX_LEVEL}`}
                        >
                          <span className="combat__mcard-mastery-icon" aria-hidden="true"><GameIcon name="military-medal" /></span>
                          {masteryLvl}/{MASTERY_MAX_LEVEL}
                        </span>
                      </div>
                    </div>

                    <div className="combat__mcard-stats">
                      <span className="combat__mcard-stat" title="Atak (min - max)">
                        <span className="combat__mcard-stat-icon" aria-hidden="true"><GameIcon name="crossed-swords" /></span>
                        <span className="combat__mcard-stat-label">ATK</span>
                        <span className="combat__mcard-stat-value">{range.min}-{range.max}</span>
                      </span>
                      <span className="combat__mcard-stat" title="Punkty życia">
                        <span className="combat__mcard-stat-icon" aria-hidden="true"><GameIcon name="red-heart" /></span>
                        <span className="combat__mcard-stat-label">HP</span>
                        <span className="combat__mcard-stat-value">{m.hp.toLocaleString('pl-PL')}</span>
                      </span>
                      <span className="combat__mcard-stat" title="Obrona">
                        <span className="combat__mcard-stat-icon" aria-hidden="true"><GameIcon name="shield" /></span>
                        <span className="combat__mcard-stat-label">DEF</span>
                        <span className="combat__mcard-stat-value">{m.defense}</span>
                      </span>
                      <span className="combat__mcard-stat" title="Szybkość ataku (Attack Speed)">
                        <span className="combat__mcard-stat-icon" aria-hidden="true"><GameIcon name="person-running" /></span>
                        <span className="combat__mcard-stat-label">AS</span>
                        <span className="combat__mcard-stat-value">{m.speed}</span>
                      </span>
                      {m.magical && (
                        <span className="combat__mcard-stat combat__mcard-stat--magical" title="Atak magiczny — omija blok i unik">
                          <span className="combat__mcard-stat-icon" aria-hidden="true"><GameIcon name="sparkles" /></span>
                          <span className="combat__mcard-stat-label">MAG</span>
                          <span className="combat__mcard-stat-value">tak</span>
                        </span>
                      )}
                    </div>

                    <div className="combat__mcard-rewards">
                      <span className="combat__mcard-reward" title="XP za zabicie">
                        <span className="combat__mcard-reward-icon" aria-hidden="true"><GameIcon name="sparkles" /></span>
                        <span className="combat__mcard-reward-label">XP</span>
                        <span className="combat__mcard-reward-value">
                          {m.xp.toLocaleString('pl-PL')}
                          {masteryLvl > 0 && xpBonus > 0 && (
                            <span className="combat__mcard-reward-bonus" title={masteryTooltip}>
                              {' '}+{xpBonus.toLocaleString('pl-PL')}
                            </span>
                          )}
                        </span>
                      </span>
                      <span className="combat__mcard-reward" title="Gold za zabicie">
                        <span className="combat__mcard-reward-icon" aria-hidden="true"><GameIcon name="money-bag" /></span>
                        <span className="combat__mcard-reward-label">Gold</span>
                        <span className="combat__mcard-reward-value">
                          {formatGoldShort(m.gold[0])}–{formatGoldShort(m.gold[1])}
                          {masteryLvl > 0 && (goldBonusMin > 0 || goldBonusMax > 0) && (
                            <span className="combat__mcard-reward-bonus" title={masteryTooltip}>
                              {' '}+{formatGoldShort(goldBonusMin)}-{formatGoldShort(goldBonusMax)}
                            </span>
                          )}
                        </span>
                      </span>
                    </div>

                    {(hasTask || hasQuest) && (
                      <div className="combat__mcard-goals">
                        {hasTask && monsterTask && (
                          <div className="combat__mcard-goal combat__mcard-goal--task" title={`Task: zabij ${monsterTask.killCount}× ${m.name_pl}`}>
                            <span className="combat__mcard-goal-icon" aria-hidden="true"><GameIcon name="clipboard" /></span>
                            <span className="combat__mcard-goal-text">
                              Task {monsterTask.progress}/{monsterTask.killCount}
                            </span>
                          </div>
                        )}
                        {questBadges.map((qb) => (
                          <div
                            key={qb.questId}
                            className={`combat__mcard-goal combat__mcard-goal--quest${qb.done ? ' combat__mcard-goal--done' : ''}`}
                            title={`Quest: ${qb.questName}`}
                          >
                            <span className="combat__mcard-goal-icon" aria-hidden="true">
                              {qb.done ? <GameIcon name="check-mark-button" /> : <GameIcon name="scroll" />}
                            </span>
                            <span className="combat__mcard-goal-text">
                              {qb.questName} {qb.progress}/{qb.count}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {locked && unlock.lockKind === 'mastery' && unlock.requiredMonster && (() => {
                      const req = unlock.requiredMonster;
                      const killsNow = masteryKills[req.id] ?? 0;
                      return (
                        <div className="combat__mcard-locked-note" title={`Zdobądź Mastery 1/25 na ${req.name_pl}`}>
                          <GameIcon name="locked" /> {req.name_pl}: {killsNow.toLocaleString('pl-PL')}/{MASTERY_KILL_THRESHOLD.toLocaleString('pl-PL')}
                        </div>
                      );
                    })()}
                    {locked && unlock.lockKind !== 'mastery' && (
                      <div className="combat__mcard-locked-note"><EmojiText>{unlock.shortLabel}</EmojiText></div>
                    )}

                    <div className="combat__mcard-actions">
                      <button
                        className="combat__mcard-action combat__mcard-action--info"
                        onClick={() => setDropModalMonsterId(m.id)}
                        disabled={locked}
                        title="Pokaż szczegóły dropu"
                        aria-label={`Drop dla ${m.name_pl}`}
                      ><GameIcon name="package" /></button>
                      <button
                        className="combat__mcard-action combat__mcard-action--fight"
                        onClick={() => handleFight(m)}
                        disabled={locked || isNonLeaderMember}
                        title={
                          isNonLeaderMember
                            ? 'Tylko lider party może rozpocząć walkę'
                            : locked
                              ? unlock.reason
                              : 'Walcz!'
                        }
                        aria-label={`Walcz z ${m.name_pl}`}
                      ><GameIcon name="crossed-swords" /></button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {/* Drop info modal — same content as Combat's hub modal. */}
      {dropModalMonsterId && (() => {
        const m = monsterById.get(dropModalMonsterId);
        if (!m) return null;
        const mLvl = masteries[m.id]?.level ?? 0;
        const masteryPct = mLvl * 2;
        const isMaxMasteryHere = mLvl >= MASTERY_MAX_LEVEL;
        const masteryTooltip = mLvl > 0
          ? `+${masteryPct}% XP & Gold za Mastery ${mLvl}/${MASTERY_MAX_LEVEL} (2% za 1 pkt masterii)`
          : '';
        const effChances = getEffectiveRarityChances(getMasteryBonuses(m.id));
        const potionInfo = getPotionDropInfo(m.level);
        const chestInfo = getSpellChestDropInfo(m.level, isMaxMasteryHere);
        const CHEST_TIER_LABELS: Record<string, string> = {
          normal: 'Normal', strong: 'Strong', epic: 'Epic',
          legendary: 'Legendary', boss: 'Boss', heroic: 'Heroic',
        };
        const CHEST_TIER_COLORS: Record<string, string> = {
          normal: '#9e9e9e', strong: '#2196f3', epic: '#4caf50',
          legendary: '#f44336', boss: '#ffc107', heroic: '#ab47bc',
        };
        return (
          <div
            className="combat__drop-modal-backdrop"
            onClick={() => setDropModalMonsterId(null)}
            role="presentation"
          >
            <div
              className="combat__drop-modal"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-label={`Drop dla ${m.name_pl}`}
            >
              <header className="combat__drop-modal-head">
                <span className="combat__drop-modal-sprite" aria-hidden="true">
                  <MonsterSprite level={m.level} sprite={m.sprite} name={m.name_pl} />
                </span>
                <div className="combat__drop-modal-name-col">
                  <span className="combat__drop-modal-name">{m.name_pl}</span>
                  <span className="combat__drop-modal-level">Lvl {m.level}</span>
                </div>
                <button
                  className="combat__drop-modal-close"
                  onClick={() => setDropModalMonsterId(null)}
                  aria-label="Zamknij"
                  title="Zamknij"
                ><Icon name="x" /></button>
              </header>

              <div className="combat__drop-modal-body">
                <div className="combat__drop-modal-summary">
                  <span>
                    <GameIcon name="money-bag" /> Gold: {formatGoldShort(m.gold[0])}–{formatGoldShort(m.gold[1])}
                    {mLvl > 0 && (
                      <span className="combat__monster-xp-bonus" title={masteryTooltip}>
                        {' '}+{formatGoldShort(Math.floor(m.gold[0] * (masteryPct / 100)))}–{formatGoldShort(Math.floor(m.gold[1] * (masteryPct / 100)))}
                      </span>
                    )}
                  </span>
                  <span>
                    <GameIcon name="sparkles" /> XP: {m.xp.toLocaleString('pl-PL')}
                    {mLvl > 0 && (
                      <span className="combat__monster-xp-bonus" title={masteryTooltip}>
                        {' '}+{Math.floor(m.xp * (masteryPct / 100)).toLocaleString('pl-PL')}
                      </span>
                    )}
                  </span>
                </div>
                <div className="combat__drop-modal-info">
                  <GameIcon name="backpack" /> Losowy ekwipunek Lvl {m.level} (bronie, zbroje, akcesoria)
                </div>

                <div className="combat__drop-modal-variants">
                  {COMBAT_VARIANTS.map((v) => {
                    const bd = getCombatDropBreakdown(v.key);
                    const stoneChance = STONE_CHANCES_MAP[v.key] ?? 0;
                    const stoneName = STONE_NAMES_MAP[v.key] ?? 'Stone';
                    const chanceLabel = formatRarityChance(effChances[v.key as keyof typeof effChances]);
                    const base = getMonsterAttackRange(m);
                    const vMin = Math.max(1, Math.floor(base.min * v.atkMult));
                    const vMax = Math.max(vMin, Math.floor(base.max * v.atkMult));
                    const mult = 1 + masteryPct / 100;
                    const baseXp = Math.floor(m.xp * v.xpMult);
                    const baseGoldMin = Math.floor(m.gold[0] * v.goldMult);
                    const baseGoldMax = Math.floor(m.gold[1] * v.goldMult);
                    const effXp = Math.floor(baseXp * mult);
                    const effGoldMin = Math.floor(baseGoldMin * mult);
                    const effGoldMax = Math.floor(baseGoldMax * mult);
                    return (
                      <div
                        key={v.key}
                        className={`combat__variant${v.key !== 'normal' ? ` combat__variant--${v.key}` : ''}`}
                      >
                        <span className="combat__variant-name" style={{ color: v.color }}>{v.label}</span>
                        <span className="combat__variant-chance">{chanceLabel}</span>
                        <span className="combat__variant-stats">
                          HP: {Math.floor(m.hp * v.hpMult).toLocaleString('pl-PL')} · ATK: {vMin}-{vMax} · DEF: {Math.floor(m.defense * v.defMult)}
                        </span>
                        <span className="combat__variant-xp">
                          <span className="combat__variant-xp-row">
                            <GameIcon name="star" /> {effXp.toLocaleString('pl-PL')} XP
                            {mLvl > 0 && (
                              <span className="combat__monster-xp-bonus" title={masteryTooltip}>
                                {' '}+{masteryPct}%
                              </span>
                            )}
                          </span>
                          <span className="combat__variant-xp-row"><GameIcon name="money-bag" /> {formatGoldShort(effGoldMin)}–{formatGoldShort(effGoldMax)}</span>
                          <span className="combat__variant-xp-row"><GameIcon name="clipboard" /> Task: ×{v.taskKills}</span>
                        </span>
                        <div className="combat__variant-drops">
                          {bd.tiers.map((tier) => (
                            <div key={tier.key} className="combat__variant-tier">
                              <span
                                className="combat__tier-dot"
                                style={{ background: tier.color, boxShadow: `0 0 4px ${tier.color}` }}
                              />
                              <span className="combat__tier-name" style={{ color: tier.color }}>
                                {tier.label}
                              </span>
                              <span className="combat__tier-chance">
                                {tier.chancePerRoll.toFixed(2)}%
                              </span>
                            </div>
                          ))}
                          <div className="combat__variant-stone">
                            <TinyIcon icon={STONE_ICONS[VARIANT_TO_STONE_ID[v.key] ?? ''] ?? 'gem-stone'} size="sm" /> {stoneName} ({(stoneChance * 100).toFixed(0)}%)
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Potion drops */}
                <div className="combat__drops-potions">
                  <div className="combat__drops-potions-title"><TinyIcon icon={getPotionImage(null) ?? 'test-tube'} size="sm" /> Potiony</div>
                  <div className="combat__variant-tier">
                    <span className="combat__tier-dot" style={{ background: '#e57373' }} />
                    <span className="combat__tier-name" style={{ color: '#e57373' }}>
                      <TinyIcon icon={getPotionImage('hp_potion_sm') ?? 'red-heart'} size="sm" /> {potionInfo.hpLabel} ({potionInfo.hpHeal})
                    </span>
                    <span className="combat__tier-chance">{(potionInfo.hpChance * 100).toFixed(2)}%</span>
                  </div>
                  <div className="combat__variant-tier">
                    <span className="combat__tier-dot" style={{ background: '#64b5f6' }} />
                    <span className="combat__tier-name" style={{ color: '#64b5f6' }}>
                      <TinyIcon icon={getPotionImage('mp_potion_sm') ?? 'droplet'} size="sm" /> {potionInfo.mpLabel} ({potionInfo.mpHeal})
                    </span>
                    <span className="combat__tier-chance">{(potionInfo.mpChance * 100).toFixed(2)}%</span>
                  </div>
                  {potionInfo.mega && (
                    <>
                      <div className="combat__variant-tier">
                        <span className="combat__tier-dot" style={{ background: '#ff7043' }} />
                        <span className="combat__tier-name" style={{ color: '#ff7043' }}>
                          <TinyIcon icon={getPotionImage('hp_potion_mega') ?? 'heart-on-fire'} size="sm" /> {potionInfo.mega.hpLabel} ({potionInfo.mega.hpHeal})
                        </span>
                        <span className="combat__tier-chance">{(potionInfo.mega.chance * 100).toFixed(2)}%</span>
                      </div>
                      <div className="combat__variant-tier">
                        <span className="combat__tier-dot" style={{ background: '#7e57c2' }} />
                        <span className="combat__tier-name" style={{ color: '#7e57c2' }}>
                          <TinyIcon icon={getPotionImage('mp_potion_mega') ?? 'gem-stone'} size="sm" /> {potionInfo.mega.mpLabel} ({potionInfo.mega.mpHeal})
                        </span>
                        <span className="combat__tier-chance">{(potionInfo.mega.chance * 100).toFixed(2)}%</span>
                      </div>
                    </>
                  )}
                </div>

                {/* Spell chest drops */}
                {chestInfo.levels.length > 0 && (
                  <div className="combat__drops-potions">
                    <div className="combat__drops-potions-title">
                      <TinyIcon icon={getSpellChestImage(1000) ?? 'package'} size="sm" />
                      {' '}Spell Chest (Lvl {chestInfo.levels[0]}{chestInfo.levels.length > 1 ? `–${chestInfo.levels[chestInfo.levels.length - 1]}` : ''})
                    </div>
                    {chestInfo.rates.map((r) => (
                      <div key={r.tier} className="combat__variant-tier">
                        <span className="combat__tier-dot" style={{ background: CHEST_TIER_COLORS[r.tier] ?? '#9e9e9e' }} />
                        <span className="combat__tier-name" style={{ color: CHEST_TIER_COLORS[r.tier] ?? '#9e9e9e' }}>
                          {CHEST_TIER_LABELS[r.tier] ?? r.tier}
                        </span>
                        <span className="combat__tier-chance">{(r.chance * 100).toFixed(2)}%</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Mastery progress block */}
                {(() => {
                  const mKillsNow = masteryKills[m.id] ?? 0;
                  const mRequired = isMaxMasteryHere ? 0 : MASTERY_KILL_THRESHOLD * (mLvl + 1);
                  const mPct = isMaxMasteryHere ? 100 : (mRequired > 0 ? Math.min(100, Math.floor((mKillsNow / mRequired) * 100)) : 0);
                  return (
                    <div className={`monster-list__mastery${isMaxMasteryHere ? ' monster-list__mastery--max' : ''}`}>
                      <div className="monster-list__mastery-header">
                        <span>{isMaxMasteryHere ? <GameIcon name="crown" /> : <GameIcon name="sports-medal" />} Mastery</span>
                        <span className="monster-list__mastery-level">
                          {mLvl}/{MASTERY_MAX_LEVEL}{isMaxMasteryHere && ' MAX'}
                        </span>
                      </div>
                      {!isMaxMasteryHere && (
                        <div className="monster-list__mastery-bar-wrap">
                          <div className="monster-list__mastery-bar">
                            <div className="monster-list__mastery-bar-fill" style={{ width: `${mPct}%` }} />
                          </div>
                          <span className="monster-list__mastery-kills">
                            {mKillsNow.toLocaleString('pl-PL')}/{mRequired.toLocaleString('pl-PL')} kills
                          </span>
                        </div>
                      )}
                      {mLvl > 0 && (
                        <div className="monster-list__mastery-bonuses">
                          <span>+{mLvl}% Strong</span>
                          <span>+{(mLvl * 0.5).toFixed(1)}% Epic</span>
                          <span>+{(mLvl * 0.25).toFixed(2)}% Legendary</span>
                          <span>+{(mLvl * 0.1).toFixed(1)}% Boss</span>
                          {isMaxMasteryHere && (
                            <span style={{ color: '#9c27b0' }}>
                              +{(scaleHeroicDropRate(HEROIC_DROP_RATE_AT_MAX, m.level) * 100).toFixed(2)}% Heroic drop
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            </div>
          </div>
        );
      })()}

      {/* 2026-05-19 v24 spec ("dodaj ze jak sie kliknie w ikonke
          potwora to sie powieksza na caly ekran"): fullscreen sprite
          preview. Backdrop click anywhere dismisses; ESC handled by
          the effect above. The inner sprite uses object-fit:contain
          so the artwork keeps its aspect ratio at any viewport. */}
      {fullScreenMonsterId && (() => {
        const m = monsterById.get(fullScreenMonsterId);
        if (!m) return null;
        return (
          <div
            className="monster-list__fullscreen-backdrop"
            role="presentation"
            onClick={() => setFullScreenMonsterId(null)}
          >
            <div className="monster-list__fullscreen-inner">
              <MonsterSprite
                level={m.level}
                sprite={m.sprite}
                name={m.name_pl}
                style={{ width: '100%', height: '100%', objectFit: 'contain' }}
              />
            </div>
            <div className="monster-list__fullscreen-caption">
              {m.name_pl} · Lvl {m.level}
            </div>
            <button
              type="button"
              className="monster-list__fullscreen-close"
              onClick={(e) => {
                e.stopPropagation();
                setFullScreenMonsterId(null);
              }}
              aria-label="Zamknij podgląd"
              title="Zamknij (ESC)"
            >
              <Icon name="x" />
            </button>
          </div>
        );
      })()}
    </div>
  );
};

export default MonsterList;
