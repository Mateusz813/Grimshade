import { useState } from 'react';
import type { ReactNode } from 'react';
import { useCombatHudStore } from '../../../stores/combatHudStore';
import CombatBackpackModal from './CombatBackpackModal';
import CombatLogsModal from './CombatLogsModal';
import GameIcon from '../../atoms/Twemoji/GameIcon';

interface IProps {
    /** XP bar — `null` hides it (when XP-bar toggle is off). */
    xp?: { current: number; max: number; level: number } | null;
    /** Live XP/h readout from `combatStore.sessionXpPerHour` (calculated by
     *  `useBackgroundCombat`). Pass 0 (or omit) to suppress — shown next to
     *  the level/percent text inside the bar. */
    xpPerHour?: number;
    /** Combined XP multiplier ABOVE base for the local player (mastery +
     *  party + buffs). Eg. 0.18 means +18% XP. Rendered after the XP/h
     *  readout as a `+18%` suffix so the player can see the live boost. */
    xpBonusPct?: number;
    /** Glow the backpack green after a wave win. Auto-resets when modal opens. */
    showBackpackPing?: boolean;
    /** Optional CENTER slot — hunting view passes the wave-size +/- pill here
     *  so it shares the bag/logs row instead of having its own strip above
     *  these icons. Other views (Boss, Dungeon, etc.) leave this undefined
     *  and the layout collapses to a simple `[bag] [logs]` flex row. */
    waveControl?: ReactNode;
    /** Optional LEFT slot — hunting view passes the "Upolowano:" tally widget
     *  here. On mobile the tally drops to its own row beneath the bag/wave/
     *  logs. On desktop it sits to the LEFT of the wave control. */
    tally?: ReactNode;
}

/** Compact number formatter — 1234 -> 1.2k, 1234567 -> 1.2M. Mirrors the style
 *  used elsewhere in the HUD so the in-bar text doesn't get clipped on phones. */
const formatRate = (n: number): string => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
    return String(n);
};

/**
 * Strip just under the arena. Holds:
 *   - backpack icon (glows green after a win -> click opens session totals)
 *   - logs icon (opens full session log popup)
 *   - XP bar (below the row)
 *
 * Potions used to live here too — they're now in the floating
 * <CombatPotionDock /> pinned to the viewport's bottom-left so the player
 * can sip without scrolling and the row stays uncluttered.
 */
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

    // Compact HUD (Dungeon/Boss/Raid/Arena) hides the bag entirely — those
    // views don't drop loot mid-fight, so the strip is just clutter — and
    // floats the logs button to the top-right corner of the viewport so the
    // sub-row collapses to nothing and the screen never has to scroll. The
    // hunting Combat view leaves `compact = false` so its bag stays in flow.
    const compact = useCombatHudStore((s) => s.compact);

    const xpPct = xp && xp.max > 0
        ? Math.max(0, Math.min(100, (xp.current / xp.max) * 100))
        : 0;

    // When the hunting view passes BOTH a wave control AND a tally widget we
    // switch the row into a CSS-grid layout so we can do the responsive shuffle:
    //   - mobile  ->  [bag][wave][logs]   then   [tally] full-width row below
    //   - desktop ->  [tally][wave][bag][logs]   one row, tally on the left
    // Other views (Boss, Dungeon) get the original simple flex layout — the
    // modifier class flips on the grid only when the slots are present.
    const hasExtras = Boolean(waveControl || tally);
    const rowCls = `combat-ui__sub-row${hasExtras ? ' combat-ui__sub-row--with-extras' : ''}`;

    return (
        <div className="combat-ui__sub-controls">
            {/* In compact mode (Dungeon/Boss/Raid/Arena) the in-flow row is
                empty — the bag is hidden entirely and the logs button is
                portalled to the top-right of the viewport via the
                `--floating` modifier. Skipping the row in that case keeps
                even the row's `gap`/`min-height` from adding pixels we'd
                otherwise have to zero out from SCSS. */}
            {!compact && (
                <div className={rowCls}>
                    {tally && (
                        <div className="combat-ui__sub-tally-slot">{tally}</div>
                    )}
                    {waveControl && (
                        <div className="combat-ui__sub-wave-slot">{waveControl}</div>
                    )}
                    {/* Bag + logs are grouped so they can cluster on the right of
                        the desktop layout. On mobile the SCSS uses
                        `display: contents` to spill them back out as direct grid
                        items — that way the same DOM gives us bag-LEFT/logs-RIGHT
                        on phones AND a tight bag-then-logs cluster on the right
                        of the desktop row. */}
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
