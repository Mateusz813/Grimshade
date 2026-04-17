import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '../../lib/supabase';
import { useCharacterStore } from '../../stores/characterStore';
import { useInventoryStore } from '../../stores/inventoryStore';
import { characterApi, type CharacterClass } from '../../api/v1/characterApi';
import { buildItem } from '../../systems/itemSystem';
import { switchToCharacter } from '../../stores/characterScope';
import api from '../../api/v1/axiosInstance';
import classesData from '../../data/classes.json';
import mageImg from '../../assets/images/classes/mage.png';
import knightImg from '../../assets/images/classes/knight.png';
import archerImg from '../../assets/images/classes/archer.png';
import clericImg from '../../assets/images/classes/cleric.png';
import bardImg from '../../assets/images/classes/bard.png';
import rogueImg from '../../assets/images/classes/rogue.png';
import necromancerImg from '../../assets/images/classes/necromancer.png';
import './CharacterCreate.scss';

interface IClassData {
  id: CharacterClass;
  name_pl: string;
  name_en: string;
  description_pl: string;
  baseStats: { hp: number; mp: number; attack: number; defense: number; speed: number };
  skillNames: string[];
  hpPerLevel: number;
  mpPerLevel: number;
  attackPerLevel: number;
  defensePerLevel: number;
}

const classes = classesData as IClassData[];

// Per-class base stats matching DB columns (CLAUDE.md spec)
const CLASS_BASE_STATS: Record<CharacterClass, {
  hp: number; max_hp: number; mp: number; max_mp: number;
  attack: number; defense: number; attack_speed: number;
  crit_chance: number; crit_damage: number; magic_level: number;
}> = {
  // attack_speed: HIGHER = FASTER attacks (formula: getAttackMs = 3000/speed).
  // Knight = tank = slowest. Archer/Rogue = DPS = fastest.
  Knight:      { hp:120, max_hp:120, mp:30,  max_mp:30,  attack:10, defense:5,  attack_speed:1.5, crit_chance:0.03, crit_damage:2.0, magic_level:0 },
  Mage:        { hp:80,  max_hp:80,  mp:200, max_mp:200, attack:6,  defense:2,  attack_speed:2.0, crit_chance:0.05, crit_damage:2.0, magic_level:5 },
  Cleric:      { hp:100, max_hp:100, mp:150, max_mp:150, attack:7,  defense:4,  attack_speed:2.0, crit_chance:0.03, crit_damage:2.0, magic_level:5 },
  Archer:      { hp:100, max_hp:100, mp:80,  max_mp:80,  attack:10, defense:3,  attack_speed:2.5, crit_chance:0.10, crit_damage:2.0, magic_level:0 },
  Rogue:       { hp:90,  max_hp:90,  mp:60,  max_mp:60,  attack:9,  defense:3,  attack_speed:2.5, crit_chance:0.15, crit_damage:2.5, magic_level:0 },
  Necromancer: { hp:85,  max_hp:85,  mp:180, max_mp:180, attack:6,  defense:2,  attack_speed:1.8, crit_chance:0.05, crit_damage:2.0, magic_level:5 },
  Bard:        { hp:95,  max_hp:95,  mp:120, max_mp:120, attack:8,  defense:3,  attack_speed:2.0, crit_chance:0.07, crit_damage:2.0, magic_level:3 },
};

// Starter weapons per class
const STARTER_WEAPONS: Record<CharacterClass, { id: string; name: string; dmg_min: number; dmg_max: number }> = {
  Knight:      { id: 'sword_of_beginnings', name: 'Sword of Beginnings',   dmg_min: 4, dmg_max: 8 },
  Mage:        { id: 'apprentice_staff',    name: 'Apprentice Staff',       dmg_min: 3, dmg_max: 6 },
  Cleric:      { id: 'wooden_mace',         name: 'Wooden Mace',            dmg_min: 3, dmg_max: 7 },
  Archer:      { id: 'short_bow',           name: 'Short Bow',              dmg_min: 4, dmg_max: 8 },
  Rogue:       { id: 'rusty_dagger',        name: 'Rusty Dagger',           dmg_min: 3, dmg_max: 7 },
  Necromancer: { id: 'bone_staff',          name: 'Bone Staff',             dmg_min: 3, dmg_max: 6 },
  Bard:        { id: 'lute',               name: 'Lute',                   dmg_min: 3, dmg_max: 6 },
};

const CLASS_ICONS: Record<CharacterClass, string> = {
  Knight: '⚔️', Mage: '🔮', Cleric: '✨', Archer: '🏹',
  Rogue: '🗡️', Necromancer: '💀', Bard: '🎵',
};

const CLASS_COLORS: Record<string, string> = {
  Knight: '#e53935', Mage: '#7b1fa2', Cleric: '#ffc107', Archer: '#4caf50',
  Rogue: '#424242', Necromancer: '#795548', Bard: '#ff9800',
};

