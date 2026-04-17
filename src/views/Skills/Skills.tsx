import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import skillsData from '../../data/skills.json';
import { useCharacterStore } from '../../stores/characterStore';
import { useSkillStore } from '../../stores/skillStore';
import { useInventoryStore } from '../../stores/inventoryStore';
import { getClassWeaponSkills, skillXpProgress, skillXpToNextLevel, getTrainableStatsForClass, GENERAL_TRAINABLE_STATS, SKILL_NAMES_PL, getSkillUpgradeBonus, getSpellChestUnlockCost, getSpellChestUpgradeCost } from '../../systems/skillSystem';
import { getSpellChestIcon } from '../../systems/lootSystem';
import { getSkillIcon } from '../../data/skillIcons';
import { getCharacterAvatar } from '../../data/classAvatars';
import { useTransformStore } from '../../stores/transformStore';
import { useOfflineHuntStore } from '../../stores/offlineHuntStore';
import './Skills.scss';

const CLASS_ICONS: Record<string, string> = {
  Knight: '⚔️', Mage: '🔮', Cleric: '✨', Archer: '🏹',
  Rogue: '🗡️', Necromancer: '💀', Bard: '🎵',
};

const CLASS_COLORS: Record<string, string> = {
  Knight: '#e53935', Mage: '#7b1fa2', Cleric: '#ffc107', Archer: '#4caf50',
  Rogue: '#424242', Necromancer: '#795548', Bard: '#ff9800',
};

// ── Types ─────────────────────────────────────────────────────────────────────

interface IWeaponSkill {
  id: string;
  name_pl: string;
  name_en: string;
  description_pl: string;
  damageBonus: number;
  maxLevel?: number;
}

interface IActiveSkill {
  id: string;
  name_pl: string;
  mpCost: number;
  cooldown: number;
  damage: number;
  effect: string | null;
  unlockLevel: number;
  goldCost: number;
}

type Tab = 'weapon' | 'active' | 'offline';

const SLOT_LABELS = ['Slot I', 'Slot II', 'Slot III', 'Slot IV'];

// Bonus description per stat level
const STAT_BONUS_DESC: Record<string, (level: number) => string> = {
  sword_fighting:    (l) => `+${(l * 5).toFixed(0)}% DMG`,
  dagger_fighting:   (l) => `+${(l * 5).toFixed(0)}% DMG`,
  distance_fighting: (l) => `+${(l * 5).toFixed(0)}% DMG`,
  bard_level:        (l) => `+${(l * 5).toFixed(0)}% DMG`,
  magic_level:       (l) => `+${l} MLvl`,
  attack_speed:      (l) => `+${(l * 0.1).toFixed(1)} AS`,
  max_hp:            (l) => `+${l * 5} max HP`,
  max_mp:            (l) => `+${l * 5} max MP`,
  hp_regen:          (l) => `+${(l * 0.1).toFixed(1)} HP/s`,
  mp_regen:          (l) => `+${(l * 0.1).toFixed(1)} MP/s`,
  defense:           (l) => `+${l} DEF`,
  crit_chance:       (l) => `+${(l * 0.5).toFixed(1)}% Crit`,
};

const formatCooldown = (ms: number): string => `${(ms / 1000).toFixed(1)}s`;

