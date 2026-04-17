import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import { useCharacterStore } from '../../stores/characterStore';
import { useInventoryStore } from '../../stores/inventoryStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useSyncStore } from '../../stores/syncStore';
import { useTaskStore } from '../../stores/taskStore';
import { useQuestStore } from '../../stores/questStore';
import { useDailyQuestStore } from '../../stores/dailyQuestStore';
import { useSkillStore } from '../../stores/skillStore';
import { useSync } from '../../hooks/useSync';
import { useOfflineTrainingResume } from '../../hooks/useOfflineTrainingResume';
import { xpProgress, xpToNextLevel } from '../../systems/levelSystem';
import { getTotalEquipmentStats, flattenItemsData } from '../../systems/itemSystem';
import { getTrainingBonuses } from '../../systems/skillSystem';
import { getElixirHpBonus, getElixirMpBonus } from '../../systems/combatElixirs';
import { getEffectiveChar as engineGetEffectiveChar } from '../../systems/combatEngine';
import itemsRaw from '../../data/items.json';

const ALL_ITEMS = flattenItemsData(itemsRaw as Parameters<typeof flattenItemsData>[0]);
import { formatLastSynced } from '../../systems/syncSystem';
import OfflineRewardModal from '../../components/ui/OfflineRewardModal/OfflineRewardModal';
import { getCharacterAvatar } from '../../data/classAvatars';
import { useTransformStore } from '../../stores/transformStore';
import { useCombatStore } from '../../stores/combatStore';
import { useOfflineHuntStore } from '../../stores/offlineHuntStore';
import { usePartyStore } from '../../stores/partyStore';
import { MAX_PARTY_SIZE, canJoinParty, getAggroWeight, type IPartyMember } from '../../systems/partySystem';
import { MONSTER_RARITY_LABELS } from '../../systems/lootSystem';
import { stopCombat } from '../../systems/combatEngine';
import './Town.scss';

const RARITY_BORDER_COLORS: Record<string, string> = {
  normal: '#9e9e9e',
  strong: '#2196f3',
  epic: '#4caf50',
  legendary: '#f44336',
  boss: '#ffc107',
};

const CLASS_ICONS: Record<string, string> = {
  Knight: '⚔️', Mage: '🔮', Cleric: '✨', Archer: '🏹',
  Rogue: '🗡️', Necromancer: '💀', Bard: '🎵',
};

const CLASS_COLORS: Record<string, string> = {
  Knight: '#e53935', Mage: '#7b1fa2', Cleric: '#ffc107', Archer: '#4caf50',
  Rogue: '#424242', Necromancer: '#795548', Bard: '#ff9800',
};

