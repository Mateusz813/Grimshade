import { useEffect, useMemo, useState } from 'react';
import { deathsApi, type IDeathRecord, type TDeathSource } from '../../api/v1/deathsApi';
import { cachedRead } from '../../lib/queryCache';
import { useGuildTagsStore } from '../../stores/guildTagsStore';
import {
    getBossImageNearest,
    getMonsterImageNearest,
    getDungeonImage,
    getBossCardImage,
} from '../../systems/spriteAssets';
import dungeonsRaw from '../../data/dungeons.json';
import transformsRaw from '../../data/transforms.json';
import bossesRaw from '../../data/bosses.json';
import Spinner from '../../components/ui/Spinner/Spinner';
import Icon from '../../components/atoms/Icon/Icon';
import GameIcon from '../../components/atoms/Twemoji/GameIcon';

import bgBoss from '../../assets/images/battle/battle-boss.png';
import bgDungeon from '../../assets/images/battle/battle-dungeon.png';
import bgRaid from '../../assets/images/battle/battle-raid.png';
import bgTransform from '../../assets/images/battle/battle-transform.png';
import bgHunt from '../../assets/images/battle/battle-polowanie.png';

import './Deaths.scss';

type TFilter = 'all' | TDeathSource;

interface ISourceMeta {
    label: string;
    icon: string;
    color: string;
}

const CLASS_ICONS: Record<string, string> = {
    Knight: 'crossed-swords', Mage: 'crystal-ball', Cleric: 'sparkles', Archer: 'bow-and-arrow',
    Rogue: 'dagger', Necromancer: 'skull', Bard: 'musical-note',
};

const CLASS_COLORS: Record<string, string> = {
    Knight: '#e53935', Mage: '#7b1fa2', Cleric: '#ffc107', Archer: '#4caf50',
    Rogue: '#9e9e9e', Necromancer: '#795548', Bard: '#ff9800',
};

const SOURCE_META: Record<TDeathSource, ISourceMeta> = {
    monster:   { label: 'Potwór',    icon: 'dagger', color: '#ff6b6b' },
    dungeon:   { label: 'Dungeon',   icon: 'castle', color: '#ffa94d' },
    boss:      { label: 'Boss',      icon: 'ogre', color: '#e0348e' },
    transform: { label: 'Transform', icon: 'cyclone', color: '#4dabf7' },
    raid:      { label: 'Rajd',      icon: 'crossed-swords', color: '#9c27b0' },
};

const FILTER_ORDER: TFilter[] = ['all', 'raid', 'boss', 'dungeon', 'transform', 'monster'];

const PAGE_SIZE = 100;

const FETCH_LIMIT = 1000;

const LEAVE_SUFFIX_RE = /\s*\(uciekłeś z gry\)\s*/i;
const cleanSourceName = (s: string): string => s.replace(LEAVE_SUFFIX_RE, '').trim();
const inferResult = (d: IDeathRecord): 'killed' | 'fled' => {
    if (d.result) return d.result;
    if (LEAVE_SUFFIX_RE.test(d.source_name)) return 'fled';
    return 'killed';
};

type GlobMod = { default: string } | string;
const TRANSFORM_FILES = import.meta.glob(
    '../../assets/images/transforms/transform-*.png',
    { eager: true },
) as Record<string, GlobMod>;
const TRANSFORM_IMG_BY_TIER: Map<number, string> = (() => {
    const out = new Map<number, string>();
    for (const [path, mod] of Object.entries(TRANSFORM_FILES)) {
        const m = path.match(/\/transform-(\d+)\.png$/);
        if (!m) continue;
        const tier = Number(m[1]);
        if (!Number.isFinite(tier) || tier <= 0) continue;
        const url = typeof mod === 'string' ? mod : (mod as { default: string }).default;
        if (url) out.set(tier, url);
    }
    return out;
})();

const DUNGEON_ID_BY_NAME: Map<string, string> = (() => {
    const out = new Map<string, string>();
    for (const d of dungeonsRaw as { id: string; name_pl: string }[]) {
        out.set(d.name_pl.toLowerCase(), d.id);
    }
    return out;
})();

const TRANSFORM_TIER_BY_NAME: Map<string, number> = (() => {
    const out = new Map<string, number>();
    for (const t of transformsRaw as { id: number; name_pl: string }[]) {
        out.set(t.name_pl.toLowerCase(), t.id);
    }
    return out;
})();

const BOSS_INDEX_BY_NAME: Map<string, number> = (() => {
    const out = new Map<string, number>();
    (bossesRaw as { name_pl: string }[]).forEach((b, idx) => {
        out.set(b.name_pl.toLowerCase(), idx);
    });
    return out;
})();

