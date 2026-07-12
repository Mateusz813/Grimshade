import EnemyCard from './EnemyCard';
import AllyCard from './AllyCard';
import type { ICombatEnemy, ICombatAlly } from './types';

interface IProps {
    enemies: Array<ICombatEnemy | null>;
    allies: Array<ICombatAlly | null>;
    onTargetEnemy?: (enemy: ICombatEnemy) => void;
    bgVariant?: 'default' | 'daily-boss' | 'transform';
    overlay?: React.ReactNode;
}

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