const hexToRgb = (hex: string): string => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${r},${g},${b}`;
};

const Town = () => {
  const navigate   = useNavigate();
  const { t }      = useTranslation();
  const character  = useCharacterStore((s) => s.character);
  const completedTransforms = useTransformStore((s) => s.completedTransforms);
  const getHighestTransformColor = useTransformStore((s) => s.getHighestTransformColor);
  const transformColor = getHighestTransformColor();
  const playerAvatarSrc = character ? getCharacterAvatar(character.class, completedTransforms) : '';

  // Derive a single accent color (not a gradient) from the current transform tier.
  // Before the first transform is completed, we fall back to the character class
  // color so the avatar accent never looks out-of-place. Once a transform tier is
  // completed, we switch to the transform's solid color or first gradient stop.
  const classColorFallback = character ? (CLASS_COLORS[character.class] ?? '#e94560') : '#e94560';
  const tileAccent = (() => {
    if (!transformColor) return classColorFallback;
    if (transformColor.solid) return transformColor.solid;
    if (transformColor.gradient) return transformColor.gradient[0];
    return classColorFallback;
  })();
  const tileAccentRgb = (() => {
    const hex = tileAccent.replace('#', '');
    if (hex.length !== 6) return hexToRgb(classColorFallback);
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return `${r}, ${g}, ${b}`;
  })();
  const gold       = useInventoryStore((s) => s.gold);
  const { language, setLanguage } = useSettingsStore();
  const { isOnline, isSyncing, lastSynced } = useSyncStore();
  const { doSync } = useSync();
  const { reward: offlineReward, clearReward: clearOfflineReward } = useOfflineTrainingResume();
  const activeTasks = useTaskStore((s) => s.activeTasks);
  const activeQuests = useQuestStore((s) => s.activeQuests);
  const completedQuestIds = useQuestStore((s) => s.completedQuestIds);
  const dailyActiveQuests = useDailyQuestStore((s) => s.activeQuests);
  const equipment = useInventoryStore((s) => s.equipment);
  const skillLevels = useSkillStore((s) => s.skillLevels);

  // Combat state for live widget and blocking
  const combatPhase = useCombatStore((s) => s.phase);
  const combatMonster = useCombatStore((s) => s.monster);
  const combatMonsterRarity = useCombatStore((s) => s.monsterRarity);
  const combatSessionKills = useCombatStore((s) => s.sessionKills);
  const combatXpPerHour = useCombatStore((s) => s.sessionXpPerHour);
  const isCombatActive = combatPhase === 'fighting' || combatPhase === 'victory';
  // Only the live Combat tile is mutually-exclusive with offline hunt.
  // Dungeons, bosses, transforms and rest keep working while the hunt rolls
  // kills in the background.
  const offlineHuntActive = useOfflineHuntStore((s) => s.isActive);
  const offlineHuntMonster = useOfflineHuntStore((s) => s.targetMonster);
  // Dungeon / boss / transform / rest are only blocked during a live fight.
  const isBlocked = isCombatActive;
  const blockedReason = 'Zakończ walkę najpierw';

  // Party state for expand widget
  const party = usePartyStore((s) => s.party);
  const addBotHelper = usePartyStore((s) => s.addBotHelper);
  const removePartyMember = usePartyStore((s) => s.removeMember);
  const leaveParty = usePartyStore((s) => s.leaveParty);
  const disbandParty = usePartyStore((s) => s.disbandParty);
  const createParty = usePartyStore((s) => s.createParty);
  const [partyExpanded, setPartyExpanded] = useState(false);

  const handleCreateParty = useCallback(() => {
    if (!character || party) return;
    const self: IPartyMember = {
      id: character.id,
      name: character.name,
      class: character.class,
      level: character.level,
      hp: character.hp,
      maxHp: character.max_hp,
      isOnline: true,
    };
    // Quick public solo party so the composition bonus kicks in. For a
    // password-gated or renamed party the player uses the /party screen.
    void createParty(self, {
      name:        `${character.name}'s party`,
      description: '',
      password:    null,
      isPublic:    true,
    });
    setPartyExpanded(true);
  }, [character, party, createParty]);

  const isPartyLeader = !!party && !!character && party.leaderId === character.id;

  // Claimable rewards indicators
  const hasClaimableQuest = activeQuests.some((q) =>
    !completedQuestIds.includes(q.questId) && q.goals.every((g) => (g.progress ?? 0) >= g.count),
  );
  const hasClaimableDaily = dailyActiveQuests.some((q) => q.completed && !q.claimed);

  // Include equipment bonuses + training bonuses + transform bonuses + elixirs in
  // displayed max HP/MP so the numbers match the Combat view EXACTLY. We delegate
  // to the same helper the combat engine uses so there is a single source of
  // truth — Town, Combat and CharacterStats will always show identical max HP/MP.
  const eqStats = getTotalEquipmentStats(equipment, ALL_ITEMS);
  const tb = getTrainingBonuses(skillLevels, character?.class);
  const engineEff = character ? engineGetEffectiveChar(character) : null;
  const effMaxHp = engineEff
    ? engineEff.max_hp
    : (character ? character.max_hp + (eqStats.hp ?? 0) + (tb.max_hp ?? 0) + getElixirHpBonus() : 0);
  const effMaxMp = engineEff
    ? engineEff.max_mp
    : (character ? character.max_mp + (eqStats.mp ?? 0) + (tb.max_mp ?? 0) + getElixirMpBonus() : 0);

  // For the nav button indicator, show aggregate status: any task done = done, any task active = active
  const anyTaskDone = activeTasks.some((t) => t.progress >= t.killCount);
  const hasActiveTasks = activeTasks.length > 0;

  // ── Rest / Heal ─────────────────────────────────────────────────────────────
  const [isResting, setIsResting] = useState(false);
  const [restResult, setRestResult] = useState<{ hpHealed: number; mpHealed: number } | null>(null);

  const handleRest = useCallback(() => {
    if (!character || isResting) return;
    const hpToHeal = Math.max(0, effMaxHp - character.hp);
    const mpToHeal = Math.max(0, effMaxMp - character.mp);
    if (hpToHeal <= 0 && mpToHeal <= 0) return; // already full

    setIsResting(true);
    setRestResult(null);

    // Animate for 5s then apply the heal
    setTimeout(() => {
      const store = useCharacterStore.getState();
      const c = store.character;
      if (c) {
        const newHp = effMaxHp;
        const newMp = effMaxMp;
        store.updateCharacter({ hp: newHp, mp: newMp });
        setRestResult({ hpHealed: newHp - c.hp, mpHealed: newMp - c.mp });
      }
      setTimeout(() => {
        setIsResting(false);
        setRestResult(null);
      }, 2000);
    }, 10000);
  }, [character, effMaxHp, effMaxMp, isResting]);

  const canRest = character
    ? character.hp < effMaxHp || character.mp < effMaxMp
    : false;

  const handleLogout = async () => {
    await supabase.auth.signOut();
    useCharacterStore.getState().clearCharacter();
    navigate('/login');
  };

  const hpPct    = character && effMaxHp > 0 ? Math.min(1, character.hp / effMaxHp) : 0;
  const mpPct    = character && effMaxMp > 0 ? Math.min(1, character.mp / effMaxMp) : 0;
  const xpPct    = character ? xpProgress(character.xp, character.level) : 0;
  const xpNeeded = character ? xpToNextLevel(character.level) : 0;

  return (
    <div className="town">
      <OfflineRewardModal
        show={offlineReward !== null}
        skillName={offlineReward?.skillName ?? ''}
        earnedXp={offlineReward?.earnedXp ?? 0}
        timeElapsed={offlineReward?.timeElapsed ?? 0}
        onClose={clearOfflineReward}
      />
      <header className="town__header" style={character ? {
        '--class-color': tileAccent,
        '--class-color-rgb': tileAccentRgb,
      } as React.CSSProperties : undefined}>
        <div className="town__header-top">
          <h1 className="town__title">{t('town.title')}</h1>

          <div className="town__header-actions">
            {/* Language switcher */}
            <div className="town__lang-switch">
              <button
                className={`town__lang-btn${language === 'pl' ? ' town__lang-btn--active' : ''}`}
                onClick={() => setLanguage('pl')}
              >
                PL
              </button>
              <button
                className={`town__lang-btn${language === 'en' ? ' town__lang-btn--active' : ''}`}
                onClick={() => setLanguage('en')}
              >
                EN
              </button>
            </div>

            <button
              className="town__change-char"
              onClick={() => {
                useCharacterStore.getState().clearCharacter();
                navigate('/character-select');
              }}
              title="Zmień postać"
            >
              {character ? (
                <img
                  src={playerAvatarSrc}
                  alt={character.class}
                  className="town__change-char-img"
                />
              ) : '👤'}
            </button>

            <button className="town__logout" onClick={handleLogout}>
              {t('town.logout')}
            </button>
          </div>
        </div>

        {/* Sync status bar */}
        <div className="town__sync-bar">
          <span className={`town__sync-status${isOnline ? '' : ' town__sync-status--offline'}`}>
            {isOnline ? t('common.online') : t('common.offline')}
          </span>
          <span className="town__sync-time">
            {isSyncing
              ? t('common.syncing')
              : t('common.last_synced', { time: formatLastSynced(lastSynced) })}
          </span>
          <button
            className="town__sync-btn"
            onClick={() => void doSync()}
            disabled={!isOnline || isSyncing}
            title={t('common.sync_now')}
          >
            {isSyncing ? '⟳' : '↑'}
          </button>
        </div>

        {character && (() => {
          // Scale the trace intensity with how many transform tiers the player
          // has completed. Tier 1 is subtle (few faint pixels), each additional
          // tier widens the pixels, brightens them and tightens the gap so more
          // pixels are visible chasing each other around the border.
          const flameTier = Math.min(completedTransforms.length, 11);
          const ablazeBoost = 1 + (flameTier - 1) * 0.22; // 1.0, 1.22, 1.44, ... up to 3.20 @ T11
          return (
          <div
            className={`town__character-card${flameTier >= 1 ? ' town__character-card--ablaze' : ''}`}
            style={{
              '--class-color': tileAccent,
              '--class-color-rgb': tileAccentRgb,
              '--tile-accent': tileAccent,
              '--tile-accent-rgb': tileAccentRgb,
              '--ablaze-boost': String(ablazeBoost),
              '--ablaze-tier': String(flameTier),
            } as React.CSSProperties}
          >
            {flameTier >= 1 && (
              // SVG trace: a dashed rectangle whose stroke-dashoffset animates
              // infinitely, making the dashes appear to fly around the border.
              // Stroke-width scales with --ablaze-boost so higher tiers show
              // fatter pixels. Inset 1px so the stroke stays fully inside the
              // card (no clipping by overflow:hidden).
              <svg
                className="town__card-trace"
                aria-hidden="true"
                xmlns="http://www.w3.org/2000/svg"
              >
                <rect className="town__card-trace-rect" />
              </svg>
            )}

            <div className="town__char-row">
              <div className="town__char-avatar">
                <img src={playerAvatarSrc} alt={character.class} className="town__char-avatar-img" />
              </div>
              <span className="town__char-name">{character.name}</span>
              <span className="town__char-class" style={{
                color: CLASS_COLORS[character.class] ?? '#9e9e9e',
                borderColor: CLASS_COLORS[character.class] ?? '#2a2a4a',
              }}>{CLASS_ICONS[character.class] ?? '?'}</span>
              <span className="town__char-level">{t('common.level')} {character.level}</span>
              <span className="town__char-gold">💰 {gold.toLocaleString('pl-PL')}</span>
            </div>

            <div className="town__bar-wrap">
              <span className="town__bar-label">{t('town.stats.hp')}</span>
              <div className="town__bar town__bar--hp">
                <div className="town__bar-fill" style={{ width: `${hpPct * 100}%` }} />
              </div>
              <span className="town__bar-value">{character.hp}/{effMaxHp}</span>
            </div>

            <div className="town__bar-wrap">
              <span className="town__bar-label">{t('town.stats.mp')}</span>
              <div className="town__bar town__bar--mp">
                <div className="town__bar-fill" style={{ width: `${mpPct * 100}%` }} />
              </div>
              <span className="town__bar-value">{character.mp}/{effMaxMp}</span>
            </div>

            <div className="town__bar-wrap">
              <span className="town__bar-label">{t('town.stats.xp')}</span>
              <div className="town__bar town__bar--xp">
                <div className="town__bar-fill" style={{ width: `${xpPct * 100}%` }} />
                <span className="town__bar-pct">{(xpPct * 100).toFixed(1)}%</span>
              </div>
              <span className="town__bar-value">{character.xp}/{xpNeeded}</span>
            </div>

            {character.stat_points > 0 && (
              <button
                className="town__stat-points town__stat-points--clickable"
                onClick={() => navigate('/stats')}
                title="Rozdaj punkty statystyk"
              >
                +{character.stat_points} statystyk do rozdania
              </button>
            )}
          </div>
          );
        })()}
      </header>

      {/* ── Compact Combat Indicator ─────────────────────────────────────── */}
      {isCombatActive && combatMonster && (
        <div
          className={`town__combat-strip town__combat-strip--${combatMonsterRarity}`}
          style={{ '--rarity-color': RARITY_BORDER_COLORS[combatMonsterRarity] } as React.CSSProperties}
        >
          <div className="town__combat-strip-left" onClick={() => navigate('/combat')}>
            <span className="town__combat-strip-sprite">{combatMonster.sprite ?? '👾'}</span>
            <div className="town__combat-strip-info">
              <div className="town__combat-strip-name">
                {combatMonster.name_pl} Lvl {combatMonster.level}
                {combatMonsterRarity !== 'normal' && (
                  <span className="town__combat-strip-rarity" style={{ color: RARITY_BORDER_COLORS[combatMonsterRarity] }}>
                    {' '}{MONSTER_RARITY_LABELS[combatMonsterRarity]}
                  </span>
                )}
              </div>
              <div className="town__combat-strip-meta">
                {combatXpPerHour > 0 && <span>{combatXpPerHour.toLocaleString('pl-PL')} XP/h</span>}
                <span>Kille: {Object.values(combatSessionKills).reduce((a, b) => a + b, 0)}</span>
              </div>
            </div>
          </div>
          <div className="town__combat-strip-actions">
            <button className="town__combat-strip-btn town__combat-strip-btn--go" onClick={() => navigate('/combat')} title="Przejdź do walki">
              ⚔️
            </button>
            <button className="town__combat-strip-btn town__combat-strip-btn--stop" onClick={() => stopCombat()} title="Zakończ walkę">
              ✕
            </button>
          </div>
        </div>
      )}

      {/* ── Party Expand Widget ──────────────────────────────────────── */}
      {party ? (
        <div className={`town__party-strip${partyExpanded ? ' town__party-strip--expanded' : ''}`}>
          <div
            className="town__party-strip-header"
            onClick={() => setPartyExpanded((v) => !v)}
          >
            <span className="town__party-strip-icon">🤝</span>
            <div className="town__party-strip-title">
              <span className="town__party-strip-label">Party</span>
              <span className="town__party-strip-code">{party.id}</span>
            </div>
            <div className="town__party-strip-avatars">
              {party.members.slice(0, MAX_PARTY_SIZE).map((m) => {
                const hpPct = m.maxHp > 0 ? Math.min(1, m.hp / m.maxHp) : 0;
                return (
                  <div
                    key={m.id}
                    className={`town__party-avatar${m.isBot ? ' town__party-avatar--bot' : ''}${m.id === character?.id ? ' town__party-avatar--me' : ''}`}
                    title={`${m.name} · ${m.class} Lvl ${m.level} · ${m.hp}/${m.maxHp} HP`}
                  >
                    <span className="town__party-avatar-icon">
                      {m.isBot ? '🤖' : (CLASS_ICONS[m.class] ?? '?')}
                    </span>
                    <span className="town__party-avatar-hp">
                      <span
                        className="town__party-avatar-hp-fill"
                        style={{
                          width: `${hpPct * 100}%`,
                          background: hpPct > 0.5 ? '#4caf50' : hpPct > 0.25 ? '#ffc107' : '#f44336',
                        }}
                      />
                    </span>
                  </div>
                );
              })}
            </div>
            <span className="town__party-strip-count">
              {party.members.length}/{MAX_PARTY_SIZE}
            </span>
            <span className="town__party-strip-caret">
              {partyExpanded ? '▲' : '▼'}
            </span>
          </div>

          {partyExpanded && (
            <div className="town__party-strip-body">
              {party.members.map((m) => {
                const hpPct = m.maxHp > 0 ? Math.min(1, m.hp / m.maxHp) : 0;
                const weight = getAggroWeight(m.class);
                const isMe = m.id === character?.id;
                return (
                  <div key={m.id} className={`town__party-row${isMe ? ' town__party-row--me' : ''}${m.isBot ? ' town__party-row--bot' : ''}`}>
                    <span className="town__party-row-icon">
                      {m.isBot ? '🤖' : (CLASS_ICONS[m.class] ?? '?')}
                    </span>
                    <div className="town__party-row-info">
                      <div className="town__party-row-name">
                        {m.name}
                        {isMe && <span className="town__party-badge">Ty</span>}
                        {m.isBot && <span className="town__party-badge town__party-badge--bot">Bot</span>}
                      </div>
                      <div className="town__party-row-meta">
                        <span style={{ color: CLASS_COLORS[m.class] ?? '#9e9e9e' }}>
                          {m.class}
                        </span>
                        <span>Lvl {m.level}</span>
                        <span className="town__party-aggro" title="Waga aggro bossa">
                          🎯 {weight}
                        </span>
                      </div>
                      <div className="town__party-hp-bar">
                        <div
                          className="town__party-hp-fill"
                          style={{
                            width: `${hpPct * 100}%`,
                            background: hpPct > 0.5 ? '#4caf50' : hpPct > 0.25 ? '#ffc107' : '#f44336',
                          }}
                        />
                        <span className="town__party-hp-text">{m.hp}/{m.maxHp}</span>
                      </div>
                    </div>
                    {isPartyLeader && !isMe && (
                      <button
                        className="town__party-kick"
                        onClick={(e) => { e.stopPropagation(); removePartyMember(m.id); }}
                        title="Wyrzuć z party"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                );
              })}

              <div className="town__party-strip-actions">
                {canJoinParty(party.members.length) && (
                  <button
                    className="town__party-action-btn town__party-action-btn--add-bot"
                    onClick={(e) => { e.stopPropagation(); addBotHelper(); }}
                  >
                    + Bot
                  </button>
                )}
                <button
                  className="town__party-action-btn"
                  onClick={(e) => { e.stopPropagation(); navigate('/party'); }}
                >
                  🤝 Party
                </button>
                {isPartyLeader ? (
                  <button
                    className="town__party-action-btn town__party-action-btn--danger"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (character) void disbandParty(character.id);
                      setPartyExpanded(false);
                    }}
                  >
                    Rozwiąż
                  </button>
                ) : (
                  <button
                    className="town__party-action-btn town__party-action-btn--danger"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (character) void leaveParty(character.id);
                      setPartyExpanded(false);
                    }}
                  >
                    Opuść
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      ) : character && (
        <div className="town__party-strip town__party-strip--empty">
          <span className="town__party-strip-icon">🤝</span>
          <span className="town__party-strip-empty-text">Solo — brak party</span>
          <button className="town__party-strip-create" onClick={handleCreateParty}>
            + Stwórz party
          </button>
          <button
            className="town__party-strip-goto"
            onClick={() => navigate('/party')}
            title="Dołącz do party"
          >
            Dołącz →
          </button>
        </div>
      )}

      <nav
        className="town__nav"
        style={{
          '--tile-accent':     tileAccent,
          '--tile-accent-rgb': tileAccentRgb,
        } as React.CSSProperties}
      >
        <button
          className={`town__nav-btn town__nav-tile town__nav-tile--combat${offlineHuntActive ? ' town__nav-btn--blocked' : ''}`}
          onClick={() => !offlineHuntActive && navigate('/combat')}
          disabled={offlineHuntActive}
          title={offlineHuntActive ? blockedReason : undefined}
        >
          <span className="town__nav-icon">⚔️</span>
          <span className="town__nav-btn-label town__nav-btn-label--glass">{t('town.nav.combat')}</span>
          {offlineHuntActive && <span className="town__blocked-tag">🎯</span>}
        </button>
        <button className="town__nav-btn town__nav-tile town__nav-tile--inventory" onClick={() => navigate('/inventory')}>
          <span className="town__nav-icon">🎒</span>
          <span className="town__nav-btn-label town__nav-btn-label--glass">{t('town.nav.inventory')}</span>
        </button>
        <button
          className="town__nav-btn town__nav-btn--character town__nav-tile town__nav-tile--character"
          onClick={() => navigate('/stats')}
          style={character && playerAvatarSrc
            ? ({ '--player-avatar-url': `url('${playerAvatarSrc}')` } as React.CSSProperties)
            : undefined}
        >
          {character && playerAvatarSrc && (
            <span className="town__nav-avatar-bg" aria-hidden="true" />
          )}
          <span className="town__nav-icon town__nav-icon--avatar">
            {!character || !playerAvatarSrc ? '📊' : null}
          </span>
          <span className="town__nav-btn-label town__nav-btn-label--glass town__nav-btn-label--character">Postać</span>
        </button>
        <button className="town__nav-btn town__nav-tile town__nav-tile--skills" onClick={() => navigate('/skills')}>
          <span className="town__nav-icon">✨</span>
          <span className="town__nav-btn-label town__nav-btn-label--glass">{t('town.nav.skills')}</span>
        </button>
        <button className="town__nav-btn town__nav-tile town__nav-tile--shop" onClick={() => navigate('/shop')}>
          <span className="town__nav-icon">🛒</span>
          <span className="town__nav-btn-label town__nav-btn-label--glass">{t('town.nav.shop')}</span>
        </button>
        <button className="town__nav-btn town__nav-tile town__nav-tile--deposit" onClick={() => navigate('/deposit')}>
          <span className="town__nav-icon">🏦</span>
          <span className="town__nav-btn-label town__nav-btn-label--glass">Depozyt</span>
        </button>
        <button className={`town__nav-btn town__nav-tile town__nav-tile--tasks${hasActiveTasks ? (anyTaskDone ? ' town__nav-btn--task-done' : ' town__nav-btn--task-active') : ''}`} onClick={() => navigate('/tasks')}>
          <span className="town__nav-icon">📋</span>
          <span className="town__nav-btn-label town__nav-btn-label--glass">Taski {hasActiveTasks ? `(${activeTasks.length})` : ''}</span>
          {hasActiveTasks && (
            <div className="town__task-indicators">
              {activeTasks.map((task) => {
                const pct = Math.min(100, Math.floor((task.progress / task.killCount) * 100));
                const isDone = task.progress >= task.killCount;
                return (
                  <div key={task.monsterId} className={`town__task-indicator${isDone ? ' town__task-indicator--done' : ''}`}>
                    {isDone ? '✅' : <span className="town__task-indicator-text">{task.progress}/{task.killCount}</span>}
                    {!isDone && (
                      <span className="town__task-indicator-bar">
                        <span className="town__task-indicator-fill" style={{ width: `${pct}%` }} />
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </button>
        <button
          className={`town__nav-btn town__nav-tile town__nav-tile--quests${hasClaimableQuest || hasClaimableDaily ? ' town__nav-btn--claimable' : ''}`}
          onClick={() => navigate('/quests')}
        >
          <span className="town__nav-icon">📜</span>
          <span className="town__nav-btn-label town__nav-btn-label--glass">Questy</span>
          {(hasClaimableQuest || hasClaimableDaily) && (
            <span className="town__claim-badge">🎁</span>
          )}
        </button>
        <button
          className={`town__nav-btn town__nav-tile town__nav-tile--transform${isBlocked ? ' town__nav-btn--blocked' : ''}`}
          onClick={() => !isBlocked && navigate('/transform')}
          disabled={isBlocked}
          title={isBlocked ? blockedReason : undefined}
        >
          <span className="town__nav-icon">🔥</span>
          <span className="town__nav-btn-label town__nav-btn-label--glass">Transform</span>
          {isBlocked && <span className="town__blocked-tag">⚔️</span>}
        </button>
        <button
          className={`town__nav-btn town__nav-tile town__nav-tile--dungeon${isBlocked ? ' town__nav-btn--blocked' : ''}`}
          onClick={() => !isBlocked && navigate('/dungeon')}
          disabled={isBlocked}
          title={isBlocked ? blockedReason : undefined}
        >
          <span className="town__nav-icon">🏰</span>
          <span className="town__nav-btn-label town__nav-btn-label--glass">{t('town.nav.dungeon')}</span>
          {isBlocked && <span className="town__blocked-tag">⚔️</span>}
        </button>
        <button
          className={`town__nav-btn town__nav-tile town__nav-tile--boss${isBlocked ? ' town__nav-btn--blocked' : ''}`}
          onClick={() => !isBlocked && navigate('/boss')}
          disabled={isBlocked}
          title={isBlocked ? blockedReason : undefined}
        >
          <span className="town__nav-icon">👹</span>
          <span className="town__nav-btn-label town__nav-btn-label--glass">{t('town.nav.boss')}</span>
          {isBlocked && <span className="town__blocked-tag">⚔️</span>}
        </button>
        <button className="town__nav-btn town__nav-tile town__nav-tile--monsters" onClick={() => navigate('/monsters')}>
          <span className="town__nav-icon">🗺️</span>
          <span className="town__nav-btn-label town__nav-btn-label--glass">Potwory</span>
        </button>
        <button
          className={`town__nav-btn town__nav-tile town__nav-tile--offline${offlineHuntActive ? ' town__nav-btn--task-active' : ''}`}
          onClick={() => navigate('/offline-hunt')}
          title={offlineHuntActive && offlineHuntMonster ? `Polowanie: ${offlineHuntMonster.name_pl}` : 'Offline Training'}
        >
          <span className="town__nav-icon">🎯</span>
          <span className="town__nav-btn-label town__nav-btn-label--glass">Offline Trening</span>
          {offlineHuntActive && offlineHuntMonster && (
            <span className="town__task-indicator">
              {offlineHuntMonster.sprite}
            </span>
          )}
        </button>
        <button
          className={`town__nav-btn town__nav-tile town__nav-tile--rest${isResting ? ' town__nav-btn--resting' : ''}${!canRest && !isResting ? ' town__nav-btn--rest-full' : ''}${isBlocked ? ' town__nav-btn--blocked' : ''}`}
          onClick={handleRest}
          disabled={!canRest || isResting || isBlocked}
          title={isBlocked ? blockedReason : canRest ? 'Odpocznij i zregeneruj HP/MP do pełna' : 'HP i MP na maksimum'}
        >
          <span className="town__nav-icon">🏕️</span>
          <span className="town__nav-btn-label town__nav-btn-label--glass">{isResting ? 'Regeneracja...' : 'Odpoczynek'}</span>
          <span className="town__rest-full-tag" style={{ visibility: !canRest && !isResting ? 'visible' : 'hidden' }}>✓ Pełne</span>
        </button>
        <button className="town__nav-btn town__nav-tile town__nav-tile--party" onClick={() => navigate('/party')}>
          <span className="town__nav-icon">🤝</span>
          <span className="town__nav-btn-label town__nav-btn-label--glass">{t('town.nav.party')}</span>
        </button>
        <button className="town__nav-btn town__nav-tile town__nav-tile--guild" onClick={() => navigate('/guild')}>
          <span className="town__nav-icon">🏛️</span>
          <span className="town__nav-btn-label town__nav-btn-label--glass">Gildia</span>
        </button>
        <button className="town__nav-btn town__nav-tile town__nav-tile--arena" disabled title="Wkrótce dostępne!">
          <span className="town__nav-icon">🏟️</span>
          <span className="town__nav-btn-label town__nav-btn-label--glass">Arena</span>
          <span className="town__coming-soon">Wkrótce</span>
        </button>
        <button className="town__nav-btn town__nav-tile town__nav-tile--chat" onClick={() => navigate('/chat')}>
          <span className="town__nav-icon">💬</span>
          <span className="town__nav-btn-label town__nav-btn-label--glass">Chat</span>
        </button>
        <button className="town__nav-btn town__nav-tile town__nav-tile--friends" onClick={() => navigate('/friends')}>
          <span className="town__nav-icon">👥</span>
          <span className="town__nav-btn-label town__nav-btn-label--glass">Znajomi</span>
        </button>
        <button className="town__nav-btn town__nav-tile town__nav-tile--leaderboard" onClick={() => navigate('/leaderboard')}>
          <span className="town__nav-icon">🏆</span>
          <span className="town__nav-btn-label town__nav-btn-label--glass">{t('town.nav.leaderboard')}</span>
        </button>
        <button className="town__nav-btn town__nav-tile town__nav-tile--deaths" onClick={() => navigate('/deaths')}>
          <span className="town__nav-icon">💀</span>
          <span className="town__nav-btn-label town__nav-btn-label--glass">Śmierci</span>
        </button>
      </nav>

      {/* ── Rest Healing Overlay ─────────────────────────────────────────── */}
      {(isResting || restResult) && (
        <div className={`town__rest-overlay${restResult ? ' town__rest-overlay--done' : ''}`}>
          <div className="town__rest-particles">
            {Array.from({ length: 30 }).map((_, i) => (
              <span
                key={i}
                className="town__rest-particle"
                style={{
                  '--p-x': `${Math.random() * 100}%`,
                  '--p-delay': `${Math.random() * 2}s`,
                  '--p-duration': `${1.5 + Math.random() * 1.5}s`,
                  '--p-size': `${6 + Math.random() * 10}px`,
                } as React.CSSProperties}
              />
            ))}
          </div>
          <div className="town__rest-rings">
            <span className="town__rest-ring town__rest-ring--1" />
            <span className="town__rest-ring town__rest-ring--2" />
            <span className="town__rest-ring town__rest-ring--3" />
          </div>
          <div className="town__rest-center">
            {restResult ? (
              <>
                <span className="town__rest-icon town__rest-icon--done">✨</span>
                <span className="town__rest-text">Regeneracja zakończona!</span>
                {restResult.hpHealed > 0 && (
                  <span className="town__rest-heal town__rest-heal--hp">❤️ +{restResult.hpHealed} HP</span>
                )}
                {restResult.mpHealed > 0 && (
                  <span className="town__rest-heal town__rest-heal--mp">💙 +{restResult.mpHealed} MP</span>
                )}
              </>
            ) : (
              <>
                <span className="town__rest-icon">🏕️</span>
                <span className="town__rest-text">Odpoczywasz przy ognisku...</span>
                <div className="town__rest-progress">
                  <div className="town__rest-progress-fill" />
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default Town;