// ── Skill effect translator ──────────────────────────────────────────────────
// Effect strings in skills.json are codes like "burn_chance_0.3" or "stun_2s".
// This decodes them into Polish gameplay text.
const describeSkillEffect = (effect: string | null): string | null => {
    if (!effect) return null;
    const e = effect.toLowerCase();
    const num = (s: string): number => {
        const m = s.match(/[-+]?\d*\.?\d+/);
        return m ? parseFloat(m[0]) : 0;
    };
    // Stun
    if (e.startsWith('stun_chance_')) return `Szansa ${(num(e) * 100).toFixed(0)}% na ogłuszenie`;
    if (e.startsWith('stun_')) return `Ogłusza wroga na ${num(e)}s`;
    // Burn / DOT
    if (e.startsWith('burn_chance_')) return `Szansa ${(num(e) * 100).toFixed(0)}% na podpalenie (DOT)`;
    if (e.startsWith('bleed_dot_')) return `Krwawienie przez ${num(e)}s (DOT)`;
    if (e.startsWith('poison_dot_')) return `Trucizna przez ${num(e)}s (DOT)`;
    if (e === 'holy_ground_dot') return `Tworzy świętą ziemię raniącą wrogów`;
    // Buffs (timed)
    if (e.startsWith('attack_up_')) {
        const parts = e.replace('attack_up_', '').split('_');
        return `+${(parseFloat(parts[0]) * 100).toFixed(0)}% ATK przez ${parseFloat(parts[1])}s`;
    }
    if (e.startsWith('defense_up_')) {
        const parts = e.replace('defense_up_', '').split('_');
        return `+${(parseFloat(parts[0]) * 100).toFixed(0)}% DEF przez ${parseFloat(parts[1])}s`;
    }
    if (e.startsWith('attack_speed_up_')) {
        const parts = e.replace('attack_speed_up_', '').split('_');
        return `+${(parseFloat(parts[0]) * 100).toFixed(0)}% AS przez ${parseFloat(parts[1])}s`;
    }
    if (e.startsWith('crit_chance_up_')) {
        const parts = e.replace('crit_chance_up_', '').split('_');
        return `+${(parseFloat(parts[0]) * 100).toFixed(0)}% szansy na crit przez ${parseFloat(parts[1])}s`;
    }
    if (e.startsWith('block_') && e.endsWith('s')) {
        const parts = e.replace('block_', '').split('_');
        return `+${(parseFloat(parts[0]) * 100).toFixed(0)}% bloku przez ${parseFloat(parts[1])}s`;
    }
    if (e.startsWith('party_attack_up_')) {
        const parts = e.replace('party_attack_up_', '').split('_');
        return `+${(parseFloat(parts[0]) * 100).toFixed(0)}% ATK dla całej drużyny przez ${parseFloat(parts[1])}s`;
    }
    if (e === 'party_hp_regen_5s') return `Regeneracja HP drużyny przez 5s`;
    // Heals
    if (e.startsWith('heal_') && e.includes('maxhp')) {
        const v = num(e);
        return `Leczy ${(v * 100).toFixed(0)}% maks. HP`;
    }
    if (e === 'full_heal_self') return `Pełne leczenie własne`;
    if (e === 'full_heal_party') return `Pełne leczenie całej drużyny`;
    // Crit / damage modifiers
    if (e === 'crit_guaranteed') return `Gwarantowany cios krytyczny`;
    if (e.startsWith('crit_x')) return `Mnożnik crit ×${num(e)}`;
    if (e === 'bonus_dmg_low_hp') return `Dodatkowe obrażenia gdy wróg ma mało HP`;
    if (e === 'ignore_defense' || e === 'armor_ignore') return `Ignoruje obronę wroga`;
    if (e.startsWith('armor_break_')) return `Łamie pancerz wroga (-${(num(e) * 100).toFixed(0)}% DEF)`;
    if (e.startsWith('magic_pen_')) return `Penetracja magii ${(num(e) * 100).toFixed(0)}%`;
    // Mana / drain
    if (e.startsWith('mana_drain_')) return `Wysysa ${(num(e) * 100).toFixed(0)}% obrażeń jako manę`;
    if (e === 'absorb_damage_50') return `Absorbuje 50% obrażeń kosztem MP`;
    // AOE / multi
    if (e === 'magic_dmg_aoe' || e === 'big_bang_impact' || e === 'universe_dmg') return `Obrażenia obszarowe (AOE)`;
    if (e === 'slow_2s_aoe') return `Spowolnienie obszarowe na 2s`;
    if (e === 'triple_shot') return `Strzela 3 razy w jednej akcji`;
    // Special elements
    if (e === 'undead_bonus_x2') return `×2 obrażeń na nieumarłych`;
    if (e === 'holy_x3_undead') return `×3 obrażeń na nieumarłych`;
    if (e === 'holy_dmg' || e === 'holy_dmg_bonus') return `Bonus obrażeń świętych`;
    if (e === 'all_elements_dmg') return `Obrażenia wszystkich żywiołów`;
    if (e === 'gravity_pull') return `Wciąga wroga (kontrola)`;
    if (e === 'divine_burn') return `Boskie spalenie (DOT)`;
    if (e === 'divine_crit') return `Gwarantowany boski crit`;
    if (e === 'fate_dmg') return `Obrażenia oparte na losie (zmienne)`;
    if (e === 'void_pierce') return `Przebicie pustki – ignoruje DEF`;
    if (e === 'knockback') return `Odrzuca wroga`;
    if (e === 'evasion_5s') return `Uniki 100% przez 5s`;
    // Slow / immobilize
    if (e.startsWith('slow_chance_')) return `Szansa ${(num(e) * 100).toFixed(0)}% na spowolnienie`;
    if (e.startsWith('immobilize_')) return `Unieruchamia wroga na ${num(e)}s`;
    // Instant kill
    if (e.startsWith('instant_kill_chance_')) return `Szansa ${(num(e) * 100).toFixed(0)}% na natychmiastowe zabicie`;
    if (e === 'instant_undead_kill') return `Natychmiastowe zabicie nieumarłych`;
    // Resurrection / armor destroy
    if (e.startsWith('revive_chance_')) return `Szansa ${(num(e) * 100).toFixed(0)}% na wskrzeszenie`;
    if (e === 'block_next_hit') return `Blokuje następny cios`;
    if (e === 'holy_armor_destroy') return `Niszczy pancerz świętym ogniem`;
    if (e === 'divine_smite_all') return `Boska kara na wszystkich wrogów`;
    // Fallback: humanize the raw code
    return effect.replace(/_/g, ' ');
};

const formatGold = (amount: number): string => {
  if (amount >= 1_000_000_000) return `${(amount / 1_000_000_000).toFixed(1)}B`;
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `${(amount / 1_000).toFixed(1)}K`;
  return `${amount}`;
};

interface IUpgradeResultMsg {
  skillId: string;
  success: boolean;
  goldSpent: number;
  newLevel: number;
}

type UpgradePhase = 'idle' | 'progress' | 'resolving' | 'success' | 'failure';

interface IUpgradeModalState {
  skillId: string;
  skillName: string;
  skillUnlockLevel: number;
  currentLevel: number;
  targetLevel: number;
  successRate: number;
  goldCost: number;
  chestCost: number;
  chestLevel: number;
  currentBonus: number;
  nextBonus: number;
  phase: UpgradePhase;
  result: IUpgradeResultMsg | null;
}

const PROGRESS_DURATION_MS = 1500;
const RESULT_DISPLAY_MS = 1800;

// ── Sparkle particles for success ────────────────────────────────────────────