const resolvePortrait = (d: IDeathRecord): string | null => {
    switch (d.source) {
        case 'boss':
            return getBossImageNearest(d.source_level);
        case 'monster':
            return getMonsterImageNearest(d.source_level);
        case 'dungeon':
        case 'raid':
        case 'transform':
        default:
            return null;
    }
};

const resolveRowBackground = (d: IDeathRecord): string | null => {
    const cleanName = cleanSourceName(d.source_name).toLowerCase();
    switch (d.source) {
        case 'boss': {
            const idx = BOSS_INDEX_BY_NAME.get(cleanName);
            if (idx !== undefined) {
                const url = getBossCardImage(idx);
                if (url) return url;
            }
            return getBossImageNearest(d.source_level);
        }
        case 'monster':
            return getMonsterImageNearest(d.source_level);
        case 'dungeon': {
            const id = DUNGEON_ID_BY_NAME.get(cleanName);
            return id ? getDungeonImage(id) : null;
        }
        case 'raid': {
            const id = DUNGEON_ID_BY_NAME.get(cleanName);
            return id ? getDungeonImage(id) : null;
        }
        case 'transform': {
            const tier = TRANSFORM_TIER_BY_NAME.get(cleanName)
                ?? TRANSFORM_TIER_BY_NAME.get(cleanName.split(/[(–-]/)[0]?.trim() ?? '');
            return tier ? TRANSFORM_IMG_BY_TIER.get(tier) ?? null : null;
        }
        default:
            return null;
    }
};

const FALLBACK_BG: Record<TDeathSource, string> = {
    boss: bgBoss,
    dungeon: bgDungeon,
    raid: bgRaid,
    transform: bgTransform,
    monster: bgHunt,
};

const formatDateTime = (iso: string): string => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const date = d.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const time = d.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
    return `${date} ${time}`;
};

const formatRelative = (iso: string): string => {
    const past = new Date(iso).getTime();
    if (Number.isNaN(past)) return '';
    const diffMs = Math.max(0, Date.now() - past);
    const sec = Math.floor(diffMs / 1000);
    if (sec < 5) return 'przed chwilą';
    if (sec < 60) return `${sec} sek temu`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min} min temu`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr} godz. temu`;
    const day = Math.floor(hr / 24);
    if (day < 7) return day === 1 ? '1 dzień temu' : `${day} dni temu`;
    const week = Math.floor(day / 7);
    if (week < 5) return week === 1 ? '1 tydz. temu' : `${week} tyg. temu`;
    const month = Math.floor(day / 30);
    if (month < 12) return `${month} mies. temu`;
    const year = Math.floor(day / 365);
    return year === 1 ? '1 rok temu' : `${year} lat temu`;
};

