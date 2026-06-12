import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCharacterStore } from '../../stores/characterStore';
import { useInventoryStore } from '../../stores/inventoryStore';
import { useSkillStore } from '../../stores/skillStore';
import { useOfflineTrainingResume } from '../../hooks/useOfflineTrainingResume';
import { xpProgress, xpToNextLevel } from '../../systems/levelSystem';
import { getTotalEquipmentStats, flattenItemsData } from '../../systems/itemSystem';
import { getTrainingBonuses } from '../../systems/skillSystem';
import { getElixirHpBonus, getElixirMpBonus } from '../../systems/combatElixirs';
import { getEffectiveChar as engineGetEffectiveChar } from '../../systems/combatEngine';
import itemsRaw from '../../data/items.json';

const ALL_ITEMS = flattenItemsData(itemsRaw as Parameters<typeof flattenItemsData>[0]);
import OfflineRewardModal from '../../components/ui/OfflineRewardModal/OfflineRewardModal';
import Icon from '../../components/atoms/Icon/Icon';
import GameIcon from '../../components/atoms/Twemoji/GameIcon';
import { getCharacterAvatar } from '../../data/classAvatars';
// Per-tile background art lives under `images/town/`. Each tile in the
// 7-up nav grid below maps to one of these PNGs and is rendered as an
// `<img>` (object-fit: cover) behind the glass-chip label so the entire
// tile becomes its own piece of art instead of just an emoji.
import imgOffline    from '../../assets/images/town/town-offline.png';
import imgDeposit    from '../../assets/images/town/town-deposit.png';
import imgMarket     from '../../assets/images/town/town-market.png';
import imgMonsters   from '../../assets/images/town/town-monsters.png';
import imgRest       from '../../assets/images/town/town-heal.png';
import imgRankings   from '../../assets/images/town/town-rankings.png';
import imgDeaths     from '../../assets/images/town/town-deaths.png';
import { useTransformStore } from '../../stores/transformStore';
import { getTransformColor } from '../../systems/transformSystem';
import { useGuildStore } from '../../stores/guildStore';
import { useGuildTagsStore } from '../../stores/guildTagsStore';
import { useCombatStore } from '../../stores/combatStore';
import { useOfflineHuntStore, OFFLINE_HUNT_MAX_SECONDS } from '../../stores/offlineHuntStore';
import { useConnectivityStore } from '../../stores/connectivityStore';
import { useMarketStore } from '../../stores/marketStore';
import { usePartyStore } from '../../stores/partyStore';
import { usePartyPresenceStore } from '../../stores/partyPresenceStore';
import { MAX_PARTY_SIZE, canJoinParty, getAggroWeight, type IPartyMember } from '../../systems/partySystem';
import { MONSTER_RARITY_LABELS } from '../../systems/lootSystem';
import { stopCombat } from '../../systems/combatEngine';
import { MonsterSprite } from '../../components/ui/Sprite/MonsterSprite';
import './Town.scss';

const RARITY_BORDER_COLORS: Record<string, string> = {
  normal: '#9e9e9e',
  strong: '#2196f3',
  epic: '#4caf50',
  legendary: '#f44336',
  boss: '#ffc107',
};

