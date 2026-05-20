import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import api from '../../api/v1/axiosInstance';
import { useCharacterStore } from '../../stores/characterStore';
import { useGuildTagsStore } from '../../stores/guildTagsStore';
import { ARENA_LEAGUES, ARENA_LEAGUE_LABELS, ARENA_LEAGUE_ICONS } from '../../types/arena';
import { formatGoldShort } from '../../systems/goldFormat';
import Spinner from '../../components/ui/Spinner/Spinner';
import './Leaderboard.scss';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ILeaderboardEntry {
  id: string;
  name: string;
  class: string;
  /** Primary sort value, e.g. level / LP / deaths_count. */
  value: number;
  /** Optional secondary value rendered as a faded pill, e.g. XP, lifetime AP. */
  secondaryValue?: number;
  /** Optional label override (e.g. "Bronze · 1240 LP"). */
  valueOverride?: string;
  /**
   * 2026-05-19 v20: optional party composition for the DPS-party
   * leaderboard. When present, the row renders a stack of
   * `{ name, class }` entries on the left instead of the usual
   * single-character row.
   */
  partyComposition?: Array<{ name: string; class: string }>;
}

/**
 * 2026-05-19 v20 spec ("DPS tez konwertuj na K lub M do 2 miejsc po
 * przecinku"): compact DPS formatter — `1234567` → `1.23M`,
 * `42150` → `42.15K`, `987` → `987`. Two decimal places, suffix
 * inline.
 */
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
  // 2026-05-19 v16: activity counters
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
  /**
   * Where the data comes from. Drives the fetch branch:
   *   • `characters`     — read characters table directly
   *   • `weapon_skill`   — read character_weapon_skills + characters
   *   • `guilds`         — read guilds table
   *   • `deaths_total`   — read character_death_totals view
   */
  source: 'characters' | 'weapon_skill' | 'guilds' | 'deaths_total';
  /** Skill name for `weapon_skill` source. */
  skillName?: string;
  /** Column on `characters` for `characters` source. */
  characterColumn?: string;
  /** Order direction. */
  order?: 'asc' | 'desc';
  /** Value label shown next to the entry value. */
  valueLabel: string;
}

// 2026-05-19 v15 spec: every leaderboard tab shows up to 100 entries.
const ROW_LIMIT = 100;

