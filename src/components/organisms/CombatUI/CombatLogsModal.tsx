import { useEffect, useMemo, useRef, useState } from 'react';
import EmojiText from '../../atoms/Twemoji/EmojiText';
import GameIcon from '../../atoms/Twemoji/GameIcon';
import { useCombatStore } from '../../../stores/combatStore';
import { useCharacterStore } from '../../../stores/characterStore';
import { usePartyStore } from '../../../stores/partyStore';
import { getSkillDef } from '../../../systems/skillBuffs';

interface IProps {
    onClose: () => void;
}


type TFilterKey = 'me' | 'ally' | 'monster' | 'loot' | 'other';

interface IFilterDef {
    key: TFilterKey;
    label: string;
    icon: string;
}

const FILTERS: readonly IFilterDef[] = [
    { key: 'me',      label: 'Moje ataki',    icon: 'crossed-swords' },
    { key: 'ally',    label: 'Sojusznicy',    icon: 'shield' },
    { key: 'monster', label: 'Potwór',        icon: 'ogre' },
    { key: 'loot',    label: 'Drop / XP',     icon: 'money-bag' },
    { key: 'other',   label: 'Inne',          icon: 'clipboard' },
];

const bucketOf = (
    type: 'player' | 'monster' | 'crit' | 'system' | 'loot' | 'block' | 'dodge' | 'dualwield',
    text: string,
): TFilterKey => {
    if (type === 'loot') return 'loot';
    if (type === 'monster') return 'monster';
    if (type === 'crit') {
        if (text.startsWith('Atakujesz') || text.includes('cię za')) return 'me';
        return 'monster';
    }
    if (type === 'block' || type === 'dodge') return 'me';
    if (type === 'player' || type === 'dualwield') {
        if (text.startsWith('[') && text.includes(']')) return 'ally';
        if (text.startsWith('skull') || text.startsWith('bow-and-arrow') || text.startsWith('skull-and-crossbones')) {
            return 'me';
        }
        return 'me';
    }
    if (text.startsWith(':fire: Mastery') || text.includes('Mastery Lvl')) return 'loot';
    if (text.startsWith('Awans!') || text.startsWith('star')) return 'loot';
    return 'other';
};

const colorClassOf = (
    type: string,
    text: string,
): string => {
    if (type === 'loot') return 'combat-log--loot';
    if (type === 'crit') {
        if (text.startsWith('[')) return 'combat-log--ally-crit';
        if (text.startsWith('Atakujesz') || text.includes('cię za')) return 'combat-log--my-crit';
        return 'combat-log--monster-crit';
    }
    if (type === 'monster') return 'combat-log--monster';
    if (type === 'block' || type === 'dodge') return 'combat-log--my';
    if (type === 'player' || type === 'dualwield') {
        if (text.startsWith('[') && text.includes(']')) return 'combat-log--ally';
        return 'combat-log--my';
    }
    return 'combat-log--other';
};

const translateSkillIds = (text: string): string => {
    return text.replace(/\b([a-z][a-z0-9]+(?:_[a-z0-9]+)+)\b/g, (match) => {
        const def = getSkillDef(match);
        if (def?.name_pl) return def.name_pl;
        if (def?.name_en) return def.name_en;
        return match
            .split('_')
            .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
            .join(' ');
    });
};

