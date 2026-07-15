import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import api from '../../api/v1/axiosInstance';
import { useCharacterStore } from '../../stores/characterStore';
import { useGuildTagsStore } from '../../stores/guildTagsStore';
import { ARENA_LEAGUES, ARENA_LEAGUE_LABELS, ARENA_LEAGUE_ICONS } from '../../types/arena';
import { formatGoldShort } from '../../systems/goldFormat';
import Spinner from '../../components/ui/Spinner/Spinner';
import GameIcon from '../../components/atoms/Twemoji/GameIcon';
import { cachedRead } from '../../lib/queryCache';
import './Leaderboard.scss';

const LEADERBOARD_TTL_MS = 45_000;
const lbGet = <T,>(url: string) =>
  cachedRead(url, LEADERBOARD_TTL_MS, () => api.get<T>(url));


interface ILeaderboardEntry {
  id: string;
  name: string;
  class: string;
  value: number;
  secondaryValue?: number;
  valueOverride?: string;
  partyComposition?: Array<{ name: string; class: string }>;
}

const formatDpsCompact = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(2)}K`;
  return n.toLocaleString('pl-PL');
};

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

interface IGuildRow {
  id: string;
  name: string;
  tag: string;
  level: number;
  xp: number;
  boss_tier: number;
  leader_id: string;
  member_cap: number;
}

interface IDeathTotalRow {
  character_id: string;
  character_name: string;
  character_class: string;
  character_level: number;
  deaths_count: number;
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
  | 'crit_damage'
  | 'boss_score'
  | 'arena_killers'
  | 'arena_victims'
  | 'arena_league'
  | 'guilds'
  | 'deaths_total'
  | 'mastery_points'
  | 'quests_oneshot_done'
  | 'quests_daily_done'
  | 'market_items_sold'
  | 'market_items_bought'
  | 'item_upgrades_done'
  | 'skill_upgrades_done'
  | 'best_dps5_solo'
  | 'best_dps5_party';

interface ITabDef {
  key: LeaderboardTab;
  label: string;
  icon: string;
  source: 'characters' | 'weapon_skill' | 'guilds' | 'deaths_total';
  skillName?: string;
  characterColumn?: string;
  order?: 'asc' | 'desc';
  valueLabel: string;
}

const ROW_LIMIT = 100;

const TABS: ITabDef[] = [
  { key: 'level',             label: 'LVL',        icon: 'star', source: 'characters',     characterColumn: 'level',              order: 'desc', valueLabel: 'Lvl' },
  { key: 'magic_level',       label: 'MLVL',       icon: 'crystal-ball', source: 'weapon_skill',   skillName: 'magic_level',              valueLabel: 'MLvl' },
  { key: 'sword_fighting',    label: 'Sword',      icon: 'crossed-swords', source: 'weapon_skill',   skillName: 'sword_fighting',           valueLabel: 'Sword' },
  { key: 'dagger_fighting',   label: 'Dagger',     icon: 'dagger', source: 'weapon_skill',   skillName: 'dagger_fighting',          valueLabel: 'Dagger' },
  { key: 'distance_fighting', label: 'Dist',       icon: 'bow-and-arrow', source: 'weapon_skill',   skillName: 'distance_fighting',        valueLabel: 'Dist' },
  { key: 'bard_level',        label: 'Bard',       icon: 'musical-note', source: 'weapon_skill',   skillName: 'bard_level',               valueLabel: 'Bard' },
  { key: 'shielding',         label: 'Shield',     icon: 'shield', source: 'weapon_skill',   skillName: 'shielding',                valueLabel: 'Shield' },
  { key: 'attack_speed',      label: 'AS',         icon: 'high-voltage', source: 'weapon_skill',   skillName: 'attack_speed',             valueLabel: 'AS' },
  { key: 'max_hp',            label: 'HP',         icon: 'red-heart', source: 'weapon_skill',   skillName: 'max_hp',                   valueLabel: 'HP' },
  { key: 'max_mp',            label: 'MP',         icon: 'droplet', source: 'weapon_skill',   skillName: 'max_mp',                   valueLabel: 'MP' },
  { key: 'hp_regen',          label: 'HP Reg',     icon: 'growing-heart', source: 'weapon_skill',   skillName: 'hp_regen',                 valueLabel: 'HP Reg' },
  { key: 'mp_regen',          label: 'MP Reg',     icon: 'gem-stone', source: 'weapon_skill',   skillName: 'mp_regen',                 valueLabel: 'MP Reg' },
  { key: 'defense',           label: 'DEF',        icon: 'shield', source: 'weapon_skill',   skillName: 'defense',                  valueLabel: 'DEF' },
  { key: 'crit_chance',       label: 'Crit %',     icon: 'bullseye', source: 'weapon_skill',   skillName: 'crit_chance',              valueLabel: 'Crit' },
  { key: 'crit_damage',       label: 'Crit DMG',   icon: 'collision', source: 'characters',     characterColumn: 'crit_damage',        order: 'desc', valueLabel: 'CritDmg' },
  { key: 'boss_score',        label: 'Boss',       icon: 'ogre', source: 'weapon_skill',   skillName: 'boss_score',               valueLabel: 'Boss' },
  { key: 'arena_killers',     label: 'Zabójcy',    icon: 'dagger', source: 'characters',    characterColumn: 'arena_kills',         order: 'desc', valueLabel: 'Zabicia' },
  { key: 'arena_victims',     label: 'Ofiary',     icon: 'skull', source: 'characters',    characterColumn: 'arena_deaths',        order: 'desc', valueLabel: 'Śmierci' },
  { key: 'arena_league',      label: 'Arena',      icon: 'stadium', source: 'characters',    characterColumn: 'arena_league_points', order: 'desc', valueLabel: 'LP' },
  { key: 'guilds',            label: 'Gildie',     icon: 'castle', source: 'guilds',                                                                valueLabel: 'Lvl' },
  { key: 'deaths_total',      label: 'Śmierci',    icon: 'coffin', source: 'deaths_total',                                                          valueLabel: 'Śmierci' },
  { key: 'mastery_points',     label: 'Mastery', icon: 'glowing-star', source: 'characters', characterColumn: 'mastery_points',     order: 'desc', valueLabel: 'Mastery' },
  { key: 'quests_oneshot_done',label: 'Questy',  icon: 'scroll', source: 'characters', characterColumn: 'quests_oneshot_done',order: 'desc', valueLabel: 'Questy' },
  { key: 'quests_daily_done',  label: 'Daily',   icon: 'spiral-calendar', source: 'characters', characterColumn: 'quests_daily_done',  order: 'desc', valueLabel: 'Daily' },
  { key: 'market_items_sold',  label: 'Sprzedaż',icon: 'money-bag', source: 'characters', characterColumn: 'market_items_sold',  order: 'desc', valueLabel: 'Sprzedane' },
  { key: 'market_items_bought',label: 'Zakupy',  icon: 'shopping-cart', source: 'characters', characterColumn: 'market_items_bought',order: 'desc', valueLabel: 'Kupione' },
  { key: 'item_upgrades_done', label: 'Ulepszenia', icon: 'hammer', source: 'characters', characterColumn: 'item_upgrades_done', order: 'desc', valueLabel: 'Ulepsz' },
  { key: 'skill_upgrades_done',label: 'Skill UP', icon: 'chart-increasing', source: 'characters', characterColumn: 'skill_upgrades_done',order: 'desc', valueLabel: 'Skill' },
  { key: 'best_dps5_solo',     label: 'DPS Solo',icon: 'high-voltage', source: 'characters', characterColumn: 'best_dps5_solo',    order: 'desc', valueLabel: 'DPS' },
  { key: 'best_dps5_party',    label: 'DPS Party',icon: 'high-voltage', source: 'characters', characterColumn: 'best_dps5_party',   order: 'desc', valueLabel: 'DPS' },
];

const CLASS_ICONS: Record<string, string> = {
  Knight: 'crossed-swords', Mage: 'crystal-ball', Cleric: 'sparkles', Archer: 'bow-and-arrow',
  Rogue: 'dagger', Necromancer: 'skull', Bard: 'musical-note',
};

const RANK_MEDALS = ['1st-place-medal', '2nd-place-medal', '3rd-place-medal'];

const LEAGUE_ORDER: Record<string, number> = Object.fromEntries(
  ARENA_LEAGUES.map((l, i) => [l, i]),
);


const Leaderboard = () => {
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

    try {
      if (tabDef.source === 'characters') {
        const col = tabDef.characterColumn ?? 'level';
        const order = tabDef.order ?? 'desc';
        if (currentTab === 'market_items_sold' || currentTab === 'market_items_bought') {
          const goldCol = currentTab === 'market_items_sold' ? 'market_gold_earned' : 'market_gold_spent';
          const res = await lbGet<Array<Record<string, unknown> & { id: string; name: string; class: string; level: number; created_at: string }>>(
            `/rest/v1/characters?select=id,name,class,level,created_at,${col},${goldCol}` +
            `&order=${goldCol}.desc,${col}.desc,level.desc,created_at.asc` +
            `&limit=${ROW_LIMIT}`,
          );
          setEntries((res.data ?? []).map((r) => {
            const count = Number(r[col] ?? 0);
            const gold = Number(r[goldCol] ?? 0);
            return {
              id: r.id,
              name: r.name,
              class: r.class,
              value: gold,
              valueOverride: `${count.toLocaleString('pl-PL')} · ${formatGoldShort(gold)}`,
            };
          }));
        } else if (currentTab === 'best_dps5_solo' || currentTab === 'best_dps5_party') {
          const selectExtra = currentTab === 'best_dps5_party' ? ',best_dps5_party_composition' : '';
          const res = await lbGet<Array<Record<string, unknown> & { id: string; name: string; class: string }>>(
            `/rest/v1/characters?select=id,name,class,${col}${selectExtra}&order=${col}.desc&limit=${ROW_LIMIT}`,
          );
          setEntries((res.data ?? []).map((r) => {
            const dps = Number(r[col] ?? 0);
            let composition: Array<{ name: string; class: string }> | undefined;
            if (currentTab === 'best_dps5_party') {
              const raw = r['best_dps5_party_composition'];
              if (typeof raw === 'string' && raw.trim()) {
                try {
                  const parsed = JSON.parse(raw) as unknown;
                  if (Array.isArray(parsed)) {
                    composition = parsed
                      .filter((m): m is { name: string; class: string } =>
                        typeof m === 'object'
                        && m !== null
                        && typeof (m as { name?: unknown }).name === 'string'
                        && typeof (m as { class?: unknown }).class === 'string',
                      )
                      .slice(0, 4);
                  }
                } catch { }
              }
            }
            return {
              id: r.id,
              name: r.name,
              class: r.class,
              value: dps,
              valueOverride: `DPS ${formatDpsCompact(dps)}`,
              partyComposition: composition,
            };
          }));
        } else if (currentTab === 'arena_league') {
          const res = await lbGet<Array<{ id: string; name: string; class: string; arena_league: string; arena_league_points: number }>>(
            `/rest/v1/characters?select=id,name,class,arena_league,arena_league_points&order=arena_league_points.desc&limit=500`,
          );
          const rows = res.data ?? [];
          const sorted = rows.slice().sort((a, b) => {
            const la = LEAGUE_ORDER[a.arena_league] ?? -1;
            const lb = LEAGUE_ORDER[b.arena_league] ?? -1;
            if (la !== lb) return lb - la;
            return b.arena_league_points - a.arena_league_points;
          }).slice(0, ROW_LIMIT);
          setEntries(sorted.map((r) => ({
            id: r.id,
            name: r.name,
            class: r.class,
            value: r.arena_league_points,
            valueOverride: `${ARENA_LEAGUE_ICONS[r.arena_league as keyof typeof ARENA_LEAGUE_ICONS] ?? ''} ${ARENA_LEAGUE_LABELS[r.arena_league as keyof typeof ARENA_LEAGUE_LABELS] ?? r.arena_league} · ${r.arena_league_points} LP`,
          })));
        } else {
          const res = await lbGet<Array<Record<string, unknown> & { id: string; name: string; class: string }>>(
            `/rest/v1/characters?select=id,name,class,${col}&order=${col}.${order}&limit=${ROW_LIMIT}`,
          );
          setEntries(
            (res.data ?? []).map((r) => ({
              id: r.id,
              name: r.name,
              class: r.class,
              value: Number(r[col] ?? 0),
            })),
          );
        }
      } else if (tabDef.source === 'weapon_skill' && tabDef.skillName) {
        const skillRes = await lbGet<ISkillRow[]>(
          `/rest/v1/character_weapon_skills?select=skill_level,skill_xp,character_id&skill_name=eq.${tabDef.skillName}&order=skill_level.desc,skill_xp.desc&limit=${ROW_LIMIT}`,
        );
        const skillRows = skillRes.data ?? [];

        if (skillRows.length > 0) {
          const charIds = [...new Set(skillRows.map((r) => r.character_id))];
          const charIdsParam = charIds.map((id) => `"${id}"`).join(',');
          const charRes = await lbGet<ICharacterInfo[]>(
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
      } else if (tabDef.source === 'guilds') {
        const res = await lbGet<IGuildRow[]>(
          `/rest/v1/guilds?select=id,name,tag,level,xp,boss_tier,leader_id,member_cap&order=level.desc,xp.desc&limit=${ROW_LIMIT}`,
        );
        const rows = res.data ?? [];
        setEntries(rows.map((g) => ({
          id: g.id,
          name: `[${g.tag}] ${g.name}`,
          class: 'Guild',
          value: g.level,
          valueOverride: `Lvl ${g.level} · ${g.xp.toLocaleString('pl-PL')} XP · Tier ${g.boss_tier}`,
        })));
      } else if (tabDef.source === 'deaths_total') {
        const res = await lbGet<IDeathTotalRow[]>(
          `/rest/v1/character_death_totals?select=*&order=deaths_count.desc&limit=${ROW_LIMIT}`,
        );
        const rows = res.data ?? [];
        setEntries(rows.map((r) => ({
          id: r.character_id,
          name: r.character_name,
          class: r.character_class,
          value: r.deaths_count,
        })));
      }
    } catch {
      setError('Nie udalo sie zaladowac rankingu. Sprawdz polaczenie.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void fetchLeaderboard(tab); }, [tab]);

  useEffect(() => {
    if (entries.length === 0) return;
    void useGuildTagsStore.getState().resolveTagsByName(entries.map((e) => e.name));
  }, [entries]);

  const myRank = character
    ? entries.findIndex((e) => e.id === character.id) + 1
    : 0;

  const formatValue = (entry: ILeaderboardEntry): string => {
    if (entry.valueOverride) return entry.valueOverride;
    return `${activeTabDef.valueLabel} ${entry.value.toLocaleString('pl-PL')}`;
  };

  return (
    <div className="leaderboard">

      {character && myRank > 0 && (
        <div className="leaderboard__my-rank">
          Twoja pozycja: <strong>#{myRank}</strong> — {character.name}
        </div>
      )}

      <nav className="leaderboard__tabs page-tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`leaderboard__tab page-tab${tab === t.key ? ' leaderboard__tab--active page-tab--active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            <span className="leaderboard__tab-icon"><GameIcon name={t.icon} /></span>
            <span className="leaderboard__tab-label">{t.label}</span>
          </button>
        ))}
      </nav>

      {loading && <div className="leaderboard__loading"><Spinner /></div>}
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
              const icon    = CLASS_ICONS[entry.class] ?? (entry.class === 'Guild' ? 'castle' : '?');

              const isPartyDpsRow = !!entry.partyComposition && entry.partyComposition.length > 0;
              return (
                <div
                  key={entry.id}
                  className={`leaderboard__row${isMe ? ' leaderboard__row--me' : ''}${rank <= 3 ? ` leaderboard__row--top${rank}` : ''}${isPartyDpsRow ? ' leaderboard__row--party' : ''}`}
                >
                  <span className="leaderboard__rank">{RANK_MEDALS[i] ? <GameIcon name={medal} /> : medal}</span>
                  {isPartyDpsRow ? (
                    <div className="leaderboard__party-stack">
                      {entry.partyComposition!.map((m, idx) => (
                        <div key={`${entry.id}-${idx}`} className="leaderboard__party-member">
                          <span className="leaderboard__party-icon"><GameIcon name={CLASS_ICONS[m.class] ?? '?'} /></span>
                          <span className="leaderboard__party-name">{m.name}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <>
                      <span className="leaderboard__icon">{icon === '?' ? '?' : <GameIcon name={icon} />}</span>
                      <div className="leaderboard__info-col">
                        <span className="leaderboard__name">
                            {(() => {
                                if (entry.class === 'Guild') return entry.name;
                                const tag = useGuildTagsStore.getState().getTagByNameSync(entry.name);
                                return tag ? `${tag} ${entry.name}` : entry.name;
                            })()}
                        </span>
                      </div>
                    </>
                  )}
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