const TABS: ITabDef[] = [
  { key: 'level',             label: 'LVL',        icon: '⭐', source: 'characters',     characterColumn: 'level',              order: 'desc', valueLabel: 'Lvl' },
  { key: 'magic_level',       label: 'MLVL',       icon: '🔮', source: 'weapon_skill',   skillName: 'magic_level',              valueLabel: 'MLvl' },
  { key: 'sword_fighting',    label: 'Sword',      icon: '⚔️', source: 'weapon_skill',   skillName: 'sword_fighting',           valueLabel: 'Sword' },
  { key: 'dagger_fighting',   label: 'Dagger',     icon: '🗡️', source: 'weapon_skill',   skillName: 'dagger_fighting',          valueLabel: 'Dagger' },
  { key: 'distance_fighting', label: 'Dist',       icon: '🏹', source: 'weapon_skill',   skillName: 'distance_fighting',        valueLabel: 'Dist' },
  { key: 'bard_level',        label: 'Bard',       icon: '🎵', source: 'weapon_skill',   skillName: 'bard_level',               valueLabel: 'Bard' },
  { key: 'shielding',         label: 'Shield',     icon: '🛡️', source: 'weapon_skill',   skillName: 'shielding',                valueLabel: 'Shield' },
  { key: 'attack_speed',      label: 'AS',         icon: '⚡', source: 'weapon_skill',   skillName: 'attack_speed',             valueLabel: 'AS' },
  { key: 'max_hp',            label: 'HP',         icon: '❤️', source: 'weapon_skill',   skillName: 'max_hp',                   valueLabel: 'HP' },
  { key: 'max_mp',            label: 'MP',         icon: '💧', source: 'weapon_skill',   skillName: 'max_mp',                   valueLabel: 'MP' },
  { key: 'hp_regen',          label: 'HP Reg',     icon: '💗', source: 'weapon_skill',   skillName: 'hp_regen',                 valueLabel: 'HP Reg' },
  { key: 'mp_regen',          label: 'MP Reg',     icon: '💎', source: 'weapon_skill',   skillName: 'mp_regen',                 valueLabel: 'MP Reg' },
  { key: 'defense',           label: 'DEF',        icon: '🛡️', source: 'weapon_skill',   skillName: 'defense',                  valueLabel: 'DEF' },
  { key: 'crit_chance',       label: 'Crit %',     icon: '🎯', source: 'weapon_skill',   skillName: 'crit_chance',              valueLabel: 'Crit' },
  // 2026-05-19 v15: crit_damage lives on the characters row (no weapon-skill track), order desc.
  { key: 'crit_damage',       label: 'Crit DMG',   icon: '💥', source: 'characters',     characterColumn: 'crit_damage',        order: 'desc', valueLabel: 'CritDmg' },
  { key: 'boss_score',        label: 'Boss',       icon: '👹', source: 'weapon_skill',   skillName: 'boss_score',               valueLabel: 'Boss' },
  // 2026-05-19 v15 spec ("Dodać do rankingu arenę"): arena tabs sourced from the new
  // characters.arena_* columns added by the leaderboard_migration.sql.
  { key: 'arena_killers',     label: 'Zabójcy',    icon: '🗡️', source: 'characters',    characterColumn: 'arena_kills',         order: 'desc', valueLabel: 'Zabicia' },
  { key: 'arena_victims',     label: 'Ofiary',     icon: '💀', source: 'characters',    characterColumn: 'arena_deaths',        order: 'desc', valueLabel: 'Śmierci' },
  { key: 'arena_league',      label: 'Arena',      icon: '🏟️', source: 'characters',    characterColumn: 'arena_league_points', order: 'desc', valueLabel: 'LP' },
  // 2026-05-19 v15: guild ranking (level desc, then xp desc).
  { key: 'guilds',            label: 'Gildie',     icon: '🏰', source: 'guilds',                                                                valueLabel: 'Lvl' },
  // 2026-05-19 v15: total death count aggregated by character_id.
  { key: 'deaths_total',      label: 'Śmierci',    icon: '⚰️', source: 'deaths_total',                                                          valueLabel: 'Śmierci' },
  // 2026-05-19 v16: activity counters — each maps to a column on
  // characters table populated by the relevant subsystem via
  // `characterApi.bumpStat`.
  { key: 'mastery_points',     label: 'Mastery', icon: '🌟', source: 'characters', characterColumn: 'mastery_points',     order: 'desc', valueLabel: 'Mastery' },
  { key: 'quests_oneshot_done',label: 'Questy',  icon: '📜', source: 'characters', characterColumn: 'quests_oneshot_done',order: 'desc', valueLabel: 'Questy' },
  { key: 'quests_daily_done',  label: 'Daily',   icon: '🗓️', source: 'characters', characterColumn: 'quests_daily_done',  order: 'desc', valueLabel: 'Daily' },
  { key: 'market_items_sold',  label: 'Sprzedaż',icon: '💰', source: 'characters', characterColumn: 'market_items_sold',  order: 'desc', valueLabel: 'Sprzedane' },
  { key: 'market_items_bought',label: 'Zakupy',  icon: '🛒', source: 'characters', characterColumn: 'market_items_bought',order: 'desc', valueLabel: 'Kupione' },
  { key: 'item_upgrades_done', label: 'Ulepszenia', icon: '🔨', source: 'characters', characterColumn: 'item_upgrades_done', order: 'desc', valueLabel: 'Ulepsz' },
  { key: 'skill_upgrades_done',label: 'Skill UP', icon: '📈', source: 'characters', characterColumn: 'skill_upgrades_done',order: 'desc', valueLabel: 'Skill' },
  { key: 'best_dps5_solo',     label: 'DPS Solo',icon: '⚡', source: 'characters', characterColumn: 'best_dps5_solo',    order: 'desc', valueLabel: 'DPS' },
  { key: 'best_dps5_party',    label: 'DPS Party',icon: '⚡', source: 'characters', characterColumn: 'best_dps5_party',   order: 'desc', valueLabel: 'DPS' },
];

const CLASS_ICONS: Record<string, string> = {
  Knight: '⚔️', Mage: '🔮', Cleric: '✨', Archer: '🏹',
  Rogue: '🗡️', Necromancer: '💀', Bard: '🎵',
};

const RANK_MEDALS = ['🥇', '🥈', '🥉'];

// Build the order-position of each arena league (higher index = higher league).
const LEAGUE_ORDER: Record<string, number> = Object.fromEntries(
  ARENA_LEAGUES.map((l, i) => [l, i]),
);