const Deaths = () => {
    const [deaths, setDeaths] = useState<IDeathRecord[]>([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState<TFilter>('all');
    const [page, setPage] = useState(0);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            setLoading(true);
            const data = await cachedRead(`deaths:${FETCH_LIMIT}`, 45_000, () => deathsApi.listRecentDeaths(FETCH_LIMIT));
            if (cancelled) return;
            setDeaths(data);
            setLoading(false);
        })();
        return () => { cancelled = true; };
    }, []);

    useEffect(() => {
        if (deaths.length === 0) return;
        void useGuildTagsStore.getState().resolveTagsByName(deaths.map((d) => d.character_name));
    }, [deaths]);

    useEffect(() => {
        setPage(0);
    }, [filter]);

    const counts = useMemo(() => {
        const c: Record<TFilter, number> = {
            all: deaths.length,
            monster: 0,
            dungeon: 0,
            boss: 0,
            transform: 0,
            raid: 0,
        };
        for (const d of deaths) {
            if (d.source in c) c[d.source as TDeathSource] += 1;
        }
        return c;
    }, [deaths]);

    const filtered = useMemo(
        () => (filter === 'all' ? deaths : deaths.filter((d) => d.source === filter)),
        [filter, deaths],
    );

    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    const safePage = Math.min(page, totalPages - 1);
    const pageStart = safePage * PAGE_SIZE;
    const pageItems = filtered.slice(pageStart, pageStart + PAGE_SIZE);

    return (
        <div className="deaths">
            <div className="deaths__filters">
                {FILTER_ORDER.map((f) => {
                    const meta = f === 'all' ? null : SOURCE_META[f];
                    const label = f === 'all' ? 'Wszystkie' : meta?.label ?? f;
                    const icon = f === 'all' ? 'open-book' : meta?.icon ?? '?';
                    return (
                        <button
                            key={f}
                            className={`deaths__filter${filter === f ? ' deaths__filter--active' : ''}`}
                            onClick={() => setFilter(f)}
                            style={
                                filter === f && meta
                                    ? { background: meta.color, borderColor: meta.color }
                                    : undefined
                            }
                        >
                            <span className="deaths__filter-icon"><GameIcon name={icon} /></span>
                            <span>{label}</span>
                            <span className="deaths__filter-count">{counts[f]}</span>
                        </button>
                    );
                })}
            </div>

            {loading && <div className="deaths__empty"><Spinner /></div>}
            {!loading && filtered.length === 0 && (
                <div className="deaths__empty">
                    Brak zapisanych śmierci{filter !== 'all' ? ' w tej kategorii' : ''}.
                </div>
            )}

            <ul className="deaths__list">
                {pageItems.map((d) => {
                    const meta = SOURCE_META[d.source as TDeathSource] ?? {
                        label: d.source,
                        icon: '?',
                        color: '#9e9e9e',
                    };
                    const classColor = CLASS_COLORS[d.character_class] ?? '#9e9e9e';
                    const classIcon = CLASS_ICONS[d.character_class] ?? '?';
                    const result = inferResult(d);
                    const isFled = result === 'fled';
                    const displaySourceName = cleanSourceName(d.source_name);
                    const portrait = resolvePortrait(d);
                    const bgUrl = resolveRowBackground(d) ?? FALLBACK_BG[d.source as TDeathSource] ?? null;
                    const tag = useGuildTagsStore.getState().getTagByNameSync(d.character_name);
                    return (
                        <li
                            key={d.id}
                            className={`deaths__item deaths__item--${result}`}
                            style={{
                                borderLeftColor: meta.color,
                                ['--deaths-bg-url' as string]: bgUrl ? `url(${bgUrl})` : 'none',
                            }}
                        >
                            <div className="deaths__item-bg" aria-hidden />

                            <div className="deaths__item-content">
                                <div className="deaths__item-chip-row">
                                    <span
                                        className="deaths__item-badge"
                                        style={{ background: meta.color }}
                                        title={meta.label}
                                    >
                                        <GameIcon name={meta.icon} /> {meta.label}
                                    </span>
                                </div>

                                <div className="deaths__item-main">
                                    {portrait && (
                                        <div className="deaths__sprite">
                                            <img
                                                src={portrait}
                                                alt={displaySourceName}
                                                loading="lazy"
                                            />
                                        </div>
                                    )}

                                    <div className="deaths__monster">
                                        {!portrait && (
                                            <span className="deaths__monster-icon" aria-hidden>
                                                <GameIcon name={meta.icon} />
                                            </span>
                                        )}
                                        <span className="deaths__monster-name">{displaySourceName}</span>
                                        <span className="deaths__monster-lvl">Lvl {d.source_level}</span>
                                    </div>

                                    <div className="deaths__verb-wrap">
                                        <span className={`deaths__verb deaths__verb--${result}`}>
                                            <span className="deaths__verb-icon" aria-hidden>
                                                {isFled ? <GameIcon name="ghost" /> : <GameIcon name="skull" />}
                                            </span>
                                            <span className="deaths__verb-text">
                                                {isFled ? 'przegnał' : 'zabił'}
                                            </span>
                                        </span>
                                    </div>

                                    <div className="deaths__victim">
                                        <span className="deaths__victim-class" style={{ color: classColor }}>
                                            <GameIcon name={classIcon} />
                                        </span>
                                        {tag && (
                                            <span className="deaths__victim-tag">{tag}</span>
                                        )}
                                        <span className="deaths__victim-name" style={{ color: classColor }}>
                                            {d.character_name}
                                        </span>
                                        <span className="deaths__victim-lvl">Lvl {d.character_level}</span>
                                    </div>
                                </div>

                                <div className="deaths__item-date">
                                    <span className="deaths__item-date-rel">
                                        {formatRelative(d.died_at)}
                                    </span>
                                    <span className="deaths__item-date-abs">
                                        {formatDateTime(d.died_at)}
                                    </span>
                                </div>
                            </div>
                        </li>
                    );
                })}
            </ul>

            {!loading && totalPages > 1 && (
                <div className="deaths__pager">
                    <button
                        className="deaths__pager-btn"
                        disabled={safePage <= 0}
                        onClick={() => setPage((p) => Math.max(0, p - 1))}
                    >
                        <Icon name="arrowLeft" /> Poprzednia
                    </button>
                    <span className="deaths__pager-info">
                        Strona {safePage + 1} / {totalPages}
                        {' '}
                        <span className="deaths__pager-sub">({filtered.length} wpisów)</span>
                    </span>
                    <button
                        className="deaths__pager-btn"
                        disabled={safePage >= totalPages - 1}
                        onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                    >
                        Następna <Icon name="arrowRight" />
                    </button>
                </div>
            )}
        </div>
    );
};

export default Deaths;
