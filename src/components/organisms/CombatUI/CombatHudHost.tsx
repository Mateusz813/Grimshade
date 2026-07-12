import { useEffect } from 'react';
import type { CSSProperties } from 'react';
import { useCombatHudStore } from '../../../stores/combatHudStore';

interface IProps {
    active: boolean;
    accent?: string | null;
    compact?: boolean;
    children?: React.ReactNode;
}

export const CombatHudHost = ({ active, accent, compact, children }: IProps) => {
    const setActive = useCombatHudStore((s) => s.setActive);
    const setCompact = useCombatHudStore((s) => s.setCompact);

    useEffect(() => {
        setActive(active);
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