const CombatLogsModal = ({ onClose }: IProps) => {
    const log = useCombatStore((s) => s.sessionLog);
    const scrollRef = useRef<HTMLDivElement>(null);
    const character = useCharacterStore((s) => s.character);
    const party     = usePartyStore((s) => s.party);

    const [filters, setFilters] = useState<Record<TFilterKey, boolean>>({
        me: true, ally: true, monster: true, loot: true, other: true,
    });

    const toggle = (k: TFilterKey) =>
        setFilters((prev) => ({ ...prev, [k]: !prev[k] }));

    const filtered = useMemo(() => {
        return log.filter((entry) => {
            const b = bucketOf(entry.type, entry.text);
            return filters[b];
        });
    }, [log, filters]);

    useEffect(() => {
        const el = scrollRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [filtered.length]);

    const myName = character?.name ?? '';
    const allyNames = (party?.members ?? [])
        .filter((m) => m.id !== character?.id && !m.isBot)
        .map((m) => m.name);

    return (
        <div className="combat-ui__modal-bg" onClick={onClose}>
            <div className="combat-ui__modal combat-ui__modal--logs" onClick={(e) => e.stopPropagation()}>
                <header className="combat-ui__modal-head">
                    <span className="combat-ui__modal-title"><GameIcon name="clipboard" /> Logi walki ({filtered.length})</span>
                    <button type="button" className="combat-ui__modal-close" onClick={onClose} aria-label="Zamknij">×</button>
                </header>

                <div
                    className="combat-ui__modal-log-filters"
                    style={{
                        display: 'flex',
                        gap: 6,
                        padding: '8px 12px',
                        flexWrap: 'wrap',
                        borderBottom: '1px solid rgba(255,255,255,0.08)',
                    }}
                >
                    {FILTERS.map((f) => {
                        const active = filters[f.key];
                        return (
                            <button
                                key={f.key}
                                type="button"
                                onClick={() => toggle(f.key)}
                                style={{
                                    background: active ? 'rgba(120,180,255,0.18)' : 'rgba(255,255,255,0.04)',
                                    border: active ? '1px solid rgba(120,180,255,0.55)' : '1px solid rgba(255,255,255,0.12)',
                                    color: active ? '#dceaff' : 'rgba(255,255,255,0.5)',
                                    padding: '4px 10px',
                                    borderRadius: 14,
                                    fontSize: '0.85em',
                                    cursor: 'pointer',
                                    transition: 'all 120ms ease',
                                }}
                                aria-pressed={active}
                                title={`${active ? 'Wyłącz' : 'Włącz'} filtr: ${f.label}`}
                            >
                                <GameIcon name={f.icon} /> {f.label}
                            </button>
                        );
                    })}
                </div>

                <div className="combat-ui__modal-log-scroll" ref={scrollRef}>
                    {filtered.length === 0 ? (
                        <p className="combat-ui__modal-empty">Brak logów dla wybranych filtrów.</p>
                    ) : (
                        <ul className="combat-ui__modal-log-list">
                            {filtered.map((entry) => {
                                const colorClass = colorClassOf(entry.type, entry.text);
                                let text = translateSkillIds(entry.text);
                                if (entry.type === 'crit') {
                                    if (!text.includes('KRYTYK')) {
                                        text = text.replace(':high-voltage:', ':high-voltage:KRYTYK');
                                    }
                                }
                                const isAllyLine = colorClass === 'combat-ui__modal-log-row--ally';
                                if (isAllyLine && !text.startsWith('[')) {
                                    const guess = allyNames[0] ?? 'Sojusznik';
                                    text = `[${guess}] ${text}`;
                                }
                                return (
                                    <li
                                        key={entry.id}
                                        className={`combat-ui__modal-log-row combat-ui__modal-log-row--${entry.type} ${colorClass}`}
                                        style={(() => {
                                            switch (colorClass) {
                                                case 'combat-log--my':
                                                    return { color: '#7fff7f' };
                                                case 'combat-log--my-crit':
                                                    return { color: '#ffd24a', fontWeight: 700 };
                                                case 'combat-log--ally':
                                                    return { color: '#67b3ff' };
                                                case 'combat-log--ally-crit':
                                                    return { color: '#a8d4ff', fontWeight: 700 };
                                                case 'combat-log--monster':
                                                    return { color: '#ff6e6e' };
                                                case 'combat-log--monster-crit':
                                                    return { color: '#ff9a4a', fontWeight: 700 };
                                                case 'combat-log--loot':
                                                    return { color: '#ffd86a' };
                                                default:
                                                    return undefined;
                                            }
                                        })()}
                                    >
                                        <EmojiText>{text}</EmojiText>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </div>
                {myName && (
                    <div
                        style={{
                            padding: '4px 12px 8px',
                            fontSize: '0.75em',
                            color: 'rgba(255,255,255,0.4)',
                            textAlign: 'center',
                        }}
                    >
                        Twój nick: <strong>{myName}</strong>
                        {allyNames.length > 0 && <> · Sojusznicy: {allyNames.join(', ')}</>}
                    </div>
                )}
            </div>
        </div>
    );
};

export default CombatLogsModal;
