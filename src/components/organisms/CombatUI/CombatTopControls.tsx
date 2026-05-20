import type { TSlotNode } from './types';

interface IProps {
    /** Animation-speed chip — `label` is rendered verbatim (e.g. "x1", "SKIP"). `null` hides.
     *  `disabled` renders the chip but blocks the click + dims it (used in
     *  Trainer for non-leader members who can only toggle autoSkill +
     *  autoFight per spec). */
    speed?: { label: string; onCycle: () => void; disabled?: boolean } | null;
    /** Auto-skill toggle — null hides the chip. */
    autoSkill?: { on: boolean; onToggle: () => void; disabled?: boolean } | null;
    /** Auto-fight toggle. */
    autoFight?: { on: boolean; onToggle: () => void; disabled?: boolean } | null;
    /** XP bar visibility toggle. */
    xpVisible?: { on: boolean; onToggle: () => void; disabled?: boolean } | null;
    /** Auto-potion toggle. */
    autoPotion?: { on: boolean; onToggle: () => void; disabled?: boolean } | null;
    /** Slot for any view-specific extras (e.g. dungeon retreat). */
    extras?: TSlotNode;
}

/**
 * Fixed-positioned cluster under the top header, right-aligned. Pure UI —
 * each toggle is wired by the calling view to whatever store it uses.
 */
const CombatTopControls = ({ speed, autoSkill, autoFight, xpVisible, autoPotion, extras }: IProps) => {
    // 2026-05-15 spec ("Sojusznicy powinni tez widziec wszystkie guziki
    // tylko miec mozliwosc klikania tylko 2"): a chip flagged `disabled`
    // renders the same but blocks clicks + dims the visual so a
    // non-leader member of a Trainer party can SEE that the leader set
    // speed=x4 or "Brak CD: ON", yet cannot click those chips
    // themselves.
    const disabledStyle: React.CSSProperties = { opacity: 0.45, cursor: 'not-allowed' };
    return (
        <div className="combat-ui__top-controls" role="group" aria-label="Ustawienia walki">
            {speed && (
                <button
                    type="button"
                    className="combat-ui__chip"
                    onClick={speed.disabled ? undefined : speed.onCycle}
                    aria-disabled={speed.disabled || undefined}
                    style={speed.disabled ? disabledStyle : undefined}
                    title={speed.disabled ? 'Tylko lider party może zmieniać ten parametr' : 'Prędkość walki'}
                >
                    ⏩ <strong>{speed.label}</strong>
                </button>
            )}
            {autoSkill && (
                <button
                    type="button"
                    className={`combat-ui__chip${autoSkill.on ? ' combat-ui__chip--on' : ''}`}
                    onClick={autoSkill.disabled ? undefined : autoSkill.onToggle}
                    aria-disabled={autoSkill.disabled || undefined}
                    style={autoSkill.disabled ? disabledStyle : undefined}
                    title="Auto skille"
                >
                    ✨ {autoSkill.on ? 'ON' : 'OFF'}
                </button>
            )}
            {autoFight && (
                <button
                    type="button"
                    className={`combat-ui__chip${autoFight.on ? ' combat-ui__chip--on' : ''}`}
                    onClick={autoFight.disabled ? undefined : autoFight.onToggle}
                    aria-disabled={autoFight.disabled || undefined}
                    style={autoFight.disabled ? disabledStyle : undefined}
                    title="Auto walka"
                >
                    ⚔️ {autoFight.on ? 'ON' : 'OFF'}
                </button>
            )}
            {autoPotion && (
                <button
                    type="button"
                    className={`combat-ui__chip${autoPotion.on ? ' combat-ui__chip--on' : ''}`}
                    onClick={autoPotion.disabled ? undefined : autoPotion.onToggle}
                    aria-disabled={autoPotion.disabled || undefined}
                    style={autoPotion.disabled ? disabledStyle : undefined}
                    title="Auto potion"
                >
                    🧪 {autoPotion.on ? 'ON' : 'OFF'}
                </button>
            )}
            {xpVisible && (
                <button
                    type="button"
                    className={`combat-ui__chip${xpVisible.on ? ' combat-ui__chip--on' : ''}`}
                    onClick={xpVisible.disabled ? undefined : xpVisible.onToggle}
                    aria-disabled={xpVisible.disabled || undefined}
                    style={xpVisible.disabled ? disabledStyle : undefined}
                    title="Pokaż pasek XP"
                >
                    {xpVisible.on ? '👁️' : '👁️‍🗨️'}
                </button>
            )}
            {extras}
        </div>
    );
};

export default CombatTopControls;
