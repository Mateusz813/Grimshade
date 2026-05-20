import type { ICombatPotionSlot } from './types';
import { isImageUrl } from '../../../systems/spriteAssets';

interface IProps {
    /** Flat HP potion (small/normal/strong). */
    hpPotion?: ICombatPotionSlot | null;
    /** Percentage HP potion (great/super/ultimate/divine). */
    pctHpPotion?: ICombatPotionSlot | null;
    /** Flat MP potion. */
    mpPotion?: ICombatPotionSlot | null;
    /** Percentage MP potion. */
    pctMpPotion?: ICombatPotionSlot | null;
}

// Legacy emoji fallback per kind — used when the slot doesn't carry an
// `icon` URL (e.g. tests, older callers).
const FALLBACK_GLYPHS: Record<ICombatPotionSlot['kind'], string> = {
    'hp':     '❤️',
    'pct-hp': '❤️%',
    'mp':     '💧',
    'pct-mp': '💧%',
};

const PotionDockButton = ({ p }: { p: ICombatPotionSlot | null | undefined }) => {
    if (!p) {
        return (
            <button
                type="button"
                className="combat-ui__pot-dock-btn combat-ui__pot-dock-btn--empty"
                aria-hidden="true"
                tabIndex={-1}
            />
        );
    }
    const cls = [
        'combat-ui__pot-dock-btn',
        `combat-ui__pot-dock-btn--${p.kind}`,
        p.disabled ? 'combat-ui__pot-dock-btn--disabled' : '',
        p.cooldownProgress < 1 ? 'combat-ui__pot-dock-btn--cooldown' : '',
    ].filter(Boolean).join(' ');
    // 2026-05: prefer the per-slot PNG art (set by Combat from
    // `getPotionImage(potion.id)`), fall back to the legacy emoji glyph
    // when no art is available.
    const iconValue = p.icon ?? FALLBACK_GLYPHS[p.kind];
    return (
        <button
            type="button"
            className={cls}
            onClick={p.onClick}
            disabled={p.disabled}
            aria-label={p.kind}
        >
            <span className="combat-ui__pot-dock-icon">
                {isImageUrl(iconValue)
                    ? <img src={iconValue} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
                    : iconValue}
            </span>
            <span className="combat-ui__pot-dock-count">x{p.count}</span>
            {p.cooldownProgress < 1 && (
                <>
                    <span
                        className="combat-ui__pot-dock-cd"
                        style={{ height: `${(1 - p.cooldownProgress) * 100}%` }}
                    />
                    {/* Numeric remaining timer overlay, same UX as the
                        skill bar. < 1 s shows one-decimal precision so
                        the count visibly drains; ≥ 1 s rounds up. */}
                    {typeof p.cooldownRemainingMs === 'number' && p.cooldownRemainingMs > 0 && (
                        <span className="combat-ui__pot-dock-cd-text">
                            {p.cooldownRemainingMs >= 1000
                                ? `${Math.ceil(p.cooldownRemainingMs / 1000)}s`
                                : `${(p.cooldownRemainingMs / 1000).toFixed(1)}s`}
                        </span>
                    )}
                </>
            )}
        </button>
    );
};

/**
 * Floating potion dock pinned to the bottom-left of the viewport. Always
 * shows 4 vertically-stacked slots in a fixed order so muscle memory is
 * stable regardless of inventory:
 *
 *   1. HP potion (flat)
 *   2. %HP potion (percentage)
 *   3. MP potion (flat)
 *   4. %MP potion (percentage)
 *
 * Each slot renders the live cooldown overlay (bottom-up dark fill) so the
 * player can see when the next sip is ready without looking at the action
 * bar. Empty slots render as transparent placeholders to lock the column
 * height even when the player owns no potions of that tier.
 */
const CombatPotionDock = ({ hpPotion, pctHpPotion, mpPotion, pctMpPotion }: IProps) => {
    return (
        <aside className="combat-ui__pot-dock" aria-label="Potiony">
            <PotionDockButton p={hpPotion} />
            <PotionDockButton p={pctHpPotion} />
            <PotionDockButton p={mpPotion} />
            <PotionDockButton p={pctMpPotion} />
        </aside>
    );
};

export default CombatPotionDock;
