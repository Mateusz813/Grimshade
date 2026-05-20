import EnemyCard from './EnemyCard';
import AllyCard from './AllyCard';
import type { ICombatEnemy, ICombatAlly } from './types';

interface IProps {
    /** Up to 4 enemy slots — pad to length 4 with `null` for empty visuals. */
    enemies: Array<ICombatEnemy | null>;
    /** Up to 4 ally slots — pad to length 4 with `null` for empty visuals. */
    allies: Array<ICombatAlly | null>;
    /** Click handler when player retargets an enemy. */
    onTargetEnemy?: (enemy: ICombatEnemy) => void;
    /**
     * Optional bg modifier — set to `'daily-boss'` for the shimmering
     * gradient unique to 3-attempts-per-day boss encounters, or to
     * `'transform'` for a per-tier phoenix photo background (the caller
     * sets `--arena-image: url(...)` and `--transform-hue: <hsl-hue>`
     * on a parent so each transform tier gets its own painting).
     */
    bgVariant?: 'default' | 'daily-boss' | 'transform';
    /** Slot for any per-view extras you want overlaid (skill anim, +/- monster controls, etc.). */
    overlay?: React.ReactNode;
}

/**
 * Fixed-layout combat arena: 4 enemy slots on the left, 4 ally slots on the
 * right, both columns always rendering 4 placeholders so nothing in the
 * arena ever reflows during a fight.
 *
 * Mobile: stacks columns 2×4 (smaller cards).
 * Desktop: side-by-side, slots also rendered 2×2 inside each column for
 *  "always 4 reserved" feel.
 */
const PAD = 4;

const padTo4 = <T,>(arr: Array<T | null>): Array<T | null> => {
    const out = arr.slice(0, PAD);
    while (out.length < PAD) out.push(null);
    return out;
};

const CombatArena = ({ enemies, allies, onTargetEnemy, bgVariant = 'default', overlay }: IProps) => {
    const padEnemies = padTo4(enemies);
    const padAllies = padTo4(allies);

    const cls = [
        'combat-ui__arena',
        bgVariant !== 'default' ? `combat-ui__arena--${bgVariant}` : '',
    ].filter(Boolean).join(' ');

    return (
        <section className={cls} aria-label="Pole walki">
            <div className="combat-ui__arena-col combat-ui__arena-col--enemies">
                {padEnemies.map((e, i) => (
                    <EnemyCard key={e?.id ?? `enemy-empty-${i}`} enemy={e} onTarget={onTargetEnemy} />
                ))}
            </div>

            <div className="combat-ui__arena-col combat-ui__arena-col--allies">
                {padAllies.map((a, i) => (
                    <AllyCard key={a?.id ?? `ally-empty-${i}`} ally={a} />
                ))}
            </div>

            {overlay && <div className="combat-ui__arena-overlay">{overlay}</div>}
        </section>
    );
};

export default CombatArena;
