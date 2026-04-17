import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useCharacterStore } from '../../stores/characterStore';
import { useSkillStore } from '../../stores/skillStore';
import { useInventoryStore } from '../../stores/inventoryStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { ELIXIRS } from '../../stores/shopStore';
import {
  FLAT_HP_POTIONS,
  FLAT_MP_POTIONS,
  PCT_HP_POTIONS,
  PCT_MP_POTIONS,
} from '../../systems/potionSystem';
import {
  SLOT_LABELS,
  SLOT_ICONS,
  RARITY_COLORS,
  EQUIPMENT_SLOTS,
  findBaseItem,
  flattenItemsData,
  getTotalEquipmentStats,
  getClassSkillBonus,
  getItemIcon,
} from '../../systems/itemSystem';
import { getItemDisplayInfo } from '../../systems/itemGenerator';
import { skillXpToNextLevel, getTrainingBonuses, getSkillUpgradeBonus } from '../../systems/skillSystem';
import { getElixirHpBonus, getElixirMpBonus } from '../../systems/combatElixirs';
import { getLiveTransformBreakdown } from '../../systems/transformBonuses';
import ItemIcon from '../../components/ui/ItemIcon/ItemIcon';
import itemsRaw from '../../data/items.json';
import skillsRaw from '../../data/skills.json';
import { getCharacterAvatar } from '../../data/classAvatars';
import { useTransformStore } from '../../stores/transformStore';
import { getSkillIcon } from '../../data/skillIcons';
import './CharacterStats.scss';

const ALL_ITEMS = flattenItemsData(itemsRaw as Parameters<typeof flattenItemsData>[0]);

const CLASS_MODIFIER: Record<string, number> = {
  Knight: 1.0, Mage: 1.3, Cleric: 1.0,
  Archer: 1.2, Rogue: 1.0, Necromancer: 1.2, Bard: 1.0,
};

interface IActiveSkillDef {
  id: string;
  name_pl: string;
  name_en: string;
  damage: number;
  mpCost: number;
  cooldown: number;
  effect: string | null;
  unlockLevel: number;
}

const ACTIVE_SKILLS_BY_CLASS: Record<string, IActiveSkillDef[]> = (skillsRaw as { activeSkills: Record<string, IActiveSkillDef[]> }).activeSkills;

// Skill icons are now centralized in src/data/skillIcons.ts

// Potion lists imported from potionSystem.ts:
// FLAT_HP_POTIONS, FLAT_MP_POTIONS, PCT_HP_POTIONS, PCT_MP_POTIONS

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

const MAGIC_CLASSES = new Set(['Mage', 'Cleric', 'Necromancer', 'Bard']);