// ── Component ─────────────────────────────────────────────────────────────────

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
        // 2026-05-19 v15 spec ("każdy ranking pokazuje top 100 najlepszych graczy"):
        // bumped from 50 → 100 across all tabs. Special-case arena_league
        // so we sort first by league rank (descending — legend on top),
        // then by LP within the league.
        if (currentTab === 'market_items_sold' || currentTab === 'market_items_bought') {
          // 2026-05-19 v19 spec ("nie zl tylko konwertuj na gp k cc
          // sc itp i sortuj nie od ilosci sprzedanych tylko od
          // wlasnie kwot kto najwiecej wydal i zarobil jezeli tyle
          // samo to wtedy kto wiecej, a jezeli maja wszystko tak
          // samo to potem po lvl a potem po dacie"): order primarily
          // by GOLD value, then by item count, then by level, then
          // by creation date. Gold formatted via the canonical
          // formatGoldShort (gp / k / cc / sc / etc.).
          // 2026-05-19 v20 spec ("Na malych ekranach sie nie miesci
          // tresc usun napis zarobione i sprzedane oraz wydane i
          // kupione"): pruned the human-readable verbs — every row
          // now reads as `N · formatGold` so it fits in a 360-px
          // phone column without truncating. The tab icon
          // (💰 / 🛒) already implies which side of the trade is
          // being measured.
          const goldCol = currentTab === 'market_items_sold' ? 'market_gold_earned' : 'market_gold_spent';
          const res = await api.get<Array<Record<string, unknown> & { id: string; name: string; class: string; level: number; created_at: string }>>(
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
          // 2026-05-19 v20: DPS tabs format the score with K / M
          // suffix + 2-decimal precision. The party tab also pulls
          // the composition snapshot so each row shows the full
          // party stack (4 nicks + class icons) instead of just the
          // credited player.
          const selectExtra = currentTab === 'best_dps5_party' ? ',best_dps5_party_composition' : '';
          const res = await api.get<Array<Record<string, unknown> & { id: string; name: string; class: string }>>(
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
                } catch { /* malformed JSON — fall back to single-row */ }
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
          const res = await api.get<Array<{ id: string; name: string; class: string; arena_league: string; arena_league_points: number }>>(
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
          const res = await api.get<Array<Record<string, unknown> & { id: string; name: string; class: string }>>(
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
        const skillRes = await api.get<ISkillRow[]>(
          `/rest/v1/character_weapon_skills?select=skill_level,skill_xp,character_id&skill_name=eq.${tabDef.skillName}&order=skill_level.desc,skill_xp.desc&limit=${ROW_LIMIT}`,
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
      } else if (tabDef.source === 'guilds') {
        // 2026-05-19 v15 spec ("Dodajemy w rankingu zakładkę gildie i
        // ich zdobyte punkty od najwyższej do najniższej"): rank guilds
        // by level desc, then xp desc for the within-level tiebreak.
        // We piggy-back on the existing leaderboard row shape, so the
        // "class" slot displays the guild tag and "name" the guild name.
        const res = await api.get<IGuildRow[]>(
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
        // 2026-05-19 v15 spec ("Dodajemy zakladke smierci ktora zlicza
        // ilosc smierci podczas gry"): aggregate from the
        // `character_death_totals` VIEW provisioned by
        // `scripts/leaderboard_migration.sql`. The view groups by
        // character_id with COUNT(*) so we can sort by deaths_count desc
        // server-side.
        const res = await api.get<IDeathTotalRow[]>(
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
      {/* 2026-05-19 v15 spec ("Kasujemy napis miasto i box caly z
          powrotem do miasta"): the back-to-Miasto header row is gone;
          navigation lives in the bottom-nav. The list starts straight
          from the tab bar so vertical space goes to the rankings. */}

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
              const icon    = CLASS_ICONS[entry.class] ?? (entry.class === 'Guild' ? '🏰' : '?');

              // 2026-05-19 v20 spec ("jezeli walcze z botami to
              // napisz np w miejscu pierwszym 4 nicki jeden pod
              // drugim z ikonkami klasy i na koncu na srodku po
              // prawej DPS laczny"): party-DPS tab renders the
              // captured party composition stack (4 nicks + class
              // icons) instead of the single-character row. Every
              // other tab uses the normal single-character layout.
              const isPartyDpsRow = !!entry.partyComposition && entry.partyComposition.length > 0;
              return (
                <div
                  key={entry.id}
                  className={`leaderboard__row${isMe ? ' leaderboard__row--me' : ''}${rank <= 3 ? ` leaderboard__row--top${rank}` : ''}${isPartyDpsRow ? ' leaderboard__row--party' : ''}`}
                >
                  <span className="leaderboard__rank">{medal}</span>
                  {isPartyDpsRow ? (
                    <div className="leaderboard__party-stack">
                      {entry.partyComposition!.map((m, idx) => (
                        <div key={`${entry.id}-${idx}`} className="leaderboard__party-member">
                          <span className="leaderboard__party-icon">{CLASS_ICONS[m.class] ?? '?'}</span>
                          <span className="leaderboard__party-name">{m.name}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <>
                      <span className="leaderboard__icon">{icon}</span>
                      <div className="leaderboard__info-col">
                        <span className="leaderboard__name">
                            {(() => {
                                // Guild rows already embed the tag inline, so skip the player-tag prefix lookup.
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