const CLASS_ICONS: Record<string, string> = {
  Knight: 'crossed-swords', Mage: 'crystal-ball', Cleric: 'sparkles', Archer: 'bow-and-arrow',
  Rogue: 'dagger', Necromancer: 'skull', Bard: 'musical-note',
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

/** How often the tiles auto-pulse (per user spec: every 30 seconds). */
const TILE_AUTOPULSE_INTERVAL_MS = 30_000;
/** How long each pulse animation lasts before the class is cleared. */
const TILE_AUTOPULSE_DURATION_MS = 900;

const Town = () => {
  const navigate   = useNavigate();
  const character  = useCharacterStore((s) => s.character);
  // 2026-05-08: market sale notifications. The market tile glows when
  // someone has bought one of the player's listings — the actual list
  // lives in `marketStore.saleNotifications`, refreshed on /town mount.
  const saleNotifications = useMarketStore((s) => s.saleNotifications);
  const fetchSaleNotifications = useMarketStore((s) => s.fetchSaleNotifications);
  const hasMarketSales = saleNotifications.length > 0;
  useEffect(() => {
    if (character) void fetchSaleNotifications(character.id);
  }, [character, fetchSaleNotifications]);
  const completedTransforms = useTransformStore((s) => s.completedTransforms);
  const getHighestTransformColor = useTransformStore((s) => s.getHighestTransformColor);
  const transformColor = getHighestTransformColor();
  const playerAvatarSrc = character ? getCharacterAvatar(character.class, completedTransforms) : '';

  // Derive a single accent color (not a gradient) from the current transform tier.
  // Before the first transform is completed we fall back to the character class
  // color so the avatar accent never looks out-of-place. Once a transform tier
  // is completed, switch to the transform's solid color or first gradient stop.
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
  const equipment = useInventoryStore((s) => s.equipment);
  const skillLevels = useSkillStore((s) => s.skillLevels);

  // Combat state for live widget and blocking the rest button.
  const combatPhase = useCombatStore((s) => s.phase);
  const combatMonster = useCombatStore((s) => s.monster);
  const combatMonsterRarity = useCombatStore((s) => s.monsterRarity);
  const combatSessionKills = useCombatStore((s) => s.sessionKills);
  const combatXpPerHour = useCombatStore((s) => s.sessionXpPerHour);
  const isCombatActive = combatPhase === 'fighting' || combatPhase === 'victory';
  const offlineHuntActive = useOfflineHuntStore((s) => s.isActive);
  const offlineHuntMonster = useOfflineHuntStore((s) => s.targetMonster);
  const offlineHuntStartedAt = useOfflineHuntStore((s) => s.startedAt);
  // 2026-05-20 spec ("zamiast napisu offline trening to ile tam jestesmy
  // na 12h"): tick once a second while the hunt is active so the elapsed
  // time on the tile stays current. The ticker is gated on `isActive` so
  // we don't burn a render budget on the Town view in the common case
  // where no hunt is running.
  const [offlineTick, setOfflineTick] = useState(Date.now());
  useEffect(() => {
    if (!offlineHuntActive) return;
    const id = setInterval(() => setOfflineTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [offlineHuntActive]);
  const offlineHuntElapsedSec = (() => {
    if (!offlineHuntActive || !offlineHuntStartedAt) return 0;
    const started = new Date(offlineHuntStartedAt).getTime();
    if (Number.isNaN(started)) return 0;
    const sec = Math.floor((offlineTick - started) / 1000);
    return Math.max(0, Math.min(OFFLINE_HUNT_MAX_SECONDS, sec));
  })();
  const offlineHuntLabel = (() => {
    if (!offlineHuntActive) return null;
    const sec = offlineHuntElapsedSec;
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    // "5h 23m / 12h" — concise enough to fit the tile's glass label.
    return `${h}h ${m.toString().padStart(2, '0')}m / 12h`;
  })();
  // Rest is the only Town tile that has a "blocked while fighting" state — the
  // 6 other tiles always navigate freely.
  const isBlocked = isCombatActive;
  const blockedReason = 'Zakończ walkę najpierw';

  // Party state for expand widget
  const party = usePartyStore((s) => s.party);
  // 2026-05-09: live HP/MP for party members comes from the realtime
  // presence broadcast, NOT from `party.members[].hp` (which is just a
  // 0/1 placeholder set by `rowToMember` because the parties DB schema
  // doesn't track health). Hook ensures the strip shows real bars.
  const partyPresence = usePartyPresenceStore((s) => s.byMember);
  const addBotHelper = usePartyStore((s) => s.addBotHelper);
  const removePartyMember = usePartyStore((s) => s.removeMember);
  const leaveParty = usePartyStore((s) => s.leaveParty);
  const disbandParty = usePartyStore((s) => s.disbandParty);
  const createParty = usePartyStore((s) => s.createParty);
  const [partyExpanded, setPartyExpanded] = useState(false);

  // 2026-05-20 spec: party features (create, bots, public list) are
  // multiplayer-only; mute the buttons in offline mode so the player
  // can't accidentally spin up a row they can't use.
  const playMode = useConnectivityStore((s) => s.mode);
  const isOffline = playMode === 'offline';
  const handleCreateParty = useCallback(() => {
    if (isOffline) return;
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
    void createParty(self, {
      name:        `${character.name}'s party`,
      description: '',
      password:    null,
      isPublic:    true,
    });
    setPartyExpanded(true);
  }, [character, party, createParty, isOffline]);

  const isPartyLeader = !!party && !!character && party.leaderId === character.id;

  // Effective max HP/MP via the engine helper (single source of truth with Combat).
  const eqStats = getTotalEquipmentStats(equipment, ALL_ITEMS);
  const tb = getTrainingBonuses(skillLevels, character?.class);
  const engineEff = character ? engineGetEffectiveChar(character) : null;
  const effMaxHp = engineEff
    ? engineEff.max_hp
    : (character ? character.max_hp + (eqStats.hp ?? 0) + (tb.max_hp ?? 0) + getElixirHpBonus() : 0);
  const effMaxMp = engineEff
    ? engineEff.max_mp
    : (character ? character.max_mp + (eqStats.mp ?? 0) + (tb.max_mp ?? 0) + getElixirMpBonus() : 0);

  // -- Rest / Heal -------------------------------------------------------------
  const [isResting, setIsResting] = useState(false);
  const [restResult, setRestResult] = useState<{ hpHealed: number; mpHealed: number } | null>(null);

  const handleRest = useCallback(() => {
    if (!character || isResting) return;
    const hpToHeal = Math.max(0, effMaxHp - character.hp);
    const mpToHeal = Math.max(0, effMaxMp - character.mp);
    if (hpToHeal <= 0 && mpToHeal <= 0) return; // already full

    setIsResting(true);
    setRestResult(null);

    // Animate for 10s then apply the heal
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

  // -- Offline reward popup ---------------------------------------------------
  const { reward: offlineReward, clearReward: clearOfflineReward } = useOfflineTrainingResume();

  // -- Tile auto-pulse (every 30s) --------------------------------------------
  // The user wanted tiles to come alive on their own (not just on hover). We
  // toggle a `town__nav--pulse` class on the nav root every 30 seconds; child
  // tiles use that to play a brief glow/scale animation, then we remove the
  // class so the next pulse re-triggers the keyframes from scratch.
  const [tilesPulsing, setTilesPulsing] = useState(false);
  useEffect(() => {
    const id = setInterval(() => {
      setTilesPulsing(true);
      const off = setTimeout(() => setTilesPulsing(false), TILE_AUTOPULSE_DURATION_MS);
      return () => clearTimeout(off);
    }, TILE_AUTOPULSE_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  // 2026-05-18: prime the guild tag cache for every party member so
  // the [TAG] prefix renders in the expanded party widget.
  useEffect(() => {
    if (!party || party.members.length === 0) return;
    const names = party.members.filter((m) => !m.isBot).map((m) => m.name);
    if (names.length > 0) void useGuildTagsStore.getState().resolveTagsByName(names);
  }, [party]);

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

      {/* Character card – HP/MP/XP bars at a glance. The avatar/gold/lang/sync
          /logout chrome moved to the persistent TopHeader + AvatarMenu. */}
      {character && (() => {
        const flameTier = Math.min(completedTransforms.length, 11);
        const ablazeBoost = 1 + (flameTier - 1) * 0.22;
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
              }}><GameIcon name={CLASS_ICONS[character.class] ?? '?'} /></span>
              <span className="town__char-level">Poziom {character.level}</span>
            </div>

            <div className="town__bar-wrap">
              <span className="town__bar-label">HP</span>
              <div className="town__bar town__bar--hp">
                <div className="town__bar-fill" style={{ width: `${hpPct * 100}%` }} />
              </div>
              <span className="town__bar-value">{character.hp}/{effMaxHp}</span>
            </div>

            <div className="town__bar-wrap">
              <span className="town__bar-label">MP</span>
              <div className="town__bar town__bar--mp">
                <div className="town__bar-fill" style={{ width: `${mpPct * 100}%` }} />
              </div>
              <span className="town__bar-value">{character.mp}/{effMaxMp}</span>
            </div>

            <div className="town__bar-wrap">
              <span className="town__bar-label">XP</span>
              <div className="town__bar town__bar--xp">
                <div className="town__bar-fill" style={{ width: `${xpPct * 100}%` }} />
                <span className="town__bar-pct">{(xpPct * 100).toFixed(1)}%</span>
              </div>
              <span className="town__bar-value">{character.xp.toLocaleString('pl-PL')}/{xpNeeded.toLocaleString('pl-PL')}</span>
            </div>

            {character.stat_points > 0 && (
              <button
                className="town__stat-points town__stat-points--clickable"
                onClick={() => navigate('/inventory')}
                title="Rozdaj punkty statystyk w widoku Postać"
              >
                +{character.stat_points} statystyk do rozdania
              </button>
            )}
          </div>
        );
      })()}

      {/* -- Compact Combat Indicator --------------------------------------- */}
      {isCombatActive && combatMonster && (
        <div
          className={`town__combat-strip town__combat-strip--${combatMonsterRarity}`}
          style={{ '--rarity-color': RARITY_BORDER_COLORS[combatMonsterRarity] } as React.CSSProperties}
        >
          <div className="town__combat-strip-left" onClick={() => navigate('/combat')}>
            <span className="town__combat-strip-sprite">
              <MonsterSprite level={combatMonster.level} sprite={combatMonster.sprite ?? 'alien-monster'} name={combatMonster.name_pl} />
            </span>
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
              <GameIcon name="crossed-swords" />
            </button>
            <button className="town__combat-strip-btn town__combat-strip-btn--stop" onClick={() => stopCombat()} title="Zakończ walkę">
              <Icon name="x" />
            </button>
          </div>
        </div>
      )}

      {/* -- Party Expand Widget ---------------------------------------- */}
      {/* 2026-05-18 spec ("usun ten uuid party i napis party, zostaw tylko
          ikonki klasy od lewej sojusznikow party i color borderu ma byc
          color aktualnego ich transformu"): collapsed header now shows
          ONLY the row of class-icon avatars (no :handshake: chip, no "Party"
          label, no UUID, no count badge). Each avatar's border is tinted
          with that ally's highest-completed-transform colour — local
          player resolves via the live transform store, remote allies via
          their party-presence `transformTier` snapshot, AI bots fall
          back to neutral grey (no transform progression). The body
          (HP bars, kick, actions) still renders when the strip is
          expanded — only the header chrome was trimmed. */}
      {party ? (
        <div className={`town__party-strip${partyExpanded ? ' town__party-strip--expanded' : ''}`}>
          <div
            className="town__party-strip-header"
            onClick={() => setPartyExpanded((v) => !v)}
          >
            {/* 2026-05-18 spec ("Dodaj tylko na samym przodze ikonke rak
                ze to party, przed ikonkami klass"): re-add the :handshake: chip
                at the very left edge so the strip still reads visually
                as "this is your party" — the UUID + label stay gone,
                only the small icon is back. */}
            <span className="town__party-strip-icon"><GameIcon name="handshake" /></span>
            <div className="town__party-strip-avatars">
              {party.members.slice(0, MAX_PARTY_SIZE).map((m) => {
                const memberHpPct = m.maxHp > 0 ? Math.min(1, m.hp / m.maxHp) : 0;
                // Resolve transform colour per member. Self pulls from
                // the live transform store so swapping a tier mid-
                // session re-tints the border immediately; others come
                // from the broadcast presence snapshot (transformTier:
                // 0 means base class -> no transform colour, falls back
                // to the class palette below).
                let transformTier = 0;
                if (!m.isBot) {
                  if (m.id === character?.id) {
                    transformTier = useTransformStore.getState().getHighestCompletedTransform?.() ?? 0;
                  } else {
                    transformTier = partyPresence[m.id]?.transformTier ?? 0;
                  }
                }
                const tColor = transformTier > 0 ? getTransformColor(transformTier) : null;
                const borderCss = tColor?.css ?? CLASS_COLORS[m.class] ?? 'rgba(255,255,255,0.18)';
                // Use a thicker tinted border to make the transform
                // colour pop; gradient transforms get the gradient via
                // `border-image`, solid colours land on plain border.
                const avatarStyle: React.CSSProperties = tColor?.gradient
                  ? {
                      border: '2px solid transparent',
                      borderImage: `linear-gradient(135deg, ${tColor.gradient[0]}, ${tColor.gradient[1]}) 1`,
                    }
                  : { border: `2px solid ${borderCss}` };
                return (
                  <div
                    key={m.id}
                    className={`town__party-avatar${m.isBot ? ' town__party-avatar--bot' : ''}${m.id === character?.id ? ' town__party-avatar--me' : ''}`}
                    title={`${m.name} · ${m.class} Lvl ${m.level} · ${m.hp}/${m.maxHp} HP`}
                    style={avatarStyle}
                  >
                    <span className="town__party-avatar-icon">
                      {m.isBot ? <GameIcon name="robot" /> : (CLASS_ICONS[m.class] ?? '?')}
                    </span>
                    <span className="town__party-avatar-hp">
                      <span
                        className="town__party-avatar-hp-fill"
                        style={{
                          width: `${memberHpPct * 100}%`,
                          background: memberHpPct > 0.5 ? '#4caf50' : memberHpPct > 0.25 ? '#ffc107' : '#f44336',
                        }}
                      />
                    </span>
                  </div>
                );
              })}
            </div>
            <span className="town__party-strip-caret">
              {partyExpanded ? <Icon name="chevronUp" /> : <Icon name="chevronDown" />}
            </span>
          </div>

          {partyExpanded && (
            <div className="town__party-strip-body">
              {party.members.map((m) => {
                const weight = getAggroWeight(m.class);
                const isMe = m.id === character?.id;
                // 2026-05-09: pull live HP/MP from the realtime presence
                // snapshot for remote allies; for the local player and
                // bots use the live store value. Falls back to the row
                // placeholder only when no source exists yet.
                let curHp = m.hp;
                let maxHp = m.maxHp;
                if (isMe && character) {
                    curHp = character.hp;
                    maxHp = character.max_hp;
                } else if (!m.isBot) {
                    const snap = partyPresence[m.id];
                    if (snap) {
                        curHp = snap.hp;
                        maxHp = snap.maxHp;
                    }
                }
                const memberHpPct = maxHp > 0 ? Math.min(1, curHp / maxHp) : 0;
                const hasLiveHp = maxHp > 1; // bigger than the 0/1 placeholder
                return (
                  <div key={m.id} className={`town__party-row${isMe ? ' town__party-row--me' : ''}${m.isBot ? ' town__party-row--bot' : ''}`}>
                    <span className="town__party-row-icon">
                      {m.isBot ? <GameIcon name="robot" /> : (CLASS_ICONS[m.class] ?? '?')}
                    </span>
                    <div className="town__party-row-info">
                      <div className="town__party-row-name">
                        {(() => {
                            // 2026-05-18: prefix [TAG] when the row's
                            // character belongs to a guild. For me pull
                            // from the live guild store; for others use
                            // the cached lookup populated by the effect
                            // a few lines below.
                            if (isMe) {
                                const myTag = useGuildStore.getState().guild?.tag;
                                return myTag ? `[${myTag}] ${m.name}` : m.name;
                            }
                            const tag = useGuildTagsStore.getState().getTagByNameSync(m.name);
                            return tag ? `${tag} ${m.name}` : m.name;
                        })()}
                        {isMe && <span className="town__party-badge">Ty</span>}
                        {m.isBot && <span className="town__party-badge town__party-badge--bot">Bot</span>}
                      </div>
                      <div className="town__party-row-meta">
                        <span style={{ color: CLASS_COLORS[m.class] ?? '#9e9e9e' }}>
                          {m.class}
                        </span>
                        <span>Lvl {m.level}</span>
                        <span className="town__party-aggro" title="Waga aggro bossa">
                          <GameIcon name="bullseye" /> {weight}
                        </span>
                      </div>
                      <div className="town__party-hp-bar">
                        <div
                          className="town__party-hp-fill"
                          style={{
                            width: `${memberHpPct * 100}%`,
                            background: memberHpPct > 0.5 ? '#4caf50' : memberHpPct > 0.25 ? '#ffc107' : '#f44336',
                          }}
                        />
                        <span className="town__party-hp-text">
                          {hasLiveHp ? `${curHp}/${maxHp}` : '— / —'}
                        </span>
                      </div>
                    </div>
                    {isPartyLeader && !isMe && (
                      <button
                        className="town__party-kick"
                        onClick={(e) => { e.stopPropagation(); removePartyMember(m.id); }}
                        title="Wyrzuć z party"
                      >
                        <Icon name="x" />
                      </button>
                    )}
                  </div>
                );
              })}

              <div className="town__party-strip-actions">
                {/* 2026-05-09 spec ("jako sojusznik party nie leader nie
                    powinienem moc dodawac boty"): only the leader can
                    add bots. Members see no +Bot affordance. */}
                {/* 2026-05-20 spec: bot helpers are blocked in offline mode
                    (same rule as "no other live players"). Hide the +Bot
                    affordance entirely so it can't be tapped — the store
                    also short-circuits as belt-and-braces. */}
                {isPartyLeader && !isOffline && canJoinParty(party.members.length) && (
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
                  <GameIcon name="handshake" /> Party
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
          <span className="town__party-strip-icon"><GameIcon name="handshake" /></span>
          <span className="town__party-strip-empty-text">
            {isOffline ? 'Tryb offline — party niedostępne' : 'Solo — brak party'}
          </span>
          {/* 2026-05-20 spec: hide party CTAs in offline mode. */}
          {!isOffline && (
            <button className="town__party-strip-create" onClick={handleCreateParty}>
              + Stwórz party
            </button>
          )}
          {!isOffline && (
          <button
            className="town__party-strip-goto"
            onClick={() => navigate('/party')}
            title="Dołącz do party"
          >
            Dołącz <Icon name="arrowRight" />
          </button>
          )}
        </div>
      )}

      {/* -- Town tiles (mobile-first responsive grid) ---------------------
          Order is fixed by user spec, left -> right:
          Offline trening · Depozyt · Market · Potwory · Odpoczynek · Rankingi · Śmierci  */}
      <nav
        className={`town__nav town__nav--seven${tilesPulsing ? ' town__nav--pulse' : ''}`}
        style={{
          '--tile-accent':     tileAccent,
          '--tile-accent-rgb': tileAccentRgb,
        } as React.CSSProperties}
      >
        <button
          className={`town__nav-btn town__nav-tile town__nav-tile--offline town__nav-tile--has-img${offlineHuntActive ? ' town__nav-btn--task-active town__nav-tile--offline-active' : ''}`}
          onClick={() => navigate('/offline-hunt')}
          title={offlineHuntActive && offlineHuntMonster ? `Polowanie: ${offlineHuntMonster.name_pl}` : 'Offline Trening'}
        >
          {/* 2026-05-20 spec ("Jak polowanie jest aktywne to zamiast
              zdjecia na kafelku Offline trening to co jest to dajemy
              tego potwora ktorego bijemy aktualnie i czas zamiast napisu
              offline trening to ile tam jestesmy na 12h"): when a hunt is
              running, the static offline-trening painting is swapped for
              a centered MonsterSprite of the mob being farmed, and the
              glass label reads the elapsed/12h timer instead of the
              static "Offline Trening" string. */}
          {offlineHuntActive && offlineHuntMonster ? (
            <span className="town__nav-tile-monster">
              <MonsterSprite
                level={offlineHuntMonster.level}
                sprite={offlineHuntMonster.sprite}
                name={offlineHuntMonster.name_pl}
              />
            </span>
          ) : (
            <img className="town__nav-tile-img" src={imgOffline} alt="" draggable={false} />
          )}
          <span className="town__nav-btn-label town__nav-btn-label--glass">
            {offlineHuntActive && offlineHuntLabel ? offlineHuntLabel : 'Offline Trening'}
          </span>
        </button>

        <button className="town__nav-btn town__nav-tile town__nav-tile--deposit town__nav-tile--has-img" onClick={() => navigate('/deposit')}>
          <img className="town__nav-tile-img" src={imgDeposit} alt="" draggable={false} />
          <span className="town__nav-btn-label town__nav-btn-label--glass">Depozyt</span>
        </button>

        <button
          className={`town__nav-btn town__nav-tile town__nav-tile--market town__nav-tile--has-img${hasMarketSales ? ' town__nav-tile--alert' : ''}${isOffline ? ' town__nav-btn--offline-locked' : ''}`}
          onClick={() => navigate('/market')}
          disabled={isOffline}
          title={isOffline ? 'Niedostępne w trybie offline' : 'Market'}
        >
          <img className="town__nav-tile-img" src={imgMarket} alt="" draggable={false} />
          <span className="town__nav-btn-label town__nav-btn-label--glass">Market</span>
          {hasMarketSales && !isOffline && (
            <span className="town__nav-tile-badge" aria-label={`${saleNotifications.length} nowych sprzedaży`}>
              {saleNotifications.length}
            </span>
          )}
        </button>

        <button className="town__nav-btn town__nav-tile town__nav-tile--monsters town__nav-tile--has-img" onClick={() => navigate('/monsters')}>
          <img className="town__nav-tile-img" src={imgMonsters} alt="" draggable={false} />
          <span className="town__nav-btn-label town__nav-btn-label--glass">Potwory</span>
        </button>

        <button
          className={`town__nav-btn town__nav-tile town__nav-tile--rest town__nav-tile--has-img${isResting ? ' town__nav-btn--resting' : ''}${!canRest && !isResting ? ' town__nav-btn--rest-full' : ''}${isBlocked ? ' town__nav-btn--blocked' : ''}`}
          onClick={handleRest}
          disabled={!canRest || isResting || isBlocked}
          title={isBlocked ? blockedReason : canRest ? 'Odpocznij i zregeneruj HP/MP do pełna' : 'HP i MP na maksimum'}
        >
          <img className="town__nav-tile-img" src={imgRest} alt="" draggable={false} />
          <span className="town__nav-btn-label town__nav-btn-label--glass">{isResting ? 'Regeneracja...' : 'Odpoczynek'}</span>
          <span className="town__rest-full-tag" style={{ visibility: !canRest && !isResting ? 'visible' : 'hidden' }}><GameIcon name="check-mark-button" /> Pełne</span>
        </button>

        <button
          className={`town__nav-btn town__nav-tile town__nav-tile--leaderboard town__nav-tile--has-img${isOffline ? ' town__nav-btn--offline-locked' : ''}`}
          onClick={() => navigate('/leaderboard')}
          disabled={isOffline}
          title={isOffline ? 'Niedostępne w trybie offline' : 'Rankingi'}
        >
          <img className="town__nav-tile-img" src={imgRankings} alt="" draggable={false} />
          <span className="town__nav-btn-label town__nav-btn-label--glass">Rankingi</span>
        </button>

        <button
          className={`town__nav-btn town__nav-tile town__nav-tile--deaths town__nav-tile--has-img${isOffline ? ' town__nav-btn--offline-locked' : ''}`}
          onClick={() => navigate('/deaths')}
          disabled={isOffline}
          title={isOffline ? 'Niedostępne w trybie offline' : 'Śmierci'}
        >
          <img className="town__nav-tile-img" src={imgDeaths} alt="" draggable={false} />
          <span className="town__nav-btn-label town__nav-btn-label--glass">Śmierci</span>
        </button>
      </nav>

      {/* -- Rest Healing Overlay ------------------------------------------- */}
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
                <span className="town__rest-icon town__rest-icon--done"><GameIcon name="sparkles" /></span>
                <span className="town__rest-text">Regeneracja zakończona!</span>
                {restResult.hpHealed > 0 && (
                  <span className="town__rest-heal town__rest-heal--hp"><GameIcon name="red-heart" /> +{restResult.hpHealed} HP</span>
                )}
                {restResult.mpHealed > 0 && (
                  <span className="town__rest-heal town__rest-heal--mp"><GameIcon name="blue-heart" /> +{restResult.mpHealed} MP</span>
                )}
              </>
            ) : (
              <>
                <span className="town__rest-icon"><GameIcon name="camping" /></span>
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