const CharacterStats = () => {
  const navigate = useNavigate();
  const character = useCharacterStore((s) => s.character);
  const spendStatPoint = useCharacterStore((s) => s.spendStatPoint);
  const completedTransforms = useTransformStore((s) => s.completedTransforms);
  const getHighestTransformColor = useTransformStore((s) => s.getHighestTransformColor);
  const playerAvatarSrc = character ? getCharacterAvatar(character.class, completedTransforms) : '';

  // When at least one transform tier is completed, the transform color replaces
  // the class color for every avatar / accent surface on this screen so the
  // player feels the upgrade across the entire UI.
  const transformColor = getHighestTransformColor();
  const classFallback = character ? (CLASS_COLORS[character.class] ?? '#e94560') : '#e94560';
  const accentColor = (() => {
    if (!transformColor) return classFallback;
    if (transformColor.solid) return transformColor.solid;
    if (transformColor.gradient) return transformColor.gradient[0];
    return classFallback;
  })();
  const accentColorRgb = hexToRgb(accentColor);
  const [avatarModalOpen, setAvatarModalOpen] = useState(false);
  const { skillLevels, skillXp, activeSkillSlots, skillUpgradeLevels } = useSkillStore();
  const { equipment, consumables } = useInventoryStore();
  const {
    autoPotionHpEnabled,
    autoPotionMpEnabled,
    autoPotionHpThreshold,
    autoPotionMpThreshold,
    autoPotionHpId,
    autoPotionMpId,
    setAutoPotionHpEnabled,
    setAutoPotionMpEnabled,
    setAutoPotionHpThreshold,
    setAutoPotionMpThreshold,
    setAutoPotionHpId,
    setAutoPotionMpId,
    autoPotionPctHpEnabled,
    autoPotionPctMpEnabled,
    autoPotionPctHpThreshold,
    autoPotionPctMpThreshold,
    autoPotionPctHpId,
    autoPotionPctMpId,
    setAutoPotionPctHpEnabled,
    setAutoPotionPctMpEnabled,
    setAutoPotionPctHpThreshold,
    setAutoPotionPctMpThreshold,
    setAutoPotionPctHpId,
    setAutoPotionPctMpId,
  } = useSettingsStore();

  if (!character) {
    return (
      <div className="char-stats">
        <header className="char-stats__header">
          <button className="char-stats__back" onClick={() => navigate('/')}>← Miasto</button>
          <h1>Brak postaci</h1>
        </header>
      </div>
    );
  }

  const isMagicClass = MAGIC_CLASSES.has(character.class);

  // Compute equipment and training bonuses
  const eqStats = getTotalEquipmentStats(equipment, ALL_ITEMS);
  const tb = getTrainingBonuses(skillLevels, character.class);

  // Point 7/8: live transform bonuses. `active` is false when the character
  // is still in the legacy baked state — in that case the bonuses are already
  // inside character.max_hp / attack / etc. and we MUST NOT double-count.
  const transformBreakdown = getLiveTransformBreakdown();
  const transformActive = transformBreakdown.active;
  const tfFlatHp    = transformActive ? transformBreakdown.flatHp : 0;
  const tfFlatMp    = transformActive ? transformBreakdown.flatMp : 0;
  const tfFlatAtk   = transformActive ? transformBreakdown.flatAttack : 0;
  const tfFlatDef   = transformActive ? transformBreakdown.flatDefense : 0;
  const tfHpPct     = transformActive ? transformBreakdown.hpPercent : 0;
  const tfMpPct     = transformActive ? transformBreakdown.mpPercent : 0;
  const tfDefPct    = transformActive ? transformBreakdown.defPercent : 0;
  const tfHpRegen   = transformActive ? transformBreakdown.hpRegenFlat : 0;
  const tfMpRegen   = transformActive ? transformBreakdown.mpRegenFlat : 0;
  const tfDmgPct    = transformActive ? transformBreakdown.dmgPercent : 0;
  const tfAtkPct    = transformActive ? transformBreakdown.atkPercent : 0;

  // Effective totals (with transform layer on top of base + equip + training).
  const rawAtk = character.attack + eqStats.attack + tfFlatAtk;
  const effAtk = Math.floor(rawAtk * (1 + tfAtkPct / 100));
  const tfAtkPctBonus = effAtk - rawAtk;
  const rawDef = character.defense + eqStats.defense + tb.defense + tfFlatDef;
  const effDef = Math.floor(rawDef * (1 + tfDefPct / 100));
  const rawHp  = character.max_hp + eqStats.hp + tb.max_hp + getElixirHpBonus() + tfFlatHp;
  const rawMp  = character.max_mp + eqStats.mp + tb.max_mp + getElixirMpBonus() + tfFlatMp;
  const effMaxHp = Math.floor(rawHp * (1 + tfHpPct / 100));
  const effMaxMp = Math.floor(rawMp * (1 + tfMpPct / 100));
  // The extra HP/MP contributed by the transform % reward, after base + eq + tren.
  const tfHpPctBonus = effMaxHp - rawHp;
  const tfMpPctBonus = effMaxMp - rawMp;
  const tfDefPctBonus = effDef - rawDef;

  const hpPct = effMaxHp > 0 ? (character.hp / effMaxHp) * 100 : 0;
  const mpPct = effMaxMp > 0 ? (character.mp / effMaxMp) * 100 : 0;
  const effAS = (character.attack_speed ?? 10) + eqStats.speed * 0.01 + tb.attack_speed;
  const effCrit = Math.min(50, Math.round((character.crit_chance ?? 0.05) * 100) + eqStats.critChance + tb.crit_chance * 100);
  const effCritDmg = (character.crit_damage ?? 2.0) + eqStats.critDmg * 0.01 + tb.crit_dmg;
  const effHpRegen = (character.hp_regen ?? 0) + tb.hp_regen + tfHpRegen;
  const effMpRegen = (character.mp_regen ?? 0) + tb.mp_regen + tfMpRegen;

  // Get weapon skill name for the character class
  const classSkillMap: Record<string, string> = {
    Knight: 'sword_fighting',
    Mage: 'magic_level',
    Cleric: 'magic_level',
    Archer: 'distance_fighting',
    Rogue: 'dagger_fighting',
    Necromancer: 'magic_level',
    Bard: 'bard_level',
  };
  const mainSkillId = classSkillMap[character.class] ?? 'sword_fighting';
  const weaponSkillLevel = skillLevels[mainSkillId] ?? 0;
  const weaponSkillXp = skillXp[mainSkillId] ?? 0;
  const xpToNext = skillXpToNextLevel(weaponSkillLevel);
  const skillPct = xpToNext > 0 ? (weaponSkillXp / xpToNext) * 100 : 0;

  // ── Combat damage estimation ──────────────────────────────────────────────
  const classModifier = CLASS_MODIFIER[character.class] ?? 1.0;
  const classBonus = getClassSkillBonus(character.class, skillLevels);

  // Weapon min/max damage from equipped mainHand
  const mainHandItem = equipment.mainHand;
  const weaponDmgMin = mainHandItem ? (mainHandItem.bonuses.dmg_min ?? mainHandItem.bonuses.attack ?? 0) : 0;
  const weaponDmgMax = mainHandItem ? (mainHandItem.bonuses.dmg_max ?? weaponDmgMin) : 0;

  // Basic attack formula: (baseAtk + weaponDmg + skillBonus) * classModifier
  const isRogue = character.class === 'Rogue';
  const dualWieldMult = isRogue ? 0.6 : 1.0;

  const basicMinRaw = (character.attack + weaponDmgMin + classBonus.skillBonus) * classModifier;
  const basicMaxRaw = (character.attack + weaponDmgMax + classBonus.skillBonus) * classModifier;

  const basicMin = Math.max(1, Math.floor(basicMinRaw * dualWieldMult));
  const basicMax = Math.max(1, Math.floor(basicMaxRaw * dualWieldMult));

  // Crit damage
  const critMin = Math.max(1, Math.floor(basicMin * effCritDmg));
  const critMax = Math.max(1, Math.floor(basicMax * effCritDmg));

  // For Rogue dual wield: show per-hit + total
  const rogueBasicMinTotal = isRogue ? basicMin * 2 : basicMin;
  const rogueBasicMaxTotal = isRogue ? basicMax * 2 : basicMax;

  // Active skill damage estimates
  const classKey = character.class.toLowerCase();
  const allClassSkills: IActiveSkillDef[] = ACTIVE_SKILLS_BY_CLASS[classKey] ?? [];
  const activeSkillIds = activeSkillSlots.filter((s): s is string => s !== null);

  const activeSkillDamages = activeSkillIds.map((skillId) => {
    const skillDef = allClassSkills.find((s) => s.id === skillId);
    if (!skillDef) return null;
    if (skillDef.damage <= 0) return null; // buff/heal skills, no damage

    const upgradeLevel = skillUpgradeLevels[skillId] ?? 0;
    const upgradeBonus = 1 + getSkillUpgradeBonus(upgradeLevel);

    // Skill damage in combat: (baseAtk + weaponDmg + floor(attack*0.5)) * classModifier * critChance=0.20
    // But we show the multiplier-based estimate: baseDamage * skillMultiplier * upgradeBonus
    const skillBonusForSkill = Math.floor(character.attack * 0.5);
    const skillDmgMin = Math.max(1, Math.floor((character.attack + weaponDmgMin + skillBonusForSkill) * classModifier * skillDef.damage * upgradeBonus));
    const skillDmgMax = Math.max(1, Math.floor((character.attack + weaponDmgMax + skillBonusForSkill) * classModifier * skillDef.damage * upgradeBonus));

    return {
      id: skillId,
      name: skillDef.name_pl,
      upgradeLevel,
      dmgMin: skillDmgMin,
      dmgMax: skillDmgMax,
      emoji: getSkillIcon(skillId),
    };
  }).filter((s): s is NonNullable<typeof s> => s !== null);

  const SKILL_NAMES: Record<string, string> = {
    sword_fighting: 'Walka Mieczem',
    distance_fighting: 'Walka Dystansowa',
    dagger_fighting: 'Walka Sztyletem',
    magic_level: 'Poziom Magii',
    bard_level: 'Poziom Barda',
  };

  // Flat potion lookups
  const selectedFlatHpPotion = ELIXIRS.find((e) => e.id === autoPotionHpId);
  const selectedFlatMpPotion = ELIXIRS.find((e) => e.id === autoPotionMpId);
  const flatHpPotionCount = consumables[autoPotionHpId] ?? 0;
  const flatMpPotionCount = consumables[autoPotionMpId] ?? 0;

  // Percentage potion lookups
  const selectedPctHpPotion = ELIXIRS.find((e) => e.id === autoPotionPctHpId);
  const selectedPctMpPotion = ELIXIRS.find((e) => e.id === autoPotionPctMpId);
  const pctHpPotionCount = consumables[autoPotionPctHpId] ?? 0;
  const pctMpPotionCount = consumables[autoPotionPctMpId] ?? 0;

  // Calculate slider percentages for CSS custom property (0-99 range)
  const flatHpSliderPct = (autoPotionHpThreshold / 99) * 100;
  const flatMpSliderPct = (autoPotionMpThreshold / 99) * 100;
  const pctHpSliderPct = (autoPotionPctHpThreshold / 99) * 100;
  const pctMpSliderPct = (autoPotionPctMpThreshold / 99) * 100;

  return (
    <div className="char-stats">
      <header className="char-stats__header page-header">
        <button className="char-stats__back page-back-btn" onClick={() => navigate('/')}>← Miasto</button>
        <h1 className="char-stats__title page-title">Postac</h1>
      </header>

      {/* Character identity */}
      <section className="char-stats__identity" style={{
        '--class-color': accentColor,
        '--class-color-rgb': accentColorRgb,
      } as React.CSSProperties}>
        <div className="char-stats__avatar">
          <img src={playerAvatarSrc} alt={character.class} className="char-stats__avatar-img" />
        </div>
        <div className="char-stats__identity-info">
          <span className="char-stats__name">{character.name}</span>
          <span className="char-stats__class-level">{CLASS_ICONS[character.class] ?? '?'} {character.class} · Poziom {character.level}</span>
        </div>
        <div
          className="char-stats__class-avatar"
          onClick={() => setAvatarModalOpen(true)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter') setAvatarModalOpen(true); }}
        >
          <img
            src={playerAvatarSrc}
            alt={character.class}
            className="char-stats__class-avatar-img"
          />
          <div className="char-stats__class-avatar-overlay">
            <span className="char-stats__class-avatar-name">{character.class}</span>
            <span className="char-stats__class-avatar-level">Lvl {character.level}</span>
          </div>
        </div>
      </section>

      {/* Fullscreen avatar modal */}
      <AnimatePresence>
        {avatarModalOpen && (
          <motion.div
            className="char-stats__avatar-modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            onClick={() => setAvatarModalOpen(false)}
          >
            <motion.div
              className="char-stats__avatar-modal"
              style={{
                '--class-color': CLASS_COLORS[character.class] ?? '#e94560',
                '--class-color-rgb': hexToRgb(CLASS_COLORS[character.class] ?? '#e94560'),
              } as React.CSSProperties}
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.8, opacity: 0 }}
              transition={{ duration: 0.25, ease: 'easeOut' }}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                className="char-stats__avatar-modal-close"
                onClick={() => setAvatarModalOpen(false)}
              >
                &times;
              </button>
              <img
                src={playerAvatarSrc}
                alt={character.class}
                className="char-stats__avatar-modal-img"
              />
              <div className="char-stats__avatar-modal-info">
                <span className="char-stats__avatar-modal-name">{character.name}</span>
                <span className="char-stats__avatar-modal-class">
                  {character.class} · Poziom {character.level}
                </span>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Stat point allocation */}
      {(character.stat_points ?? 0) > 0 && (
        <section className="char-stats__stat-alloc char-stats__stat-alloc--active">
          <h2 className="char-stats__stat-alloc-title">
            Punkty statystyk: {character.stat_points}
          </h2>
          <div className="char-stats__stat-alloc-grid">
            <button
              className="char-stats__stat-alloc-btn"
              disabled={(character.stat_points ?? 0) === 0}
              onClick={() => spendStatPoint('max_hp')}
            >
              <span className="char-stats__stat-alloc-icon">❤️</span>
              <span className="char-stats__stat-alloc-name">Max HP</span>
              <span className="char-stats__stat-alloc-bonus">+5</span>
            </button>
            <button
              className="char-stats__stat-alloc-btn"
              disabled={(character.stat_points ?? 0) === 0}
              onClick={() => spendStatPoint('max_mp')}
            >
              <span className="char-stats__stat-alloc-icon">💧</span>
              <span className="char-stats__stat-alloc-name">Max MP</span>
              <span className="char-stats__stat-alloc-bonus">+5</span>
            </button>
            <button
              className="char-stats__stat-alloc-btn"
              disabled={(character.stat_points ?? 0) === 0}
              onClick={() => spendStatPoint('attack')}
            >
              <span className="char-stats__stat-alloc-icon">⚔️</span>
              <span className="char-stats__stat-alloc-name">Atak</span>
              <span className="char-stats__stat-alloc-bonus">+1</span>
            </button>
            <button
              className="char-stats__stat-alloc-btn"
              disabled={(character.stat_points ?? 0) === 0}
              onClick={() => spendStatPoint('defense')}
            >
              <span className="char-stats__stat-alloc-icon">🛡️</span>
              <span className="char-stats__stat-alloc-name">Obrona</span>
              <span className="char-stats__stat-alloc-bonus">+1</span>
            </button>
          </div>
        </section>
      )}

      {/* HP / MP bars */}
      <section className="char-stats__section">
        <h2 className="char-stats__section-title">Zycie i Mana</h2>

        <div className="char-stats__stat-row">
          <span className="char-stats__stat-label">HP</span>
          <div className="char-stats__bar char-stats__bar--hp">
            <div className="char-stats__bar-fill" style={{ width: `${hpPct}%` }} />
          </div>
          <span className="char-stats__stat-value">{character.hp} / {effMaxHp}</span>
        </div>

        <div className="char-stats__stat-row">
          <span className="char-stats__stat-label">MP</span>
          <div className="char-stats__bar char-stats__bar--mp">
            <div className="char-stats__bar-fill" style={{ width: `${mpPct}%` }} />
          </div>
          <span className="char-stats__stat-value">{character.mp} / {effMaxMp}</span>
        </div>
      </section>

      {/* Paperdoll: large avatar with equipment overlay */}
      <section className="char-stats__section">
        <h2 className="char-stats__section-title">Ekwipunek</h2>
        <div
          className="char-stats__paperdoll"
          style={{
            '--avatar-class-color': accentColor,
            '--avatar-class-rgb': accentColorRgb,
          } as React.CSSProperties}
        >
          <div className="char-stats__paperdoll-stage">
            <div className="char-stats__paperdoll-avatar">
              <img
                src={playerAvatarSrc}
                alt={character.class}
                className="char-stats__paperdoll-avatar-img"
              />
              <div className="char-stats__paperdoll-avatar-overlay">
                <span className="char-stats__paperdoll-avatar-name">{character.class}</span>
                <span className="char-stats__paperdoll-avatar-level">Lvl {character.level}</span>
              </div>
            </div>

            {EQUIPMENT_SLOTS.map((slot) => {
              const item = equipment[slot] ?? null;
              const color = item ? RARITY_COLORS[item.rarity] : undefined;
              const base = item ? findBaseItem(item.itemId, ALL_ITEMS) : null;
              const genInfo = item && !base ? getItemDisplayInfo(item.itemId) : null;
              const itemIcon = genInfo?.icon ?? (item ? getItemIcon(item.itemId, slot, ALL_ITEMS) : SLOT_ICONS[slot] ?? '📦');
              return (
                <button
                  key={slot}
                  className={`char-stats__doll-slot char-stats__doll-slot--${slot}${item ? ' char-stats__doll-slot--filled' : ''}`}
                  style={color ? ({ '--rarity-color': color } as React.CSSProperties) : undefined}
                  onClick={() => navigate('/inventory')}
                  aria-label={SLOT_LABELS[slot]}
                >
                  {item ? (
                    <ItemIcon
                      icon={itemIcon}
                      rarity={item.rarity}
                      upgradeLevel={item.upgradeLevel}
                      itemLevel={item.itemLevel || 1}
                      size="md"
                    />
                  ) : (
                    <span className="char-stats__doll-slot-icon">{SLOT_ICONS[slot]}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* Combat stats - effective totals with breakdown */}
      <section className="char-stats__section">
        <h2 className="char-stats__section-title">Statystyki Walki (efektywne)</h2>
        <div className="char-stats__grid">
          <div className="char-stats__stat-box" title={`Baza: ${character.attack} + Eq: ${eqStats.attack}${tfFlatAtk > 0 ? ` + Transform flat: ${tfFlatAtk}` : ''}${tfAtkPct > 0 ? ` + Transform ${tfAtkPct}%` : ''}`}>
            <span className="char-stats__stat-box-label">Atak</span>
            <span className="char-stats__stat-box-value">{effAtk}</span>
            <span className="char-stats__stat-box-detail">
              {character.attack} baza{eqStats.attack > 0 ? ` +${eqStats.attack} eq` : ''}{tfFlatAtk > 0 ? ` +${tfFlatAtk} tf` : ''}{tfAtkPctBonus > 0 ? ` +${tfAtkPctBonus} (${tfAtkPct}% tf)` : ''}
            </span>
          </div>
          <div className="char-stats__stat-box" title={`Baza: ${character.defense} + Eq: ${eqStats.defense} + Trening: ${tb.defense}${tfFlatDef > 0 ? ` + Transform flat: ${tfFlatDef}` : ''}${tfDefPct > 0 ? ` + Transform ${tfDefPct}%` : ''}`}>
            <span className="char-stats__stat-box-label">Obrona</span>
            <span className="char-stats__stat-box-value">{effDef}</span>
            <span className="char-stats__stat-box-detail">
              {character.defense} baza{eqStats.defense > 0 ? ` +${eqStats.defense} eq` : ''}{tb.defense > 0 ? ` +${tb.defense} tren` : ''}{tfFlatDef > 0 ? ` +${tfFlatDef} tf` : ''}{tfDefPctBonus > 0 ? ` +${tfDefPctBonus} (${tfDefPct}% tf)` : ''}
            </span>
          </div>
          <div className="char-stats__stat-box" title={`Baza: ${character.attack_speed ?? 10} + Trening: ${tb.attack_speed.toFixed(1)}`}>
            <span className="char-stats__stat-box-label">Predkosc Ataku</span>
            <span className="char-stats__stat-box-value">{effAS.toFixed(1)}</span>
            <span className="char-stats__stat-box-detail">
              {character.attack_speed ?? 10} baza{tb.attack_speed > 0 ? ` +${tb.attack_speed.toFixed(1)} tren` : ''}
            </span>
          </div>
          <div className="char-stats__stat-box" title={`Baza: ${character.max_hp} + Eq: ${eqStats.hp} + Trening: ${tb.max_hp}${tfFlatHp > 0 ? ` + Transform flat: ${tfFlatHp}` : ''}${tfHpPct > 0 ? ` + Transform ${tfHpPct}%` : ''}`}>
            <span className="char-stats__stat-box-label">Max HP</span>
            <span className="char-stats__stat-box-value">{effMaxHp}</span>
            <span className="char-stats__stat-box-detail">
              {character.max_hp} baza{eqStats.hp > 0 ? ` +${eqStats.hp} eq` : ''}{tb.max_hp > 0 ? ` +${tb.max_hp} tren` : ''}{tfFlatHp > 0 ? ` +${tfFlatHp} tf` : ''}{tfHpPctBonus > 0 ? ` +${tfHpPctBonus} (${tfHpPct}% tf)` : ''}
            </span>
          </div>
          <div className="char-stats__stat-box" title={`Baza: ${character.max_mp} + Eq: ${eqStats.mp} + Trening: ${tb.max_mp}${tfFlatMp > 0 ? ` + Transform flat: ${tfFlatMp}` : ''}${tfMpPct > 0 ? ` + Transform ${tfMpPct}%` : ''}`}>
            <span className="char-stats__stat-box-label">Max MP</span>
            <span className="char-stats__stat-box-value">{effMaxMp}</span>
            <span className="char-stats__stat-box-detail">
              {character.max_mp} baza{eqStats.mp > 0 ? ` +${eqStats.mp} eq` : ''}{tb.max_mp > 0 ? ` +${tb.max_mp} tren` : ''}{tfFlatMp > 0 ? ` +${tfFlatMp} tf` : ''}{tfMpPctBonus > 0 ? ` +${tfMpPctBonus} (${tfMpPct}% tf)` : ''}
            </span>
          </div>
          <div className="char-stats__stat-box">
            <span className="char-stats__stat-box-label">Kryty %</span>
            <span className="char-stats__stat-box-value">{effCrit}%</span>
            <span className="char-stats__stat-box-detail">
              {Math.round((character.crit_chance ?? 0.05) * 100)}% baza{eqStats.critChance > 0 ? ` +${eqStats.critChance}% eq` : ''}{tb.crit_chance > 0 ? ` +${(tb.crit_chance * 100).toFixed(1)}% tren` : ''}
            </span>
          </div>
          <div className="char-stats__stat-box">
            <span className="char-stats__stat-box-label">Kryty DMG</span>
            <span className="char-stats__stat-box-value">x{effCritDmg.toFixed(1)}</span>
          </div>
          <div className="char-stats__stat-box">
            <span className="char-stats__stat-box-label">HP Regen</span>
            <span className="char-stats__stat-box-value">{effHpRegen.toFixed(1)}/s</span>
            <span className="char-stats__stat-box-detail">
              {(character.hp_regen ?? 0)} baza{tb.hp_regen > 0 ? ` +${tb.hp_regen.toFixed(1)} tren` : ''}{tfHpRegen > 0 ? ` +${tfHpRegen.toFixed(1)} tf` : ''}
            </span>
          </div>
          <div className="char-stats__stat-box">
            <span className="char-stats__stat-box-label">MP Regen</span>
            <span className="char-stats__stat-box-value">{effMpRegen.toFixed(1)}/s</span>
            <span className="char-stats__stat-box-detail">
              {(character.mp_regen ?? 0)} baza{tb.mp_regen > 0 ? ` +${tb.mp_regen.toFixed(1)} tren` : ''}{tfMpRegen > 0 ? ` +${tfMpRegen.toFixed(1)} tf` : ''}
            </span>
          </div>
          {tfDmgPct > 0 && (
            <div className="char-stats__stat-box" title="Zwiekszenie obrazen ze wszystkich zrodel dzieki ukonczonym transformacjom">
              <span className="char-stats__stat-box-label">DMG Transform</span>
              <span className="char-stats__stat-box-value">+{tfDmgPct}%</span>
              <span className="char-stats__stat-box-detail">mnoznik caly DMG</span>
            </div>
          )}
          {isMagicClass && (
            <div className="char-stats__stat-box">
              <span className="char-stats__stat-box-label">Magic Level</span>
              <span className="char-stats__stat-box-value">{character.magic_level ?? weaponSkillLevel}</span>
            </div>
          )}
        </div>
      </section>

      {/* Combat damage estimates */}
      <section className="char-stats__section">
        <h2 className="char-stats__section-title">Obrazenia w Walce</h2>
        <div className="char-stats__combat-dmg">
          <div className="char-stats__dmg-row">
            <span className="char-stats__dmg-icon">⚔️</span>
            <span className="char-stats__dmg-label">Atak podstawowy</span>
            <span className="char-stats__dmg-value">
              {isRogue ? (
                <>{basicMin} - {basicMax} x2 = <strong>{rogueBasicMinTotal} - {rogueBasicMaxTotal}</strong> DMG</>
              ) : (
                <><strong>{basicMin} - {basicMax}</strong> DMG</>
              )}
            </span>
          </div>
          <div className="char-stats__dmg-row char-stats__dmg-row--crit">
            <span className="char-stats__dmg-icon">⚡</span>
            <span className="char-stats__dmg-label">Atak krytyczny</span>
            <span className="char-stats__dmg-value">
              {isRogue ? (
                <><strong>{critMin} - {critMax}</strong> x2 DMG</>
              ) : (
                <><strong>{critMin} - {critMax}</strong> DMG</>
              )}
            </span>
          </div>
          {activeSkillDamages.length > 0 && (
            <div className="char-stats__dmg-skills-separator" />
          )}
          {activeSkillDamages.map((skill) => (
            <div key={skill.id} className="char-stats__dmg-row char-stats__dmg-row--skill">
              <span className="char-stats__dmg-icon">{skill.emoji}</span>
              <span className="char-stats__dmg-label">
                {skill.name}
                {skill.upgradeLevel > 0 && (
                  <span className="char-stats__dmg-upgrade"> (+{skill.upgradeLevel})</span>
                )}
              </span>
              <span className="char-stats__dmg-value">
                <strong>{skill.dmgMin} - {skill.dmgMax}</strong> DMG
              </span>
            </div>
          ))}
          {activeSkillDamages.length === 0 && activeSkillIds.length === 0 && (
            <div className="char-stats__dmg-empty">Brak aktywnych skilli bojowych</div>
          )}
        </div>
        <div className="char-stats__dmg-note">
          Przed redukcja obrony wroga
        </div>
      </section>

      {/* Weapon skill */}
      <section className="char-stats__section">
        <h2 className="char-stats__section-title">Skill Bojowy</h2>
        <div className="char-stats__skill-row">
          <span className="char-stats__skill-name">
            {SKILL_NAMES[mainSkillId] ?? mainSkillId}
          </span>
          <span className="char-stats__skill-level">Poziom {weaponSkillLevel}</span>
        </div>
        <div className="char-stats__skill-xp-row">
          <div className="char-stats__bar char-stats__bar--xp">
            <div className="char-stats__bar-fill" style={{ width: `${Math.min(100, skillPct)}%` }} />
          </div>
          <span className="char-stats__stat-value">{weaponSkillXp} / {xpToNext}</span>
        </div>
      </section>


      {/* Auto-potion settings – 4 independent slots */}
      <section className="char-stats__section">
        <h2 className="char-stats__section-title">Auto-potion</h2>

        {/* Block 1: Flat HP Auto-potion */}
        <div className={`char-stats__potion-setting${!autoPotionHpEnabled ? ' char-stats__potion-setting--disabled' : ''}`}>
          <div className="char-stats__potion-row">
            <label className="char-stats__potion-toggle">
              <input
                type="checkbox"
                checked={autoPotionHpEnabled}
                onChange={(e) => setAutoPotionHpEnabled(e.target.checked)}
                className="char-stats__potion-checkbox"
              />
              <span className="char-stats__potion-label">Auto HP Potion</span>
            </label>
            <span className="char-stats__potion-value">
              {autoPotionHpEnabled ? `${autoPotionHpThreshold}%` : 'WYL'}
            </span>
          </div>

          <input
            type="range"
            min={0}
            max={99}
            step={1}
            value={autoPotionHpThreshold}
            onChange={(e) => setAutoPotionHpThreshold(Number(e.target.value))}
            disabled={!autoPotionHpEnabled}
            className="char-stats__slider char-stats__slider--hp"
            style={{ '--val': `${flatHpSliderPct}%` } as React.CSSProperties}
          />

          <div className="char-stats__potion-select">
            <label className="char-stats__potion-select-label">Wybrany potion:</label>
            <select
              className="char-stats__potion-dropdown"
              value={autoPotionHpId}
              onChange={(e) => setAutoPotionHpId(e.target.value)}
              disabled={!autoPotionHpEnabled}
            >
              {FLAT_HP_POTIONS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name_pl} (x{consumables[p.id] ?? 0})
                </option>
              ))}
            </select>
            <span className="char-stats__potion-count">
              Posiadasz: {flatHpPotionCount}x {selectedFlatHpPotion?.name_pl ?? '---'}
            </span>
          </div>
        </div>

        {/* Block 2: Flat MP Auto-potion */}
        <div className={`char-stats__potion-setting${!autoPotionMpEnabled ? ' char-stats__potion-setting--disabled' : ''}`}>
          <div className="char-stats__potion-row">
            <label className="char-stats__potion-toggle">
              <input
                type="checkbox"
                checked={autoPotionMpEnabled}
                onChange={(e) => setAutoPotionMpEnabled(e.target.checked)}
                className="char-stats__potion-checkbox"
              />
              <span className="char-stats__potion-label">Auto MP Potion</span>
            </label>
            <span className="char-stats__potion-value">
              {autoPotionMpEnabled ? `${autoPotionMpThreshold}%` : 'WYL'}
            </span>
          </div>

          <input
            type="range"
            min={0}
            max={99}
            step={1}
            value={autoPotionMpThreshold}
            onChange={(e) => setAutoPotionMpThreshold(Number(e.target.value))}
            disabled={!autoPotionMpEnabled}
            className="char-stats__slider char-stats__slider--mp"
            style={{ '--val': `${flatMpSliderPct}%` } as React.CSSProperties}
          />

          <div className="char-stats__potion-select">
            <label className="char-stats__potion-select-label">Wybrany potion:</label>
            <select
              className="char-stats__potion-dropdown"
              value={autoPotionMpId}
              onChange={(e) => setAutoPotionMpId(e.target.value)}
              disabled={!autoPotionMpEnabled}
            >
              {FLAT_MP_POTIONS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name_pl} (x{consumables[p.id] ?? 0})
                </option>
              ))}
            </select>
            <span className="char-stats__potion-count">
              Posiadasz: {flatMpPotionCount}x {selectedFlatMpPotion?.name_pl ?? '---'}
            </span>
          </div>
        </div>

        {/* Block 3: Percentage HP Auto-potion */}
        <div className={`char-stats__potion-setting${!autoPotionPctHpEnabled ? ' char-stats__potion-setting--disabled' : ''}`}>
          <div className="char-stats__potion-row">
            <label className="char-stats__potion-toggle">
              <input
                type="checkbox"
                checked={autoPotionPctHpEnabled}
                onChange={(e) => setAutoPotionPctHpEnabled(e.target.checked)}
                className="char-stats__potion-checkbox"
              />
              <span className="char-stats__potion-label">Auto % HP Potion</span>
            </label>
            <span className="char-stats__potion-value">
              {autoPotionPctHpEnabled ? `${autoPotionPctHpThreshold}%` : 'WYL'}
            </span>
          </div>

          <input
            type="range"
            min={0}
            max={99}
            step={1}
            value={autoPotionPctHpThreshold}
            onChange={(e) => setAutoPotionPctHpThreshold(Number(e.target.value))}
            disabled={!autoPotionPctHpEnabled}
            className="char-stats__slider char-stats__slider--hp"
            style={{ '--val': `${pctHpSliderPct}%` } as React.CSSProperties}
          />

          <div className="char-stats__potion-select">
            <label className="char-stats__potion-select-label">Wybrany potion:</label>
            <select
              className="char-stats__potion-dropdown"
              value={autoPotionPctHpId}
              onChange={(e) => setAutoPotionPctHpId(e.target.value)}
              disabled={!autoPotionPctHpEnabled}
            >
              {PCT_HP_POTIONS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name_pl} (x{consumables[p.id] ?? 0})
                </option>
              ))}
            </select>
            <span className="char-stats__potion-count">
              Posiadasz: {pctHpPotionCount}x {selectedPctHpPotion?.name_pl ?? '---'}
            </span>
          </div>
        </div>

        {/* Block 4: Percentage MP Auto-potion */}
        <div className={`char-stats__potion-setting${!autoPotionPctMpEnabled ? ' char-stats__potion-setting--disabled' : ''}`}>
          <div className="char-stats__potion-row">
            <label className="char-stats__potion-toggle">
              <input
                type="checkbox"
                checked={autoPotionPctMpEnabled}
                onChange={(e) => setAutoPotionPctMpEnabled(e.target.checked)}
                className="char-stats__potion-checkbox"
              />
              <span className="char-stats__potion-label">Auto % MP Potion</span>
            </label>
            <span className="char-stats__potion-value">
              {autoPotionPctMpEnabled ? `${autoPotionPctMpThreshold}%` : 'WYL'}
            </span>
          </div>

          <input
            type="range"
            min={0}
            max={99}
            step={1}
            value={autoPotionPctMpThreshold}
            onChange={(e) => setAutoPotionPctMpThreshold(Number(e.target.value))}
            disabled={!autoPotionPctMpEnabled}
            className="char-stats__slider char-stats__slider--mp"
            style={{ '--val': `${pctMpSliderPct}%` } as React.CSSProperties}
          />

          <div className="char-stats__potion-select">
            <label className="char-stats__potion-select-label">Wybrany potion:</label>
            <select
              className="char-stats__potion-dropdown"
              value={autoPotionPctMpId}
              onChange={(e) => setAutoPotionPctMpId(e.target.value)}
              disabled={!autoPotionPctMpEnabled}
            >
              {PCT_MP_POTIONS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name_pl} (x{consumables[p.id] ?? 0})
                </option>
              ))}
            </select>
            <span className="char-stats__potion-count">
              Posiadasz: {pctMpPotionCount}x {selectedPctMpPotion?.name_pl ?? '---'}
            </span>
          </div>
        </div>
      </section>
    </div>
  );
};

export default CharacterStats;
