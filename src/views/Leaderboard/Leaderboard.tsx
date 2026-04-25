import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import api from '../../api/v1/axiosInstance';
import { useCharacterStore } from '../../stores/characterStore';
import './Leaderboard.scss';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ILeaderboardEntry {
  id: string;
  name: string;
  class: string;
  value: number;
  secondaryValue?: number;
}

interface ISkillRow {
  skill_level: number;
  skill_xp: number;
  character_id: string;
}

interface ICharacterInfo {
  id: string;
  name: string;
  class: string;
}

type LeaderboardTab =
  | 'level'
  | 'magic_level'
  | 'sword_fighting'
  | 'dagger_fighting'
  | 'distance_fighting'
  | 'bard_level'
  | 'shielding'
  | 'attack_speed'
  | 'max_hp'
  | 'max_mp'
  | 'hp_regen'
  | 'mp_regen'
  | 'defense'
  | 'crit_chance'
  | 'boss_score';

interface ITabDef {
  key: LeaderboardTab;
  label: string;
  icon: string;
  /** 'characters' = query characters table, 'weapon_skill' = query character_weapon_skills */
  source: 'characters' | 'weapon_skill';
  /** For weapon_skill tabs – the skill_name value in the DB */
  skillName?: string;
  /** Label shown next to value */
  valueLabel: string;
}

const TABS: ITabDef[] = [
  { key: 'level',             label: 'LVL',     icon: '⭐', source: 'characters',    valueLabel: 'Lvl' },
  { key: 'magic_level',       label: 'MLVL',    icon: '🔮', source: 'weapon_skill',  skillName: 'magic_level',       valueLabel: 'MLvl' },
  { key: 'sword_fighting',    label: 'Sword',   icon: '⚔️', source: 'weapon_skill',  skillName: 'sword_fighting',    valueLabel: 'Sword' },
  { key: 'dagger_fighting',   label: 'Dagger',  icon: '🗡️', source: 'weapon_skill',  skillName: 'dagger_fighting',   valueLabel: 'Dagger' },
  { key: 'distance_fighting', label: 'Dist',    icon: '🏹', source: 'weapon_skill',  skillName: 'distance_fighting', valueLabel: 'Dist' },
  { key: 'bard_level',        label: 'Bard',    icon: '🎵', source: 'weapon_skill',  skillName: 'bard_level',        valueLabel: 'Bard' },
  { key: 'shielding',         label: 'Shield',  icon: '🛡️', source: 'weapon_skill',  skillName: 'shielding',         valueLabel: 'Shield' },
  { key: 'attack_speed',      label: 'AS',      icon: '⚡', source: 'weapon_skill',  skillName: 'attack_speed',      valueLabel: 'AS' },
  { key: 'max_hp',            label: 'HP',      icon: '❤️', source: 'weapon_skill',  skillName: 'max_hp',            valueLabel: 'HP' },
  { key: 'max_mp',            label: 'MP',      icon: '💧', source: 'weapon_skill',  skillName: 'max_mp',            valueLabel: 'MP' },
  { key: 'hp_regen',          label: 'HP Reg',  icon: '💗', source: 'weapon_skill',  skillName: 'hp_regen',          valueLabel: 'HP Reg' },
  { key: 'mp_regen',          label: 'MP Reg',  icon: '💎', source: 'weapon_skill',  skillName: 'mp_regen',          valueLabel: 'MP Reg' },
  { key: 'defense',           label: 'DEF',     icon: '🛡️', source: 'weapon_skill',  skillName: 'defense',           valueLabel: 'DEF' },
  { key: 'crit_chance',       label: 'Crit',    icon: '🎯', source: 'weapon_skill',  skillName: 'crit_chance',       valueLabel: 'Crit' },
  { key: 'boss_score',        label: 'Boss',    icon: '👹', source: 'weapon_skill',  skillName: 'boss_score',        valueLabel: 'Boss' },
];

const CLASS_ICONS: Record<string, string> = {
  Knight: '⚔️', Mage: '🔮', Cleric: '✨', Archer: '🏹',
  Rogue: '🗡️', Necromancer: '💀', Bard: '🎵',
};

const RANK_MEDALS = ['🥇', '🥈', '🥉'];

// ── Component ─────────────────────────────────────────────────────────────────

