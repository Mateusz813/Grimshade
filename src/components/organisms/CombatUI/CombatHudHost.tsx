import { useEffect } from 'react';
import type { CSSProperties } from 'react';
import { useCombatHudStore } from '../../../stores/combatHudStore';

interface IProps {
    /** Whether the player is currently in an active fight. While true the
     *  global BottomNav is hidden and the view's own <CombatActionBar>
     *  takes its place. Pass `false` outside the fight (lobby / list / result). */
    active: boolean;
    /** Optional accent color (typically the player's transformation color) used
     *  to tint chrome — auto chips, skill borders, potion borders. */
    accent?: string | null;
    /** Optional — when true the AppShell mounts the `--compact` modifier so
     *  the view's sub-row drops its margins, the main wrapper drops its
     *  bottom padding, and the logs icon floats in the top-right corner.
     *  Used by Dungeon/Boss/Raid/Arena (no bag, no scroll). The hunting
     *  Combat view leaves this off so its layout keeps the bag pill and
     *  the standard 140px bottom clearance for the potion dock. */
    compact?: boolean;
    children?: React.ReactNode;
}

/**
 * Drop-in helper every combat view mounts so AppShell knows when to swap
 * the global bottom nav for the in-fight action bar. The view itself doesn't
 * need to import the hud-store — it just renders:
 *
 * ```tsx
 * <CombatHudHost active={phase === 'fighting'} accent={playerAccent}>
 *   ...rest of view...
 * </CombatHudHost>
 * ```
 *
 * Resets to `false` on unmount so navigating away always restores the nav.
 *
 * The optional `accent` is exposed as a CSS custom property
 * (`--combat-accent`) on the wrapper div, so any descendant rule can opt in
 * via `var(--combat-accent, <fallback>)`.
 */
export const CombatHudHost = ({ active, accent, compact, children }: IProps) => {
    const setActive = useCombatHudStore((s) => s.setActive);
    const setCompact = useCombatHudStore((s) => s.setCompact);

    useEffect(() => {
        setActive(active);
        // `compact` is only meaningful WHILE the HUD is active — out of fight
        // we always reset it to false so a stray flag can't survive a route
        // change and bleed into other views.
        setCompact(active && !!compact);
        return () => {
            setActive(false);
            setCompact(false);
        };
    }, [active, compact, setActive, setCompact]);

    const style = accent
        ? ({ '--combat-accent': accent } as CSSProperties)
        : undefined;

    return (
        <div className="combat-ui__hud-root" style={style}>
            {children}
        </div>
    );
};
