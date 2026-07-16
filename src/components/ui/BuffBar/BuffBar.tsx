import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useBuffStore } from '../../../stores/buffStore';
import { useInventoryStore } from '../../../stores/inventoryStore';
import { getElixirImage } from '../../../systems/spriteAssets';
import TinyIcon from '../TinyIcon/TinyIcon';
import GameIcon from '../../atoms/Twemoji/GameIcon';
import Icon from '../../atoms/Icon/Icon';
import './BuffBar.scss';

const CHARACTERLESS_ROUTES = [
    '/login',
    '/register',
    '/forgot-password',
    '/character-select',
    '/create-character',
];

const formatTimeLeft = (ms: number): string => {
    if (ms <= 0) return 'wygasl';
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
    if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`;
    return `${s}s`;
};

const BuffBar = () => {
    const location = useLocation();
    const cleanExpired = useBuffStore((s) => s.cleanExpired);
    const getActiveBuffs = useBuffStore((s) => s.getActiveBuffs);
    const allBuffs = useBuffStore((s) => s.allBuffs);
    const [, setTick] = useState(0);
    const [collapsed, setCollapsed] = useState(false);

    const consumables = useInventoryStore((s) => s.consumables);
    const aolCount = consumables['amulet_of_loss'] ?? 0;
    const deathProtCount = consumables['death_protection'] ?? 0;

    const isCharacterless = CHARACTERLESS_ROUTES.some((r) => location.pathname.startsWith(r));
    const active = isCharacterless ? [] : getActiveBuffs();

    useEffect(() => {
        const TICK = 250;
        const interval = setInterval(() => {
            const mult = useBuffStore.getState().combatSpeedMult;
            useBuffStore.getState().tickGameTimeBuffs(TICK, mult);
            cleanExpired();
            setTick((t) => t + 1);
        }, TICK);
        return () => clearInterval(interval);
    }, [cleanExpired, allBuffs.length]);

    const now = Date.now();
    if (isCharacterless) return null;
    const totalCount = active.length + (aolCount > 0 ? 1 : 0) + (deathProtCount > 0 ? 1 : 0);
    if (totalCount === 0) return null;

    return (
        <div className={`buff-bar${collapsed ? ' buff-bar--collapsed' : ''}`}>
            <button
                className="buff-bar__toggle"
                onClick={() => setCollapsed((c) => !c)}
                title={collapsed ? 'Pokaż buffy' : 'Schowaj buffy'}
            >
                {collapsed ? <><GameIcon name="sparkles" /> {totalCount}</> : <Icon name="x" />}
            </button>

            {!collapsed && (
                <>
                    {deathProtCount > 0 && (
                        <div className="buff-bar__pill buff-bar__pill--protection" title="Eliksir Ochrony – chroni przed utratą poziomu i przedmiotów przy następnej śmierci">
                            <span className="buff-bar__icon">
                                <TinyIcon icon={getElixirImage('death_protection') ?? 'shield'} size="sm" />
                            </span>
                            <span className="buff-bar__name">Ochrona</span>
                            <span className="buff-bar__time">×{deathProtCount}</span>
                        </div>
                    )}
                    {aolCount > 0 && (
                        <div className="buff-bar__pill buff-bar__pill--protection" title="Amulet of Loss – chroni przedmioty przy następnej śmierci">
                            <span className="buff-bar__icon">
                                <TinyIcon icon={getElixirImage('amulet_of_loss') ?? 'trident-emblem'} size="sm" />
                            </span>
                            <span className="buff-bar__name">AOL</span>
                            <span className="buff-bar__time">×{aolCount}</span>
                        </div>
                    )}
                    {active.map((buff) => {
                        const isCharge = (buff.charges ?? 0) > 0;
                        const isGame = buff.timerMode === 'game';
                        const isPausable = buff.timerMode === 'pausable';
                        const remaining = isGame
                            ? (buff.gameMsRemaining ?? 0)
                            : (isPausable ? buff.remainingMs : (buff.expiresAt - now));
                        const isLow = !isCharge && remaining < 60000;
                        return (
                            <div key={buff.id} className={`buff-bar__pill${isLow ? ' buff-bar__pill--low' : ''}${isCharge ? ' buff-bar__pill--charge' : ''}`}>
                                <span className="buff-bar__icon"><TinyIcon icon={buff.icon} size="sm" /></span>
                                <span className="buff-bar__name">{buff.name}</span>
                                <span className="buff-bar__time">
                                    {isCharge
                                        ? `×${buff.charges}${buff.maxCharges ? ` / ${buff.maxCharges}` : ''}`
                                        : formatTimeLeft(remaining)}
                                </span>
                            </div>
                        );
                    })}
                </>
            )}
        </div>
    );
};

export default BuffBar;
