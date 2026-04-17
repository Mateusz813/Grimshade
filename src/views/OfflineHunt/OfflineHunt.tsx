import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useCharacterStore } from '../../stores/characterStore';
import { useSkillStore } from '../../stores/skillStore';
import { useMasteryStore } from '../../stores/masteryStore';
import {
    useOfflineHuntStore,
    OFFLINE_HUNT_MAX_SECONDS,
    OFFLINE_HUNT_BASE_SECONDS_PER_KILL,
    getOfflineHuntSpeedMultiplier,
} from '../../stores/offlineHuntStore';
import {
    previewOfflineHunt,
    claimOfflineHunt,
    type IOfflineHuntClaimResult,
} from '../../systems/offlineHuntSystem';
import { getTrainableStatsForClass, SKILL_NAMES_PL } from '../../systems/skillSystem';
import { getMonsterUnlockStatus } from '../../systems/progression';
import {
    flattenItemsData,
    findBaseItem,
    getItemIcon,
    RARITY_LABELS,
} from '../../systems/itemSystem';
import { getItemDisplayInfo } from '../../systems/itemGenerator';
import { MONSTER_RARITY_LABELS } from '../../systems/lootSystem';
import { ELIXIRS } from '../../stores/shopStore';
import ItemIcon from '../../components/ui/ItemIcon/ItemIcon';
import type { IMonster, TMonsterRarity } from '../../types/monster';
import monstersRaw from '../../data/monsters.json';
import itemsRaw from '../../data/items.json';
import './OfflineHunt.scss';

const ALL_ITEMS = flattenItemsData(itemsRaw as Parameters<typeof flattenItemsData>[0]);

const MONSTER_RARITY_BORDER: Record<TMonsterRarity, string> = {
    normal:    '#9e9e9e',
    strong:    '#2196f3',
    epic:      '#4caf50',
    legendary: '#f44336',
    boss:      '#ffc107',
};

const STONE_ICON_BY_TYPE: Record<string, { icon: string; label: string; color: string }> = {
    common_stone:    { icon: '💎', label: 'Kamień Zwykły',      color: '#9e9e9e' },
    rare_stone:      { icon: '💎', label: 'Kamień Rzadki',      color: '#2196f3' },
    epic_stone:      { icon: '💎', label: 'Kamień Epicki',      color: '#4caf50' },
    legendary_stone: { icon: '💎', label: 'Kamień Legendarny',  color: '#f44336' },
    mythic_stone:    { icon: '💎', label: 'Kamień Mityczny',    color: '#ffc107' },
    heroic_stone:    { icon: '💎', label: 'Kamień Heroiczny',   color: '#9c27b0' },
};

const formatInt = (n: number): string => Math.floor(n).toLocaleString('pl-PL');
const formatPct = (n: number): string => `${n.toFixed(1)}%`;
const ALL_MONSTERS = (monstersRaw as unknown as IMonster[]).slice().sort((a, b) => a.level - b.level);

const formatDuration = (seconds: number): string => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
};

// ── Compact Reward Modal ────────────────────────────────────────────────────

interface IRewardModalProps {
    result: IOfflineHuntClaimResult;
    onClose: () => void;
}