const UpgradeParticles = ({ type }: { type: 'success' | 'failure' }) => {
  const particles = Array.from({ length: type === 'success' ? 12 : 6 }, (_, i) => i);
  return (
    <div className="upgrade-particles">
      {particles.map((i) => (
        <span
          key={i}
          className={`upgrade-particles__particle upgrade-particles__particle--${type}`}
          style={{
            '--angle': `${(360 / particles.length) * i}deg`,
            '--delay': `${i * 0.05}s`,
          } as React.CSSProperties}
        >
          {type === 'success' ? '✨' : '💔'}
        </span>
      ))}
    </div>
  );
};

// ── Component ─────────────────────────────────────────────────────────────────

const Skills = () => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<Tab>('weapon');
  const [upgradeModal, setUpgradeModal] = useState<IUpgradeModalState | null>(null);
  const upgradeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [unlockConfirm, setUnlockConfirm] = useState<{ skillId: string; skillName: string; goldCost: number; chestLevel: number; chestCount: number } | null>(null);
  const [unlockResultMsg, setUnlockResultMsg] = useState<{ skillId: string; success: boolean } | null>(null);

  const character = useCharacterStore((s) => s.character);
  const completedTransforms = useTransformStore((s) => s.completedTransforms);
  const getHighestTransformColor = useTransformStore((s) => s.getHighestTransformColor);
  const playerAvatarSrc = character ? getCharacterAvatar(character.class, completedTransforms) : '';

  // Once a transform tier is completed, recolor the training panel accent from
  // the class color to the transform color so the whole view feels transformed.
  const transformColor = getHighestTransformColor();
  const classFallback = character ? (CLASS_COLORS[character.class] ?? '#e94560') : '#e94560';
  const accentColor = (() => {
    if (!transformColor) return classFallback;
    if (transformColor.solid) return transformColor.solid;
    if (transformColor.gradient) return transformColor.gradient[0];
    return classFallback;
  })();
  const gold = useInventoryStore((s) => s.gold);
  const spendGold = useInventoryStore((s) => s.spendGold);
  const useSpellChests = useInventoryStore((s) => s.useSpellChests);
  const getSpellChestCount = useInventoryStore((s) => s.getSpellChestCount);
  const {
    skillLevels,
    skillXp,
    activeSkillSlots,
    skillUpgradeLevels,
    unlockedSkills,
    offlineTrainingSkillId,
    trainingSegmentStartedAt,
    trainingAccumulatedEffectiveSeconds,
    trainingCurrentSpeedMultiplier,
    initSkills,
    setActiveSkillSlot,
    selectTrainingStat,
    upgradeActiveSkill,
    unlockSkill,
  } = useSkillStore();

  // Init skills when character is known
  useEffect(() => {
    if (character?.class) initSkills(character.class);
  }, [character?.class, initSkills]);

  if (!character) {
    return <div className="skills"><p className="skills__loading">Ładowanie...</p></div>;
  }

  const charClass = character.class.toLowerCase() as keyof typeof skillsData.activeSkills;
  const weaponSkillIds = getClassWeaponSkills(character.class);
  const allWeaponSkills = skillsData.weaponSkills as IWeaponSkill[];
  const myWeaponSkills = allWeaponSkills.filter((s) => weaponSkillIds.includes(s.id));
  const myActiveSkills = (skillsData.activeSkills[charClass] ?? []) as IActiveSkill[];

  // ── Always-on training helpers ─────────────────────────────────────────────
  // Hunt and training are mutually exclusive. When hunt is active, training
  // is forcibly paused (segmentStartedAt=null) so it cannot accrue XP.
  const huntIsActive = useOfflineHuntStore((s) => s.isActive);
  const isTrainingActive = !!offlineTrainingSkillId && !!trainingSegmentStartedAt;
  const isTrainingPausedByHunt = !!offlineTrainingSkillId && huntIsActive && !trainingSegmentStartedAt;
  const isActiveSpeed = trainingCurrentSpeedMultiplier === 2;

  // Total effective seconds (accumulated + current segment × speed multiplier)
  const totalEffectiveSeconds = (() => {
    let total = trainingAccumulatedEffectiveSeconds;
    if (isTrainingActive && trainingSegmentStartedAt) {
      const segmentSecs = Math.max(0, (Date.now() - new Date(trainingSegmentStartedAt).getTime()) / 1000);
      total += segmentSecs * trainingCurrentSpeedMultiplier;
    }
    return Math.floor(total);
  })();

  const formatElapsed = (secs: number): string => {
    if (secs < 60) return `${secs}s`;
    if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`;
    return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
  };

  // ── Active skill slot toggle ───────────────────────────────────────────────
  const handleToggleActiveSkill = (skillId: string) => {
    // Must be unlocked to equip
    if (!unlockedSkills[skillId]) return;
    const slotIndex = activeSkillSlots.indexOf(skillId);
    if (slotIndex !== -1) {
      setActiveSkillSlot(slotIndex as 0 | 1 | 2 | 3, null);
      return;
    }
    const emptySlot = activeSkillSlots.indexOf(null);
    if (emptySlot !== -1) {
      setActiveSkillSlot(emptySlot as 0 | 1 | 2 | 3, skillId);
    }
  };

  // ── Unlock (purchase) skill handler ────────────────────────────────────────
  const handleUnlockSkill = (skillId: string, skillName: string, unlockLevel: number) => {
    const cost = getSpellChestUnlockCost(unlockLevel);
    setUnlockConfirm({ skillId, skillName, goldCost: cost.gold, chestLevel: cost.chestLevel, chestCount: cost.chests });
  };

  const confirmUnlock = () => {
    if (!unlockConfirm) return;
    const success = unlockSkill(unlockConfirm.skillId, unlockConfirm.goldCost, spendGold, unlockConfirm.chestLevel, useSpellChests);
    setUnlockResultMsg({ skillId: unlockConfirm.skillId, success });
    setUnlockConfirm(null);
    setTimeout(() => setUnlockResultMsg(null), 3000);
  };

  // ── Upgrade modal flow ─────────────────────────────────────────────────────
  const openUpgradeModal = useCallback((skillId: string, skillName: string, unlockLevel: number) => {
    const currentLevel = skillUpgradeLevels[skillId] ?? 0;
    const targetLevel = currentLevel + 1;
    const costInfo = getSpellChestUpgradeCost(targetLevel, unlockLevel);
    setUpgradeModal({
      skillId,
      skillName,
      skillUnlockLevel: unlockLevel,
      currentLevel,
      targetLevel,
      successRate: costInfo.successRate,
      goldCost: costInfo.gold,
      chestCost: costInfo.chests,
      chestLevel: costInfo.chestLevel,
      currentBonus: getSkillUpgradeBonus(currentLevel),
      nextBonus: getSkillUpgradeBonus(targetLevel),
      phase: 'idle',
      result: null,
    });
  }, [skillUpgradeLevels]);

  const closeUpgradeModal = useCallback(() => {
    if (upgradeTimerRef.current) {
      clearTimeout(upgradeTimerRef.current);
      upgradeTimerRef.current = null;
    }
    setUpgradeModal(null);
  }, []);

  const startUpgradeAnimation = useCallback(() => {
    if (!upgradeModal || upgradeModal.phase !== 'idle') return;
    const { skillId, goldCost, chestCost, chestLevel, skillUnlockLevel } = upgradeModal;
    if (gold < goldCost) return;
    if (chestCost > 0 && getSpellChestCount(chestLevel) < chestCost) return;

    // Phase 1: progress bar filling
    setUpgradeModal((prev) => prev ? { ...prev, phase: 'progress' } : null);

    // Phase 2: resolve after progress bar fills
    upgradeTimerRef.current = setTimeout(() => {
      setUpgradeModal((prev) => prev ? { ...prev, phase: 'resolving' } : null);

      const result = upgradeActiveSkill(skillId, gold, spendGold, skillUnlockLevel, useSpellChests, getSpellChestCount);
      const resultMsg: IUpgradeResultMsg = {
        skillId,
        success: result.success,
        goldSpent: result.goldSpent,
        newLevel: result.newLevel,
      };

      // Phase 3: show success or failure
      upgradeTimerRef.current = setTimeout(() => {
        setUpgradeModal((prev) => prev ? {
          ...prev,
          phase: result.success ? 'success' : 'failure',
          result: resultMsg,
        } : null);

        // Phase 4: reset modal to idle after result display
        upgradeTimerRef.current = setTimeout(() => {
          const newCurrentLevel = result.success ? result.newLevel : (upgradeModal.currentLevel);
          const newTargetLevel = newCurrentLevel + 1;
          const newCostInfo = getSpellChestUpgradeCost(newTargetLevel, skillUnlockLevel);
          setUpgradeModal((prev) => prev ? {
            ...prev,
            phase: 'idle',
            result: resultMsg,
            currentLevel: newCurrentLevel,
            targetLevel: newTargetLevel,
            successRate: newCostInfo.successRate,
            goldCost: newCostInfo.gold,
            chestCost: newCostInfo.chests,
            chestLevel: newCostInfo.chestLevel,
            currentBonus: getSkillUpgradeBonus(newCurrentLevel),
            nextBonus: getSkillUpgradeBonus(newTargetLevel),
          } : null);
        }, RESULT_DISPLAY_MS);
      }, 200);
    }, PROGRESS_DURATION_MS);
  }, [upgradeModal, gold, upgradeActiveSkill, spendGold, useSpellChests, getSpellChestCount]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (upgradeTimerRef.current) clearTimeout(upgradeTimerRef.current);
    };
  }, []);

  const isModalBusy = upgradeModal !== null && upgradeModal.phase !== 'idle';
  const canAffordModal = upgradeModal !== null && gold >= upgradeModal.goldCost && (upgradeModal.chestCost === 0 || getSpellChestCount(upgradeModal.chestLevel) >= upgradeModal.chestCost);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="skills">
      <header className="skills__header">
        <button className="skills__back" onClick={() => navigate('/')}>← Miasto</button>
        <h1 className="skills__title">Skille</h1>
        <span className="skills__class">{CLASS_ICONS[character.class] ?? '?'}</span>
      </header>

      {/* Tabs */}
      <nav className="skills__tabs">
        {(['weapon', 'active', 'offline'] as Tab[]).map((tab) => (
          <button
            key={tab}
            className={`skills__tab${activeTab === tab ? ' skills__tab--active' : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab === 'weapon' && '⚔️ Walka'}
            {tab === 'active' && '✨ Aktywne'}
            {tab === 'offline' && '🎓 Trening'}
          </button>
        ))}
      </nav>

      <AnimatePresence mode="wait">
        {/* ── Weapon / Magic Skills Tab ─────────────────────────────────── */}
        {activeTab === 'weapon' && (
          <motion.div
            key="weapon"
            className="skills__panel"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
          >
            {/* Class weapon/magic skills with full info */}
            {myWeaponSkills.map((skill) => {
              const level = skillLevels[skill.id] ?? 0;
              const xp = skillXp[skill.id] ?? 0;
              const progress = skillXpProgress(xp, level);
              const needed = skillXpToNextLevel(level);
              const bonusPct = (level * skill.damageBonus * 100).toFixed(0);

              return (
                <div key={skill.id} className="skills__weapon-card">
                  <div className="skills__weapon-header">
                    <span className="skills__weapon-name">{skill.name_pl}</span>
                    <span className="skills__weapon-level">Lvl {level}</span>
                  </div>
                  <div className="skills__weapon-desc">{skill.description_pl}</div>
                  <div className="skills__xp-bar-wrap">
                    <div
                      className="skills__xp-bar"
                      style={{ width: `${progress * 100}%` }}
                    />
                  </div>
                  <div className="skills__xp-label">
                    <span>{xp} / {needed} XP</span>
                    <span className="skills__bonus">+{bonusPct}% DMG</span>
                  </div>
                </div>
              );
            })}

            {/* General trainable stats (available to all classes) */}
            <div className="skills__section-title">Statystyki treningowe</div>
            {GENERAL_TRAINABLE_STATS.map((statId) => {
              const level = skillLevels[statId] ?? 0;
              const xp = skillXp[statId] ?? 0;
              const progress = skillXpProgress(xp, level);
              const needed = skillXpToNextLevel(level);
              const label = SKILL_NAMES_PL[statId] ?? statId;
              const bonus = STAT_BONUS_DESC[statId]?.(level) ?? '';

              return (
                <div key={statId} className="skills__weapon-card">
                  <div className="skills__weapon-header">
                    <span className="skills__weapon-name">{label}</span>
                    <span className="skills__weapon-level">Lvl {level}</span>
                  </div>
                  <div className="skills__xp-bar-wrap">
                    <div
                      className="skills__xp-bar"
                      style={{ width: `${progress * 100}%` }}
                    />
                  </div>
                  <div className="skills__xp-label">
                    <span>{xp} / {needed} XP</span>
                    {bonus && <span className="skills__bonus">{bonus}</span>}
                  </div>
                </div>
              );
            })}
          </motion.div>
        )}

        {/* ── Active Skills Tab ─────────────────────────────────────────── */}
        {activeTab === 'active' && (
          <motion.div
            key="active"
            className="skills__panel"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
          >
            {/* Active slots overview */}
            <div className="skills__slots">
              {activeSkillSlots.map((slotId, i) => {
                const skill = myActiveSkills.find((s) => s.id === slotId);
                return (
                  <div key={i} className={`skills__slot${skill ? ' skills__slot--filled' : ''}`}>
                    <span className="skills__slot-label">{SLOT_LABELS[i]}</span>
                    {skill ? (
                      <span className="skills__slot-skill">{getSkillIcon(skill.id)} {skill.name_pl}</span>
                    ) : (
                      <span className="skills__slot-empty">–</span>
                    )}
                  </div>
                );
              })}
            </div>

            <p className="skills__slots-hint">
              Maksymalnie 4 aktywne skille jednocześnie. Kliknij skill poniżej, aby przypisać/usunąć.
            </p>

            {/* All class skills */}
            <div className="skills__active-list">
              {myActiveSkills.map((skill) => {
                const isEquipped = activeSkillSlots.includes(skill.id);
                const isLevelLocked = character.level < skill.unlockLevel;
                const isPurchased = unlockedSkills[skill.id] === true;
                const needsPurchase = !isLevelLocked && !isPurchased;
                const isLocked = isLevelLocked || needsPurchase;
                const slotsUsed = activeSkillSlots.filter(Boolean).length;
                const canAdd = !isEquipped && slotsUsed < 4 && !isLocked;
                const upgradeLevel = skillUpgradeLevels[skill.id] ?? 0;
                const currentBonus = getSkillUpgradeBonus(upgradeLevel);
                const chestUnlockCost = getSpellChestUnlockCost(skill.unlockLevel);
                const playerChestCount = getSpellChestCount(chestUnlockCost.chestLevel);
                const canAffordUnlock = gold >= chestUnlockCost.gold && playerChestCount >= chestUnlockCost.chests;
                const showUnlockResult = unlockResultMsg?.skillId === skill.id;

                return (
                  <div
                    key={skill.id}
                    className={[
                      'skills__active-card',
                      isEquipped ? 'skills__active-card--equipped' : '',
                      isLevelLocked ? 'skills__active-card--locked' : '',
                      needsPurchase ? 'skills__active-card--needs-purchase' : '',
                    ].join(' ')}
                  >
                    <div
                      className="skills__active-top"
                      onClick={() => !isLocked && handleToggleActiveSkill(skill.id)}
                    >
                      <span className="skills__active-name">{getSkillIcon(skill.id)} {skill.name_pl}</span>
                      {upgradeLevel > 0 && (
                        <span className="skills__upgrade-badge">+{upgradeLevel}</span>
                      )}
                      {isLevelLocked && (
                        <span className="skills__active-lock">🔒 Lvl {skill.unlockLevel}</span>
                      )}
                      {needsPurchase && (
                        <span className="skills__active-lock">{getSpellChestIcon(chestUnlockCost.chestLevel)} x{chestUnlockCost.chests} + 💰 {formatGold(chestUnlockCost.gold)}</span>
                      )}
                      {isEquipped && (
                        <span className="skills__active-badge">Aktywny</span>
                      )}
                      {canAdd && (
                        <span className="skills__active-add">+ Dodaj</span>
                      )}
                    </div>
                    <div className="skills__active-stats">
                      <span>MP: {skill.mpCost}</span>
                      <span>CD: {formatCooldown(skill.cooldown)}</span>
                      {skill.damage > 0 && (
                        <span>
                          DMG: ×{(skill.damage * (1 + currentBonus)).toFixed(2)}
                          {upgradeLevel > 0 && (
                            <span className="skills__active-bonus"> (+{(currentBonus * 100).toFixed(0)}%)</span>
                          )}
                        </span>
                      )}
                    </div>
                    <div className="skills__active-description">
                      {skill.damage > 0 ? (
                        <div className="skills__active-desc-line">
                          ⚔️ Zadaje obrażenia równe <strong>{(skill.damage * (1 + currentBonus)).toFixed(2)}× ataku</strong>
                          {character && (
                            <> {' '}(~{Math.max(1, Math.floor((character.attack ?? 0) * skill.damage * (1 + currentBonus)))} dmg)</>
                          )}
                        </div>
                      ) : (
                        <div className="skills__active-desc-line">✨ Skill wsparcia – nie zadaje bezpośrednich obrażeń</div>
                      )}
                      {describeSkillEffect(skill.effect) && (
                        <div className="skills__active-desc-line">🎯 {describeSkillEffect(skill.effect)}</div>
                      )}
                    </div>

                    {/* Unlock (purchase) button for skills that meet level but are not purchased */}
                    {needsPurchase && (
                      <div className="skills__unlock-row">
                        <button
                          className={`skills__unlock-btn${!canAffordUnlock ? ' skills__unlock-btn--disabled' : ''}`}
                          disabled={!canAffordUnlock}
                          onClick={(e) => { e.stopPropagation(); handleUnlockSkill(skill.id, skill.name_pl, skill.unlockLevel); }}
                        >
                          {canAffordUnlock
                            ? `Odblokuj: ${getSpellChestIcon(chestUnlockCost.chestLevel)} x${chestUnlockCost.chests} + ${formatGold(chestUnlockCost.gold)} gold`
                            : `Brak: ${getSpellChestIcon(chestUnlockCost.chestLevel)} ${playerChestCount}/${chestUnlockCost.chests} · ${formatGold(chestUnlockCost.gold)} gold`}
                        </button>
                      </div>
                    )}

                    {/* Unlock result message */}
                    {showUnlockResult && (
                      <div className={`skills__unlock-result${unlockResultMsg.success ? ' skills__unlock-result--success' : ' skills__unlock-result--fail'}`}>
                        {unlockResultMsg.success
                          ? `Skill odblokowany!`
                          : `Brak wystarczajacego zlota!`}
                      </div>
                    )}

                    {/* Upgrade button - opens modal (only for purchased skills) */}
                    {!isLocked && isPurchased && (
                      <div className="skills__upgrade-row">
                        <button
                          className="skills__upgrade-btn"
                          onClick={(e) => { e.stopPropagation(); openUpgradeModal(skill.id, skill.name_pl, skill.unlockLevel); }}
                        >
                          Ulepsz
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}

        {/* ── Offline Training Tab ─────────────────────────────────────── */}
        {activeTab === 'offline' && (
          <motion.div
            key="offline"
            className="skills__panel"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
          >
            {/* Character avatar card */}
            <div
              className="skills__training-avatar"
              style={{ '--class-color': accentColor } as React.CSSProperties}
            >
              <img
                src={playerAvatarSrc}
                alt={character.class}
                className="skills__training-avatar-img"
              />
              <div className="skills__training-avatar-info">
                <span className="skills__training-avatar-name">{character.name}</span>
                <span className="skills__training-avatar-meta">
                  {CLASS_ICONS[character.class] ?? '?'} {character.class} · Lvl {character.level}
                </span>
              </div>
            </div>

            {/* Hunt-active warning banner (always visible during hunt) */}
            {huntIsActive && (
              <div className="skills__offline-session skills__offline-session--paused">
                <div className="skills__offline-session-label">
                  ⏸ TRENING ZABLOKOWANY
                </div>
                <div className="skills__offline-session-skill">
                  Trwa polowanie offline
                </div>
                <div className="skills__offline-session-note">
                  Aktywny trening jest niemożliwy podczas polowania offline. Cały nabity XP został zapisany do skilla, a licznik został wyzerowany. Zakończ polowanie żeby wznowić trening.
                </div>
              </div>
            )}

            {/* Current training status (only when no hunt) */}
            {offlineTrainingSkillId && !huntIsActive && (
              <div className="skills__offline-session">
                <div className="skills__offline-session-label">
                  {`TRENING: ${isActiveSpeed ? 'AKTYWNY (2X)' : 'W TLE (1X)'}`}
                </div>
                <div className="skills__offline-session-skill">
                  {SKILL_NAMES_PL[offlineTrainingSkillId] ?? myWeaponSkills.find((s) => s.id === offlineTrainingSkillId)?.name_pl ?? offlineTrainingSkillId}
                </div>
                <div className="skills__offline-session-time">
                  Czas efektywny: {formatElapsed(totalEffectiveSeconds)}
                </div>
              </div>
            )}

            {/* Skill picker */}
            <p className="skills__offline-hint">
              Wybierz statystykę do trenowania. Trening działa ZAWSZE — 2x szybciej gdy grasz aktywnie, 1x w tle. XP z treningu zobaczysz po powrocie z 10+ min nieaktywności.
            </p>
            <div className={`skills__offline-list${huntIsActive ? ' skills__offline-list--locked' : ''}`}>
              {getTrainableStatsForClass(character.class).map((statId) => {
                const level = skillLevels[statId] ?? 0;
                const xp = skillXp[statId] ?? 0;
                const progress = skillXpProgress(xp, level);
                const needed = skillXpToNextLevel(level);
                const isActive = offlineTrainingSkillId === statId;
                const label = SKILL_NAMES_PL[statId] ?? statId;
                const cardLocked = huntIsActive;

                return (
                  <div
                    key={statId}
                    className={`skills__offline-card${isActive ? ' skills__offline-card--active' : ''}${cardLocked ? ' skills__offline-card--locked' : ''}`}
                    onClick={() => { if (!cardLocked) selectTrainingStat(statId); }}
                    title={cardLocked ? 'Trening zablokowany — trwa polowanie offline' : undefined}
                  >
                    <div className="skills__offline-card-header">
                      <div className="skills__offline-card-name">{label}</div>
                      <div className="skills__offline-card-level">Lvl {level}</div>
                      {isActive && <span className="skills__offline-card-badge">Aktywny</span>}
                    </div>
                    <div className="skills__xp-bar-wrap">
                      <div
                        className="skills__xp-bar"
                        style={{ width: `${progress * 100}%` }}
                      />
                    </div>
                    <div className="skills__xp-label">
                      <span>{xp} / {needed} XP</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Upgrade Modal Overlay ──────────────────────────────────────── */}
      <AnimatePresence>
        {upgradeModal && (
          <motion.div
            className="upgrade-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => { if (!isModalBusy) closeUpgradeModal(); }}
          >
            <motion.div
              className={[
                'upgrade-modal',
                upgradeModal.phase === 'success' ? 'upgrade-modal--success' : '',
                upgradeModal.phase === 'failure' ? 'upgrade-modal--failure' : '',
              ].join(' ')}
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              transition={{ duration: 0.25, type: 'spring', stiffness: 300, damping: 25 }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Particles overlay */}
              {upgradeModal.phase === 'success' && <UpgradeParticles type="success" />}
              {upgradeModal.phase === 'failure' && <UpgradeParticles type="failure" />}

              {/* Modal header */}
              <div className="upgrade-modal__header">
                <h2 className="upgrade-modal__title">Ulepszanie skilla</h2>
                <button
                  className="upgrade-modal__close"
                  onClick={closeUpgradeModal}
                  disabled={isModalBusy}
                >
                  ✕
                </button>
              </div>

              {/* Skill name with badge */}
              <div className="upgrade-modal__skill-name">
                <span className="upgrade-modal__skill-label">{getSkillIcon(upgradeModal.skillId)} {upgradeModal.skillName}</span>
                <span className={[
                  'upgrade-modal__badge',
                  upgradeModal.phase === 'success' ? 'upgrade-modal__badge--flash' : '',
                ].join(' ')}>
                  +{upgradeModal.currentLevel}
                </span>
              </div>

              {/* Info rows */}
              <div className="upgrade-modal__info">
                <div className="upgrade-modal__info-row">
                  <span>Poziom:</span>
                  <span className="upgrade-modal__info-val">
                    +{upgradeModal.currentLevel} → +{upgradeModal.targetLevel}
                  </span>
                </div>
                <div className="upgrade-modal__info-row">
                  <span>Bonus DMG/Heal:</span>
                  <span className="upgrade-modal__info-val">
                    +{(upgradeModal.currentBonus * 100).toFixed(0)}% → +{(upgradeModal.nextBonus * 100).toFixed(0)}%
                  </span>
                </div>
                <div className="upgrade-modal__info-row">
                  <span>Szansa sukcesu:</span>
                  <span className="upgrade-modal__info-val upgrade-modal__info-val--chance">
                    {upgradeModal.successRate < 1 ? upgradeModal.successRate.toFixed(1) : upgradeModal.successRate}%
                  </span>
                </div>
                {upgradeModal.chestCost > 0 && (
                  <div className="upgrade-modal__info-row">
                    <span>{getSpellChestIcon(upgradeModal.chestLevel)} Spell Chest (Lvl {upgradeModal.chestLevel}):</span>
                    <span className={`upgrade-modal__info-val${getSpellChestCount(upgradeModal.chestLevel) < upgradeModal.chestCost ? ' upgrade-modal__info-val--insufficient' : ''}`}>
                      {upgradeModal.chestCost} szt. (masz: {getSpellChestCount(upgradeModal.chestLevel)})
                    </span>
                  </div>
                )}
                <div className="upgrade-modal__info-row">
                  <span>Koszt gold:</span>
                  <span className={`upgrade-modal__info-val${gold < upgradeModal.goldCost ? ' upgrade-modal__info-val--insufficient' : ''}`}>
                    {formatGold(upgradeModal.goldCost)} gold
                  </span>
                </div>
                <div className="upgrade-modal__info-row">
                  <span>Twoje gold:</span>
                  <span className="upgrade-modal__info-val">{formatGold(gold)}</span>
                </div>
              </div>

              {/* Progress bar */}
              <div className="upgrade-modal__progress-wrap">
                <div
                  className={[
                    'upgrade-modal__progress-bar',
                    upgradeModal.phase === 'progress' ? 'upgrade-modal__progress-bar--filling' : '',
                    upgradeModal.phase === 'success' ? 'upgrade-modal__progress-bar--success' : '',
                    upgradeModal.phase === 'failure' ? 'upgrade-modal__progress-bar--failure' : '',
                    upgradeModal.phase === 'resolving' ? 'upgrade-modal__progress-bar--filling' : '',
                  ].join(' ')}
                  style={{
                    '--progress-duration': `${PROGRESS_DURATION_MS}ms`,
                  } as React.CSSProperties}
                />
              </div>

              {/* Result text */}
              <AnimatePresence mode="wait">
                {upgradeModal.phase === 'success' && upgradeModal.result && (
                  <motion.div
                    key="success"
                    className="upgrade-modal__result upgrade-modal__result--success"
                    initial={{ opacity: 0, scale: 0.8, y: 10 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 20 }}
                  >
                    <span className="upgrade-modal__result-icon upgrade-modal__result-icon--success">✓</span>
                    Sukces! +{upgradeModal.result.newLevel}
                  </motion.div>
                )}
                {upgradeModal.phase === 'failure' && upgradeModal.result && (
                  <motion.div
                    key="failure"
                    className="upgrade-modal__result upgrade-modal__result--failure"
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 25 }}
                  >
                    <span className="upgrade-modal__result-icon upgrade-modal__result-icon--failure">✗</span>
                    Nie udało się
                  </motion.div>
                )}
                {upgradeModal.phase === 'progress' && (
                  <motion.div
                    key="progress"
                    className="upgrade-modal__result upgrade-modal__result--progress"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                  >
                    Ulepszanie...
                  </motion.div>
                )}
                {upgradeModal.phase === 'resolving' && (
                  <motion.div
                    key="resolving"
                    className="upgrade-modal__result upgrade-modal__result--progress"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                  >
                    Rozstrzyganie...
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Previous result reminder */}
              {upgradeModal.phase === 'idle' && upgradeModal.result && (
                <div className={`upgrade-modal__last-result${upgradeModal.result.success ? ' upgrade-modal__last-result--success' : ' upgrade-modal__last-result--fail'}`}>
                  {upgradeModal.result.success
                    ? `Ostatni wynik: Sukces! (+${upgradeModal.result.newLevel})`
                    : `Ostatni wynik: Niepowodzenie (-${formatGold(upgradeModal.result.goldSpent)} gold)`}
                </div>
              )}

              {/* Action button */}
              <button
                className={[
                  'upgrade-modal__action',
                  isModalBusy ? 'upgrade-modal__action--busy' : '',
                  !canAffordModal && !isModalBusy ? 'upgrade-modal__action--disabled' : '',
                ].join(' ')}
                disabled={isModalBusy || !canAffordModal}
                onClick={startUpgradeAnimation}
              >
                {isModalBusy
                  ? 'Ulepszanie...'
                  : canAffordModal
                    ? `Ulepsz do +${upgradeModal.targetLevel} (${upgradeModal.chestCost > 0 ? `${getSpellChestIcon(upgradeModal.chestLevel)} x${upgradeModal.chestCost} + ` : ''}${formatGold(upgradeModal.goldCost)} gold)`
                    : 'Brak zasobow'}
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Unlock Confirmation Modal ─────────────────────────────────── */}
      <AnimatePresence>
        {unlockConfirm && (
          <motion.div
            className="upgrade-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => setUnlockConfirm(null)}
          >
            <motion.div
              className="upgrade-modal"
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              transition={{ duration: 0.25, type: 'spring', stiffness: 300, damping: 25 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="upgrade-modal__header">
                <h2 className="upgrade-modal__title">Odblokowanie skilla</h2>
                <button className="upgrade-modal__close" onClick={() => setUnlockConfirm(null)}>✕</button>
              </div>
              <div className="upgrade-modal__skill-name">
                <span className="upgrade-modal__skill-label">{getSkillIcon(unlockConfirm.skillId)} {unlockConfirm.skillName}</span>
              </div>
              <div className="upgrade-modal__info">
                <div className="upgrade-modal__info-row">
                  <span>{getSpellChestIcon(unlockConfirm.chestLevel)} Spell Chest (Lvl {unlockConfirm.chestLevel}):</span>
                  <span className={`upgrade-modal__info-val${getSpellChestCount(unlockConfirm.chestLevel) < unlockConfirm.chestCount ? ' upgrade-modal__info-val--insufficient' : ''}`}>
                    {unlockConfirm.chestCount} szt. (masz: {getSpellChestCount(unlockConfirm.chestLevel)})
                  </span>
                </div>
                <div className="upgrade-modal__info-row">
                  <span>Koszt gold:</span>
                  <span className={`upgrade-modal__info-val${gold < unlockConfirm.goldCost ? ' upgrade-modal__info-val--insufficient' : ''}`}>
                    {formatGold(unlockConfirm.goldCost)} gold
                  </span>
                </div>
                <div className="upgrade-modal__info-row">
                  <span>Twoje gold:</span>
                  <span className="upgrade-modal__info-val">{formatGold(gold)}</span>
                </div>
              </div>
              <button
                className={`upgrade-modal__action${!(gold >= unlockConfirm.goldCost && getSpellChestCount(unlockConfirm.chestLevel) >= unlockConfirm.chestCount) ? ' upgrade-modal__action--disabled' : ''}`}
                disabled={!(gold >= unlockConfirm.goldCost && getSpellChestCount(unlockConfirm.chestLevel) >= unlockConfirm.chestCount)}
                onClick={confirmUnlock}
              >
                {gold >= unlockConfirm.goldCost && getSpellChestCount(unlockConfirm.chestLevel) >= unlockConfirm.chestCount
                  ? `Odblokuj: ${getSpellChestIcon(unlockConfirm.chestLevel)} x${unlockConfirm.chestCount} + ${formatGold(unlockConfirm.goldCost)} gold`
                  : 'Brak zasobow'}
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Skills;
