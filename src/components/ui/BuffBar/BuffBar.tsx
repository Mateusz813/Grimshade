import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useBuffStore } from '../../../stores/buffStore';
import { useCombatStore } from '../../../stores/combatStore';
import { useInventoryStore } from '../../../stores/inventoryStore';
import './BuffBar.scss';

/** Routes where no character is active – never show buffs/protections here. */
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

/** Effects that only tick during active combat. */
const COMBAT_ONLY_EFFECTS = new Set(['xp_boost', 'premium_xp_boost']);

const BuffBar = () => {
    const location = useLocation();
    const cleanExpired = useBuffStore((s) => s.cleanExpired);
    const getActiveBuffs = useBuffStore((s) => s.getActiveBuffs);
    const allBuffs = useBuffStore((s) => s.allBuffs);
    const combatPhase = useCombatStore((s) => s.phase);
    const [, setTick] = useState(0);
    const [collapsed, setCollapsed] = useState(false);

    const consumables = useInventoryStore((s) => s.consumables);
    const aolCount = consumables['amulet_of_loss'] ?? 0;
    const deathProtCount = consumables['death_protection'] ?? 0;

    const isCharacterless = CHARACTERLESS_ROUTES.some((r) => location.pathname.startsWith(r));
    const active = isCharacterless ? [] : getActiveBuffs();

    // Always tick so we pick up newly added buffs quickly
    useEffect(() => {
        const interval = setInterval(() => {
            cleanExpired();
            setTick((t) => t + 1);
        }, 1000);
        return () => clearInterval(interval);
    }, [cleanExpired, allBuffs.length]);

    const now = Date.now();
    const hasProtections = !isCharacterless && (aolCount > 0 || deathProtCount > 0);
    if (isCharacterless) return null;
    const totalCount = active.length + (aolCount > 0 ? 1 : 0) + (deathProtCount > 0 ? 1 : 0);
    if (totalCount === 0) return null;

    const isInCombat = combatPhase === 'fighting';

    return (
        <div className={`buff-bar${collapsed ? ' buff-bar--collapsed' : ''}`}>
            {/* Toggle button */}
            <button
                className="buff-bar__toggle"
                onClick={() => setCollapsed((c) => !c)}
                title={collapsed ? 'Pokaż buffy' : 'Schowaj buffy'}
            >
                {collapsed ? `✦ ${totalCount}` : '✕'}
            </button>

            {!collapsed && (
                <>
                    {deathProtCount > 0 && (
                        <div className="buff-bar__pill buff-bar__pill--protection" title="Eliksir Ochrony – chroni przed utratą poziomu i przedmiotów przy następnej śmierci">
                            <span className="buff-bar__icon">🛡️</span>
                            <span className="buff-bar__name">Ochrona</span>
                            <span className="buff-bar__time">×{deathProtCount}</span>
                        </div>
                    )}
                    {aolCount > 0 && (
                        <div className="buff-bar__pill buff-bar__pill--protection" title="Amulet of Loss – chroni przedmioty przy następnej śmierci">
                            <span className="buff-bar__icon">🔱</span>
                            <span className="buff-bar__name">AOL</span>
                            <span className="buff-bar__time">×{aolCount}</span>
                        </div>
                    )}
                    {active.map((buff) => {
                        const isPausable = buff.timerMode === 'pausable';
                        const remaining = isPausable ? buff.remainingMs : (buff.expiresAt - now);
                        const isLow = remaining < 60000;
                        const isCombatOnly = COMBAT_ONLY_EFFECTS.has(buff.effect);
                        const isPaused = isPausable && isCombatOnly && !isInCombat;
                        return (
                            <div key={buff.id} className={`buff-bar__pill${isLow ? ' buff-bar__pill--low' : ''}${isPaused ? ' buff-bar__pill--paused' : ''}`}>
                                <span className="buff-bar__icon">{buff.icon}</span>
                                <span className="buff-bar__name">{buff.name}</span>
                                <span className="buff-bar__time">
                                    {isPaused ? `⏸ ${formatTimeLeft(remaining)}` : formatTimeLeft(remaining)}
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