const CLASS_IMAGES: Record<CharacterClass, string> = {
  Knight: knightImg, Mage: mageImg, Cleric: clericImg, Archer: archerImg,
  Rogue: rogueImg, Necromancer: necromancerImg, Bard: bardImg,
};

const STAT_MAX: Record<string, number> = { hp: 200, mp: 200, attack: 10, defense: 5, speed: 3 };

const getCreateSchema = () =>
  z.object({
    name: z
      .string()
      .min(3, 'Min. 3 znaki')
      .max(20, 'Max. 20 znaków')
      .regex(/^[a-zA-ZąćęłńóśźżĄĆĘŁŃÓŚŹŻ0-9 ]+$/, 'Tylko litery, cyfry i spacje'),
  });

type ICreateForm = z.infer<ReturnType<typeof getCreateSchema>>;

const StatBar = ({ label, value, max }: { label: string; value: number; max: number }) => (
  <div className="character-create__stat">
    <span className="character-create__stat-label">{label}</span>
    <div className="character-create__stat-track">
      <motion.div
        className="character-create__stat-fill"
        initial={{ width: 0 }}
        animate={{ width: `${Math.min(100, (value / max) * 100)}%` }}
        transition={{ duration: 0.35, ease: 'easeOut' }}
      />
    </div>
    <span className="character-create__stat-value">{value}</span>
  </div>
);

