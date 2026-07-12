import { useState } from 'react';
import type { ReactNode } from 'react';
import { useCombatHudStore } from '../../../stores/combatHudStore';
import CombatBackpackModal from './CombatBackpackModal';
import CombatLogsModal from './CombatLogsModal';
import GameIcon from '../../atoms/Twemoji/GameIcon';

interface IProps {
    xp?: { current: number; max: number; level: number } | null;
    xpPerHour?: number;
    xpBonusPct?: number;
    showBackpackPing?: boolean;
    waveControl?: ReactNode;
    tally?: ReactNode;
}

const formatRate = (n: number): string => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
    return String(n);
};

const CombatSubControls = ({
    xp,
    xpPerHour = 0,
    xpBonusPct = 0,
    showBackpackPing,
    waveControl,
    tally,
}: IProps) => {
    const [bagOpen, setBagOpen] = useState(false);
    const [logOpen, setLogOpen] = useState(false);

    const compact = useCombatHudStore((s) => s.compact);

    const xpPct = xp && xp.max > 0
        ? Math.max(0, Math.min(100, (xp.current / xp.max) * 100))
        : 0;

    const hasExtras = Boolean(waveControl || tally);
    const rowCls = `combat-ui__sub-row${hasExtras ? ' combat-ui__sub-row--with-extras' : ''}`;

    return (
        <div className="combat-ui__sub-controls">
            {!compact && (
                <div className={rowCls}>
                    {tally && (
                        <div className="combat-ui__sub-tally-slot">{tally}</div>
                    )}
                    {waveControl && (
                        <div className="combat-ui__sub-wave-slot">{waveControl}</div>
                    )}
                    <div className="combat-ui__sub-actions">
                        <button
                            type="button"
                            className={`combat-ui__sub-bag${showBackpackPing ? ' combat-ui__sub-bag--ping' : ''}`}
                            onClick={() => setBagOpen(true)}
                            aria-label="Łup tej sesji"
                        >
                            <GameIcon name="backpack" />
                        </button>
                        <button
                            type="button"
                            className="combat-ui__sub-logs"
                            onClick={() => setLogOpen(true)}
                            aria-label="Logi walki"
                        >
                            <GameIcon name="clipboard" />
                        </button>
                    </div>
                </div>
            )}

            {compact && (
                <button
                    type="button"
                    className="combat-ui__sub-logs combat-ui__sub-logs--floating"
                    onClick={() => setLogOpen(true)}
                    aria-label="Logi walki"
                >
                    <GameIcon name="clipboard" />
                </button>
            )}

            {xp && (
                <div
                    className="combat-ui__sub-xp"
                    title={`Lv ${xp.level} – ${xp.current}/${xp.max} XP${xpPerHour > 0 ? ` · ${xpPerHour.toLocaleString('pl-PL')} XP/h` : ''}${xpBonusPct > 0 ? ` · +${Math.round(xpBonusPct * 100)}% bonus` : ''}`}
                >
                    <span className="combat-ui__sub-xp-fill" style={{ width: `${xpPct}%` }} />
                    <span className="combat-ui__sub-xp-text">
                        <span>Lv {xp.level} · {Math.round(xpPct)}%</span>
                        {xpPerHour > 0 && (
                            <span className="combat-ui__sub-xp-rate">
                                {formatRate(xpPerHour)} XP/h
                                {xpBonusPct > 0 && (
                                    <span className="combat-ui__sub-xp-bonus"> +{Math.round(xpBonusPct * 100)}%</span>
                                )}
                            </span>
                        )}
                    </span>
                </div>
            )}

            {bagOpen && !compact && <CombatBackpackModal onClose={() => setBagOpen(false)} />}
            {logOpen && <CombatLogsModal onClose={() => setLogOpen(false)} />}
        </div>
    );
};

export default CombatSubControls;
