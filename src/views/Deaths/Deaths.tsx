import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { deathsApi, type IDeathRecord, type TDeathSource } from '../../api/v1/deathsApi';
import './Deaths.scss';

type TFilter = 'all' | TDeathSource;

interface ISourceMeta {
    label: string;
    icon: string;
    color: string;
}

const CLASS_ICONS: Record<string, string> = {
    Knight: '⚔️', Mage: '🔮', Cleric: '✨', Archer: '🏹',
    Rogue: '🗡️', Necromancer: '💀', Bard: '🎵',
};

const CLASS_COLORS: Record<string, string> = {
    Knight: '#e53935', Mage: '#7b1fa2', Cleric: '#ffc107', Archer: '#4caf50',
    Rogue: '#9e9e9e', Necromancer: '#795548', Bard: '#ff9800',
};

const SOURCE_META: Record<TDeathSource, ISourceMeta> = {
    monster:   { label: 'Potwór',   icon: '🗡️', color: '#ff6b6b' },
    dungeon:   { label: 'Dungeon',  icon: '🏰', color: '#ffa94d' },
    boss:      { label: 'Boss',     icon: '👹', color: '#e0348e' },
    transform: { label: 'Transform', icon: '🌀', color: '#4dabf7' },
};

const FILTER_ORDER: TFilter[] = ['all', 'boss', 'dungeon', 'monster', 'transform'];

const formatDateTime = (iso: string): string => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const date = d.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const time = d.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
    return `${date} ${time}`;
};

const formatRelative = (iso: string): string => {
    const d = new Date(iso).getTime();
    if (Number.isNaN(d)) return '';
    const diffSec = Math.floor((Date.now() - d) / 1000);
    if (diffSec < 60) return `${diffSec}s temu`;
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m temu`;
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h temu`;
    return `${Math.floor(diffSec / 86400)}d temu`;
};

/**
 * Build the short killer description "{source_name} Lvl {source_level}".
 * For transform deaths the source_name already includes transform + monster levels
 * in the form "Transformacja I (Tlvl 30) – Harpia Lvl 13", so we avoid appending
 * another "Lvl X" suffix at the end.
 */
const buildKiller = (d: IDeathRecord): string => {
    const name = d.source_name || '???';
    if (d.source === 'transform') return name;
    return `${name} Lvl ${d.source_level}`;
};

const Deaths = () => {
    const navigate = useNavigate();
    const [deaths, setDeaths] = useState<IDeathRecord[]>([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState<TFilter>('all');

    const loadDeaths = async (): Promise<void> => {
        setLoading(true);
        const data = await deathsApi.listRecentDeaths(200);
        setDeaths(data);
        setLoading(false);
    };

    useEffect(() => {
        void loadDeaths();
    }, []);

    const counts = useMemo(() => {
        const c: Record<TFilter, number> = { all: deaths.length, monster: 0, dungeon: 0, boss: 0, transform: 0 };
        for (const d of deaths) {
            if (d.source in c) c[d.source as TDeathSource] += 1;
        }
        return c;
    }, [deaths]);

    const filtered = useMemo(
        () => (filter === 'all' ? deaths : deaths.filter((d) => d.source === filter)),
        [filter, deaths],
    );

    return (
        <div className="deaths">
            <header className="deaths__header page-header">
                <button className="deaths__back page-back-btn" onClick={() => navigate('/')}>← Miasto</button>
                <h1 className="deaths__title page-title">💀 Księga Śmierci</h1>
                <button className="deaths__refresh" onClick={() => void loadDeaths()} disabled={loading}>
                    {loading ? '⟳' : '↻'}
                </button>
            </header>

            <div className="deaths__filters">
                {FILTER_ORDER.map((f) => {
                    const meta = f === 'all' ? null : SOURCE_META[f];
                    const label = f === 'all' ? 'Wszystkie' : meta?.label ?? f;
                    const icon = f === 'all' ? '📖' : meta?.icon ?? '?';
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
                            <span className="deaths__filter-icon">{icon}</span>
                            <span>{label}</span>
                            <span className="deaths__filter-count">{counts[f]}</span>
                        </button>
                    );
                })}
            </div>

            {loading && <div className="deaths__empty">Ładowanie…</div>}
            {!loading && filtered.length === 0 && (
                <div className="deaths__empty">
                    Brak zapisanych śmierci{filter !== 'all' ? ' w tej kategorii' : ''}.
                </div>
            )}

            <ul className="deaths__list">
                {filtered.map((d) => {
                    const meta = SOURCE_META[d.source as TDeathSource] ?? {
                        label: d.source,
                        icon: '?',
                        color: '#9e9e9e',
                    };
                    const classColor = CLASS_COLORS[d.character_class] ?? '#9e9e9e';
                    const classIcon = CLASS_ICONS[d.character_class] ?? '?';
                    return (
                        <li
                            key={d.id}
                            className="deaths__item"
                            style={{ borderLeftColor: meta.color }}
                        >
                            <div className="deaths__item-row">
                                <span
                                    className="deaths__item-badge"
                                    style={{ background: meta.color }}
                                    title={meta.label}
                                >
                                    {meta.icon} {meta.label}
                                </span>
                                <span className="deaths__item-spacer" />
                                <span className="deaths__item-time" title={formatDateTime(d.died_at)}>
                                    {formatRelative(d.died_at)}
                                </span>
                            </div>
                            <div className="deaths__item-desc">
                                <strong>{buildKiller(d)}</strong> zabił
                                {' '}
                                <span className="deaths__item-class" style={{ color: classColor }}>
                                    {classIcon}
                                </span>
                                {' '}
                                <span className="deaths__item-name" style={{ color: classColor }}>
                                    {d.character_name}
                                </span>
                                {' '}
                                <span className="deaths__item-level">Lvl {d.character_level}</span>
                            </div>
                            <div className="deaths__item-date">{formatDateTime(d.died_at)}</div>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
};

export default Deaths;