const CharacterCreate = () => {
  const navigate = useNavigate();
  const setCharacter = useCharacterStore((s) => s.setCharacter);
  const [selectedId, setSelectedId] = useState<CharacterClass | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ICreateForm>({ resolver: zodResolver(getCreateSchema()) });

  const selectedClass = classes.find((c) => c.id === selectedId) ?? null;

  const onSubmit = async (data: ICreateForm) => {
    if (!selectedId) {
      setError('root', { message: 'Wybierz klasę postaci' });
      return;
    }
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) {
      navigate('/login');
      return;
    }

    // Check character count limit (max 7)
    try {
      const existingRes = await api.get(
        `/rest/v1/characters?user_id=eq.${sessionData.session.user.id}&select=id`,
      );
      if (existingRes.data.length >= 7) {
        setError('root', { message: 'Osiągnięto limit 7 postaci.' });
        return;
      }
    } catch {
      // ignore, proceed with creation
    }

    try {
      const bs = CLASS_BASE_STATS[selectedId];
      const character = await characterApi.createCharacter(sessionData.session.user.id, {
        name: data.name,
        class: selectedId,
        hp: bs.hp,
        max_hp: bs.max_hp,
        mp: bs.mp,
        max_mp: bs.max_mp,
        attack: bs.attack,
        defense: bs.defense,
        attack_speed: bs.attack_speed,
        crit_chance: bs.crit_chance,
        crit_damage: bs.crit_damage,
        magic_level: bs.magic_level,
        hp_regen: 0,
        mp_regen: 0,
        gold: 0,
        stat_points: 0,
      });

      // Switch to new character scope (resets all stores to defaults)
      await switchToCharacter(character.id);

      // Grant starter weapon (add to inventory and equip it)
      const starterWeapon = STARTER_WEAPONS[selectedId];
      const starterItem = buildItem({
        itemId: starterWeapon.id,
        rarity: 'common',
        bonuses: { attack: starterWeapon.dmg_min, dmg_min: starterWeapon.dmg_min, dmg_max: starterWeapon.dmg_max },
        itemLevel: 1,
      });
      useInventoryStore.getState().addItem(starterItem);
      useInventoryStore.getState().equipItem(starterItem.uuid, 'mainHand');

      setCharacter(character);
      navigate('/');
    } catch {
      setError('root', { message: 'Błąd tworzenia postaci. Spróbuj ponownie.' });
    }
  };

  return (
    <div className="character-create">
      <div className="character-create__layout">
        {/* Left – class picker + name */}
        <div className="character-create__panel">
          <button
            type="button"
            className="character-create__back-btn"
            onClick={() => navigate('/character-select')}
          >
            ← Wróć
          </button>
          <h1 className="character-create__title">Stwórz postać</h1>

          <form className="character-create__form" onSubmit={handleSubmit(onSubmit)}>
            <div className="character-create__field">
              <label className="character-create__label">Nazwa postaci</label>
              <input
                className="character-create__input"
                type="text"
                autoComplete="off"
                placeholder="Wpisz nazwę…"
                {...register('name')}
              />
              {errors.name && (
                <span className="character-create__error">{errors.name.message}</span>
              )}
            </div>

            <div className="character-create__section-label">Wybierz klasę</div>
            <div className="character-create__class-grid">
              {classes.map((cls) => (
                <button
                  key={cls.id}
                  type="button"
                  className={`character-create__class-btn${selectedId === cls.id ? ' character-create__class-btn--selected' : ''}`}
                  style={selectedId === cls.id ? { borderColor: CLASS_COLORS[cls.id], color: CLASS_COLORS[cls.id] } : undefined}
                  onClick={() => setSelectedId(cls.id)}
                >
                  {CLASS_ICONS[cls.id]} {cls.name_pl}
                </button>
              ))}
            </div>

            {errors.root && (
              <span className="character-create__error">{errors.root.message}</span>
            )}

            <button
              className="character-create__submit"
              type="submit"
              disabled={isSubmitting || !selectedId}
            >
              {isSubmitting ? 'Tworzenie…' : 'Stwórz postać'}
            </button>
          </form>
        </div>

        {/* Right – class detail panel */}
        <div
          className={`character-create__detail${selectedClass ? ' character-create__detail--active' : ''}`}
          style={selectedClass ? {
            '--class-color': CLASS_COLORS[selectedClass.id] ?? '#e94560',
            '--class-color-rgb': CLASS_COLORS[selectedClass.id] === '#e53935' ? '229,57,53'
              : CLASS_COLORS[selectedClass.id] === '#7b1fa2' ? '123,31,162'
              : CLASS_COLORS[selectedClass.id] === '#ffc107' ? '255,193,7'
              : CLASS_COLORS[selectedClass.id] === '#4caf50' ? '76,175,80'
              : CLASS_COLORS[selectedClass.id] === '#424242' ? '66,66,66'
              : CLASS_COLORS[selectedClass.id] === '#795548' ? '121,85,72'
              : '255,152,0',
          } as React.CSSProperties : undefined}
        >
          <AnimatePresence mode="wait">
            {selectedClass ? (
              <motion.div
                key={selectedClass.id}
                className="character-create__detail-inner"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.2 }}
              >
                <div className="character-create__portrait">
                  <img
                    src={CLASS_IMAGES[selectedClass.id]}
                    alt={selectedClass.name_pl}
                    className="character-create__portrait-img"
                  />
                </div>
                <h2 className="character-create__detail-name" style={{ color: CLASS_COLORS[selectedClass.id] ?? '#e94560' }}>
                  {CLASS_ICONS[selectedClass.id]} {selectedClass.name_pl}
                </h2>
                <p className="character-create__detail-desc">{selectedClass.description_pl}</p>

                <div className="character-create__starter-weapon">
                  Startowa broń: {CLASS_ICONS[selectedClass.id]} {STARTER_WEAPONS[selectedClass.id].name} ({STARTER_WEAPONS[selectedClass.id].dmg_min}-{STARTER_WEAPONS[selectedClass.id].dmg_max} DMG)
                </div>

                <div className="character-create__stats-box">
                  <div className="character-create__stats">
                    <div className="character-create__stats-title">Statystyki bazowe</div>
                    <StatBar label="HP" value={selectedClass.baseStats.hp} max={STAT_MAX.hp} />
                    <StatBar label="MP" value={selectedClass.baseStats.mp} max={STAT_MAX.mp} />
                    <StatBar label="ATK" value={selectedClass.baseStats.attack} max={STAT_MAX.attack} />
                    <StatBar label="DEF" value={selectedClass.baseStats.defense} max={STAT_MAX.defense} />
                    <StatBar label="SPD" value={selectedClass.baseStats.speed} max={STAT_MAX.speed} />
                  </div>

                  <div className="character-create__extra-stats">
                    <div className="character-create__extra-stats-grid">
                      <span>Crit Chance: {(CLASS_BASE_STATS[selectedClass.id].crit_chance * 100).toFixed(0)}%</span>
                      <span>Crit DMG: {CLASS_BASE_STATS[selectedClass.id].crit_damage}x</span>
                      <span>ATK Speed: {CLASS_BASE_STATS[selectedClass.id].attack_speed}</span>
                      <span>Magic Lvl: {CLASS_BASE_STATS[selectedClass.id].magic_level}</span>
                    </div>
                  </div>
                </div>

                <div className="character-create__growth">
                  <div className="character-create__stats-title">Wzrost na poziom</div>
                  <div className="character-create__growth-grid">
                    <span>+{selectedClass.hpPerLevel} HP</span>
                    <span>+{selectedClass.mpPerLevel} MP</span>
                    <span>+{selectedClass.attackPerLevel} ATK</span>
                    <span>+{selectedClass.defensePerLevel} DEF</span>
                  </div>
                </div>

                <div className="character-create__skills">
                  <div className="character-create__stats-title">Skille</div>
                  <div className="character-create__skill-tags">
                    {selectedClass.skillNames.map((s) => (
                      <span key={s} className="character-create__skill-tag">{s}</span>
                    ))}
                  </div>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="empty"
                className="character-create__detail-empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                Wybierz klasę, aby zobaczyć szczegóły
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
};

export default CharacterCreate;