const Leaderboard = () => {
  const navigate   = useNavigate();
  const character  = useCharacterStore((s) => s.character);

  const [tab, setTab]           = useState<LeaderboardTab>('level');
  const [entries, setEntries]   = useState<ILeaderboardEntry[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);

  const activeTabDef = TABS.find((t) => t.key === tab)!;

  const fetchLeaderboard = async (currentTab: LeaderboardTab) => {
    const tabDef = TABS.find((t) => t.key === currentTab)!;
    setLoading(true);
    setError(null);

    // ── Server-fetched tabs ───────────────────────────────────────────────────
    try {
      if (tabDef.source === 'characters') {
        const res = await api.get<Array<{ id: string; name: string; class: string; level: number }>>(
          '/rest/v1/characters?select=id,name,class,level&order=level.desc&limit=50',
        );
        setEntries(
          (res.data ?? []).map((r) => ({
            id: r.id,
            name: r.name,
            class: r.class,
            value: r.level,
          })),
        );
      } else if (tabDef.source === 'weapon_skill' && tabDef.skillName) {
        // Two separate queries to avoid Supabase FK relationship requirement
        const skillRes = await api.get<ISkillRow[]>(
          `/rest/v1/character_weapon_skills?select=skill_level,skill_xp,character_id&skill_name=eq.${tabDef.skillName}&order=skill_level.desc,skill_xp.desc&limit=50`,
        );
        const skillRows = skillRes.data ?? [];

        if (skillRows.length > 0) {
          const charIds = [...new Set(skillRows.map((r) => r.character_id))];
          const charIdsParam = charIds.map((id) => `"${id}"`).join(',');
          const charRes = await api.get<ICharacterInfo[]>(
            `/rest/v1/characters?select=id,name,class&id=in.(${charIdsParam})`,
          );
          const charMap = new Map<string, ICharacterInfo>();
          for (const c of charRes.data ?? []) {
            charMap.set(c.id, c);
          }

          setEntries(
            skillRows
              .filter((r) => charMap.has(r.character_id))
              .map((r) => {
                const ch = charMap.get(r.character_id)!;
                return {
                  id: ch.id,
                  name: ch.name,
                  class: ch.class,
                  value: r.skill_level,
                  secondaryValue: r.skill_xp,
                };
              }),
          );
        } else {
          setEntries([]);
        }
      }
    } catch {
      setError('Nie udalo sie zaladowac rankingu. Sprawdz polaczenie.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void fetchLeaderboard(tab); }, [tab]);

  const myRank = character
    ? entries.findIndex((e) => e.id === character.id) + 1
    : 0;

  const formatValue = (entry: ILeaderboardEntry): string => {
    return `${activeTabDef.valueLabel} ${entry.value}`;
  };

  return (
    <div className="leaderboard">
      <header className="leaderboard__header page-header">
        <button className="leaderboard__back page-back-btn" onClick={() => navigate('/')}>← Miasto</button>
        <h1 className="leaderboard__title page-title">🏆 Rankingi</h1>
        <button className="leaderboard__refresh" onClick={() => fetchLeaderboard(tab)}>
          ↻
        </button>
      </header>

      {/* My rank badge */}
      {character && myRank > 0 && (
        <div className="leaderboard__my-rank">
          Twoja pozycja: <strong>#{myRank}</strong> — {character.name}
        </div>
      )}

      {/* Tabs – scrollable */}
      <nav className="leaderboard__tabs page-tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`leaderboard__tab page-tab${tab === t.key ? ' leaderboard__tab--active page-tab--active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            <span className="leaderboard__tab-icon">{t.icon}</span>
            <span className="leaderboard__tab-label">{t.label}</span>
          </button>
        ))}
      </nav>

      {/* Content */}
      {loading && <div className="leaderboard__loading">Ladowanie...</div>}
      {error   && <div className="leaderboard__error">{error}</div>}

      {!loading && !error && (
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            className="leaderboard__list"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18 }}
          >
            {entries.length === 0 && (
              <p className="leaderboard__empty">Brak graczy w rankingu.</p>
            )}
            {entries.map((entry, i) => {
              const isMe    = character?.id === entry.id;
              const rank    = i + 1;
              const medal   = RANK_MEDALS[i] ?? `#${rank}`;
              const icon    = CLASS_ICONS[entry.class] ?? '?';

              return (
                <div
                  key={entry.id}
                  className={`leaderboard__row${isMe ? ' leaderboard__row--me' : ''}${rank <= 3 ? ` leaderboard__row--top${rank}` : ''}`}
                >
                  <span className="leaderboard__rank">{medal}</span>
                  <span className="leaderboard__icon">{icon}</span>
                  <div className="leaderboard__info-col">
                    <span className="leaderboard__name">{entry.name}</span>
                    <span className="leaderboard__class">{entry.class}</span>
                  </div>
                  <div className="leaderboard__value">
                    <span className="leaderboard__level">{formatValue(entry)}</span>
                  </div>
                </div>
              );
            })}
          </motion.div>
        </AnimatePresence>
      )}
    </div>
  );
};

export default Leaderboard;