const RewardModal = ({ result, onClose }: IRewardModalProps) => {
    const rarityOrder: TMonsterRarity[] = ['normal', 'strong', 'epic', 'legendary', 'boss'];
    const totalPotions = Object.values(result.potionDrops).reduce((a, b) => a + b, 0);
    const totalChests  = Object.values(result.spellChestDrops).reduce((a, b) => a + b, 0);
    const totalStones  = Object.values(result.stoneDrops).reduce((a, b) => a + b, 0);
    const totalItems   = result.itemDrops.reduce((a, b) => a + b.count, 0);
    const hasAnyDrops  = totalItems > 0 || totalPotions > 0 || totalChests > 0 || totalStones > 0;

    return (
        <motion.div
            className="oh-modal__backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
        >
            <motion.div
                className="oh-modal"
                initial={{ opacity: 0, scale: 0.9, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: 20 }}
                transition={{ duration: 0.25, ease: 'backOut' }}
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="oh-modal__header">
                    <span className="oh-modal__trophy">🏆</span>
                    <span className="oh-modal__title">Nagrody odebrane!</span>
                </div>

                {/* Quick stats row */}
                <div className="oh-modal__stats">
                    <div className="oh-modal__stat">
                        <span className="oh-modal__stat-icon">⏱</span>
                        <span className="oh-modal__stat-val">{formatDuration(result.cappedSeconds)}</span>
                    </div>
                    <div className="oh-modal__stat">
                        <span className="oh-modal__stat-icon">👾</span>
                        <span className="oh-modal__stat-val">{formatInt(result.kills)}×</span>
                    </div>
                    <div className="oh-modal__stat oh-modal__stat--gold">
                        <span className="oh-modal__stat-icon">💰</span>
                        <span className="oh-modal__stat-val">+{formatInt(result.goldGained)}</span>
                    </div>
                </div>

                {/* Rarity kills — compact row */}
                <div className="oh-modal__rarity-row">
                    {rarityOrder.map((r) => {
                        const count = result.killsByRarity[r] ?? 0;
                        if (count === 0) return null;
                        return (
                            <span key={r} className="oh-modal__rarity-pill" style={{ borderColor: MONSTER_RARITY_BORDER[r], color: MONSTER_RARITY_BORDER[r] }}>
                                {MONSTER_RARITY_LABELS[r]} ×{formatInt(count)}
                            </span>
                        );
                    })}
                </div>

                {/* XP + Skill — two compact rows */}
                <div className="oh-modal__xp-row oh-modal__xp-row--char">
                    <span className="oh-modal__xp-label">⭐ XP</span>
                    <span className="oh-modal__xp-value">+{formatInt(result.xpGained)}</span>
                    <span className="oh-modal__xp-detail">
                        {result.levelsGained > 0
                            ? `Lvl ${result.levelBefore} → ${result.levelAfter}`
                            : `+${formatPct(result.xpPctOfLevel)} lvl`}
                    </span>
                </div>
                <div className="oh-modal__xp-row oh-modal__xp-row--skill">
                    <span className="oh-modal__xp-label">✨ {SKILL_NAMES_PL[result.skillId] ?? result.skillId}</span>
                    <span className="oh-modal__xp-value">+{formatInt(result.skillXpGained)}</span>
                    <span className="oh-modal__xp-detail">
                        {result.skillLevelsGained > 0
                            ? `Lvl ${result.skillLevelBefore} → ${result.skillLevelAfter}`
                            : `+${formatPct(result.skillXpPctOfLevel)} lvl`}
                    </span>
                </div>

                {/* Drops — compact grid */}
                {hasAnyDrops && (
                    <div className="oh-modal__drops">
                        <div className="oh-modal__drops-title">🎁 Drop</div>
                        <div className="oh-modal__drops-grid">
                            {result.itemDrops.map((drop) => {
                                const genInfo = getItemDisplayInfo(drop.itemId);
                                const base = genInfo ? null : findBaseItem(drop.itemId, ALL_ITEMS);
                                const icon = genInfo?.icon ?? getItemIcon(drop.itemId, base?.slot ?? drop.slot ?? 'mainHand', ALL_ITEMS);
                                const tooltipName = genInfo?.name_pl ?? base?.name_pl ?? drop.itemId;
                                return (
                                    <ItemIcon
                                        key={`${drop.itemId}_${drop.rarity}_${drop.itemLevel}`}
                                        icon={icon}
                                        rarity={drop.rarity}
                                        itemLevel={drop.itemLevel}
                                        quantity={drop.count}
                                        size="sm"
                                        tooltip={`${tooltipName} (${RARITY_LABELS[drop.rarity]} Lv${drop.itemLevel})`}
                                    />
                                );
                            })}
                            {Object.entries(result.potionDrops).map(([potionId, count]) => {
                                const elixir = ELIXIRS.find((e) => e.id === potionId);
                                return (
                                    <div key={potionId} className="oh-modal__drop-chip" title={elixir?.name_pl ?? potionId}>
                                        <span>{elixir?.icon ?? '⚗️'}</span>
                                        <span className="oh-modal__drop-chip-qty">×{formatInt(count)}</span>
                                    </div>
                                );
                            })}
                            {Object.entries(result.spellChestDrops)
                                .sort(([a], [b]) => Number(a) - Number(b))
                                .map(([level, count]) => (
                                    <div key={`sc_${level}`} className="oh-modal__drop-chip" title={`Spell Chest Lv${level}`}>
                                        <span>📦</span>
                                        <span className="oh-modal__drop-chip-lvl">Lv{level}</span>
                                        <span className="oh-modal__drop-chip-qty">×{formatInt(count)}</span>
                                    </div>
                                ))}
                            {Object.entries(result.stoneDrops).map(([stoneType, count]) => {
                                const meta = STONE_ICON_BY_TYPE[stoneType] ?? { icon: '💎', label: stoneType, color: '#9e9e9e' };
                                return (
                                    <div key={stoneType} className="oh-modal__drop-chip" title={meta.label} style={{ borderColor: meta.color }}>
                                        <span style={{ color: meta.color }}>{meta.icon}</span>
                                        <span className="oh-modal__drop-chip-qty" style={{ color: meta.color }}>×{formatInt(count)}</span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {!hasAnyDrops && (
                    <div className="oh-modal__no-drops">Brak dropu tym razem</div>
                )}

                <button className="oh-modal__ok-btn" onClick={onClose}>OK</button>
            </motion.div>
        </motion.div>
    );
};

// ── Main component ──────────────────────────────────────────────────────────

const OfflineHunt = () => {
    const navigate = useNavigate();
    const character = useCharacterStore((s) => s.character);
    const skillLevels = useSkillStore((s) => s.skillLevels);
    const masteries = useMasteryStore((s) => s.masteries);

    const isActive = useOfflineHuntStore((s) => s.isActive);
    const startedAt = useOfflineHuntStore((s) => s.startedAt);
    const targetMonster = useOfflineHuntStore((s) => s.targetMonster);
    const trainedSkillId = useOfflineHuntStore((s) => s.trainedSkillId);
    const startHunt = useOfflineHuntStore((s) => s.startHunt);
    const stopHunt = useOfflineHuntStore((s) => s.stopHunt);

    const [pickedSkillId, setPickedSkillId] = useState<string | null>(null);
    const [pickedMonsterId, setPickedMonsterId] = useState<string | null>(null);
    const [claimResult, setClaimResult] = useState<IOfflineHuntClaimResult | null>(null);
    const [claimFxActive, setClaimFxActive] = useState(false);
    const [nowTick, setNowTick] = useState(Date.now());

    useEffect(() => {
        if (!isActive) return;
        const id = setInterval(() => setNowTick(Date.now()), 1000);
        return () => clearInterval(id);
    }, [isActive]);

    const trainableSkills = useMemo(() => {
        if (!character) return [];
        return getTrainableStatsForClass(character.class).map((id) => ({
            id,
            name: SKILL_NAMES_PL[id] ?? id,
            level: skillLevels[id] ?? 0,
        }));
    }, [character, skillLevels]);

    const unlockedMonsters = useMemo(() => {
        if (!character) return [];
        return ALL_MONSTERS
            .map((m) => ({
                monster: m,
                status: getMonsterUnlockStatus(m, ALL_MONSTERS, character.level, masteries),
                masteryLevel: masteries[m.id]?.level ?? 0,
            }))
            .filter((e) => e.status.unlocked);
    }, [character, masteries]);

    const livePreview = useMemo(() => {
        if (!isActive) return null;
        return previewOfflineHunt();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isActive, nowTick, startedAt, targetMonster, trainedSkillId]);

    const handleStart = (): void => {
        if (!pickedSkillId || !pickedMonsterId) return;
        const monster = ALL_MONSTERS.find((m) => m.id === pickedMonsterId);
        if (!monster) return;
        startHunt(monster, pickedSkillId);
        setClaimResult(null);
    };

    const handleClaim = (): void => {
        const result = claimOfflineHunt();
        if (result) {
            setClaimFxActive(true);
            setTimeout(() => {
                setClaimResult(result);
                setPickedSkillId(null);
                setPickedMonsterId(null);
                setClaimFxActive(false);
            }, 1600);
        }
    };

    const handleCancel = (): void => {
        stopHunt();
        setClaimResult(null);
    };

    const handleDismissResult = (): void => {
        setClaimResult(null);
    };

    if (!character) {
        return (
            <div className="oh">
                <div className="oh__empty">Brak aktywnej postaci</div>
            </div>
        );
    }

    const elapsedSeconds = startedAt ? Math.max(0, Math.floor((nowTick - new Date(startedAt).getTime()) / 1000)) : 0;
    const cappedSeconds = Math.min(elapsedSeconds, OFFLINE_HUNT_MAX_SECONDS);
    const progressPct = Math.min(100, (cappedSeconds / OFFLINE_HUNT_MAX_SECONDS) * 100);
    const isCapReached = elapsedSeconds >= OFFLINE_HUNT_MAX_SECONDS;

    return (
        <div className="oh">
            {/* Header */}
            <header className="oh__header page-header">
                <button className="oh__back page-back-btn" onClick={() => navigate('/')}>← Miasto</button>
                <h1 className="oh__title page-title">🎯 Offline Hunt</h1>
            </header>

            {/* Epic claim FX overlay */}
            <AnimatePresence>
                {claimFxActive && (
                    <motion.div
                        className="oh__fx"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.25 }}
                    >
                        <motion.div
                            className="oh__fx-burst"
                            initial={{ scale: 0, rotate: -45 }}
                            animate={{ scale: [0, 1.3, 1], rotate: [-45, 8, 0] }}
                            transition={{ duration: 0.9, ease: 'backOut' }}
                        >
                            <motion.div
                                className="oh__fx-halo"
                                animate={{ rotate: 360 }}
                                transition={{ duration: 2.4, repeat: Infinity, ease: 'linear' }}
                            />
                            <motion.div
                                className="oh__fx-trophy"
                                animate={{ y: [0, -10, 0], scale: [1, 1.08, 1] }}
                                transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
                            >
                                🏆
                            </motion.div>
                            <div className="oh__fx-text">NAGRODA!</div>
                        </motion.div>
                        {Array.from({ length: 14 }).map((_, i) => {
                            const angle = (i / 14) * Math.PI * 2;
                            const dist = 200;
                            return (
                                <motion.span
                                    key={i}
                                    className="oh__fx-star"
                                    initial={{ x: 0, y: 0, opacity: 1, scale: 0.4 }}
                                    animate={{ x: Math.cos(angle) * dist, y: Math.sin(angle) * dist, opacity: 0, scale: 1.2, rotate: 360 }}
                                    transition={{ duration: 1.2, ease: 'easeOut' }}
                                >
                                    {i % 3 === 0 ? '⭐' : i % 3 === 1 ? '✨' : '💫'}
                                </motion.span>
                            );
                        })}
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Reward modal */}
            <AnimatePresence>
                {claimResult && <RewardModal result={claimResult} onClose={handleDismissResult} />}
            </AnimatePresence>

            {/* ── Active hunt card ────────────────────────────────────── */}
            {isActive && targetMonster && trainedSkillId && (
                <div className="oh__active">
                    <div className="oh__active-top">
                        <span className="oh__active-dot" />
                        <span className="oh__active-label">Polowanie aktywne</span>
                        {isCapReached && <span className="oh__active-cap">⚠️ 12h cap</span>}
                    </div>

                    <div className="oh__target-card">
                        <span className="oh__target-sprite">{targetMonster.sprite}</span>
                        <div className="oh__target-info">
                            <div className="oh__target-name">{targetMonster.name_pl} <span className="oh__target-lvl">Lvl {targetMonster.level}</span></div>
                            <div className="oh__target-meta">
                                <span>🎓 {SKILL_NAMES_PL[trainedSkillId] ?? trainedSkillId}</span>
                                <span>⚡ x{livePreview?.speedMultiplier ?? 1} ({(OFFLINE_HUNT_BASE_SECONDS_PER_KILL / (livePreview?.speedMultiplier ?? 1)).toFixed(1)}s/kill)</span>
                            </div>
                        </div>
                    </div>

                    <div className="oh__progress">
                        <div className="oh__progress-track">
                            <div className="oh__progress-fill" style={{ width: `${progressPct}%` }} />
                        </div>
                        <span className="oh__progress-text">{formatDuration(cappedSeconds)} / 12h</span>
                    </div>

                    {livePreview && (
                        <div className="oh__live-stats">
                            <div className="oh__live-stat"><span>👾 Zabite</span><strong>{livePreview.kills.toLocaleString('pl-PL')}</strong></div>
                            <div className="oh__live-stat"><span>⭐ XP</span><strong>+{livePreview.xpGained.toLocaleString('pl-PL')}</strong></div>
                            <div className="oh__live-stat"><span>💰 Gold</span><strong>+{livePreview.goldGained.toLocaleString('pl-PL')}</strong></div>
                            <div className="oh__live-stat"><span>✨ Skill</span><strong>+{livePreview.skillXpGained.toLocaleString('pl-PL')}</strong></div>
                        </div>
                    )}

                    <div className="oh__active-btns">
                        <button className="oh__btn oh__btn--claim" onClick={handleClaim}>🏆 Odbierz nagrody</button>
                        <button className="oh__btn oh__btn--cancel" onClick={handleCancel}>✕ Anuluj</button>
                    </div>
                </div>
            )}

            {/* ── Setup (when no active hunt) ────────────────────────── */}
            {!isActive && (
                <div className="oh__setup">
                    {/* Step 1: Skill */}
                    <div className="oh__card">
                        <h2 className="oh__card-title">
                            <span className="oh__card-step">1</span>
                            Wybierz trenowany skill
                        </h2>
                        <div className="oh__skill-grid">
                            {trainableSkills.map((s) => (
                                <button
                                    key={s.id}
                                    className={`oh__skill-chip${pickedSkillId === s.id ? ' oh__skill-chip--active' : ''}`}
                                    onClick={() => setPickedSkillId(s.id)}
                                >
                                    <span className="oh__skill-chip-name">{s.name}</span>
                                    <span className="oh__skill-chip-lvl">Lvl {s.level}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Step 2: Monster */}
                    <div className="oh__card">
                        <h2 className="oh__card-title">
                            <span className="oh__card-step">2</span>
                            Wybierz potwora
                        </h2>
                        <div className="oh__monster-list">
                            {unlockedMonsters.map(({ monster, masteryLevel }) => {
                                const mult = getOfflineHuntSpeedMultiplier(masteryLevel);
                                const isPicked = pickedMonsterId === monster.id;
                                return (
                                    <button
                                        key={monster.id}
                                        className={`oh__monster-row${isPicked ? ' oh__monster-row--active' : ''}`}
                                        onClick={() => setPickedMonsterId(monster.id)}
                                    >
                                        <span className="oh__monster-row-sprite">{monster.sprite}</span>
                                        <div className="oh__monster-row-info">
                                            <span className="oh__monster-row-name">{monster.name_pl}</span>
                                            <span className="oh__monster-row-lvl">Lvl {monster.level}</span>
                                        </div>
                                        <span className={`oh__monster-row-speed oh__monster-row-speed--x${mult}`}>x{mult}</span>
                                        {masteryLevel > 0 && (
                                            <span className="oh__monster-row-mastery">⭐{masteryLevel}</span>
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* Info box */}
                    <div className="oh__info">
                        Zabija 1 potwora co 10s (szybciej z Mastery). Max 12h. Plecak pełny? Najsłabsze przedmioty zostaną automatycznie sprzedane.
                    </div>

                    <button
                        className="oh__btn oh__btn--start"
                        onClick={handleStart}
                        disabled={!pickedSkillId || !pickedMonsterId}
                    >
                        🎯 Rozpocznij polowanie
                    </button>
                </div>
            )}
        </div>
    );
};

export default OfflineHunt;
