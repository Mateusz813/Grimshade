import type { ICombatAlly } from './types';
import { isImageUrl } from '../../../systems/spriteAssets';
import GameIcon from '../../atoms/Twemoji/GameIcon';
import EmojiText from '../../atoms/Twemoji/EmojiText';
import TinyIcon from '../../ui/TinyIcon/TinyIcon';

interface IProps {
    ally: ICombatAlly | null;
}

const AllyCard = ({ ally }: IProps) => {
    if (!ally) {
        return <div className="combat-ui__ally combat-ui__ally--empty" aria-hidden="true" />;
    }

    const hpPct = ally.maxHp > 0 ? Math.max(0, Math.min(100, (ally.currentHp / ally.maxHp) * 100)) : 0;
    const mpPct = ally.maxMp > 0 ? Math.max(0, Math.min(100, (ally.currentMp / ally.maxMp) * 100)) : 0;

    const shakeClass =
        typeof ally.hitPulse === 'number' && ally.hitPulse > 0
            ? (ally.hitPulse % 2 === 0
                ? 'combat-ui__ally--shake-a'
                : 'combat-ui__ally--shake-b')
            : '';

    const cls = [
        'combat-ui__ally',
        ally.isPlayer ? 'combat-ui__ally--player' : 'combat-ui__ally--bot',
        ally.isDead ? 'combat-ui__ally--dead' : '',
        ally.isHit ? 'combat-ui__ally--hit' : '',
        ally.attackingClassName ? `combat-ui__ally--${ally.attackingClassName}` : '',
        ally.transformTier ? `combat-ui__ally--t${ally.transformTier}` : '',
        shakeClass,
    ].filter(Boolean).join(' ');

    return (
        <div
            className={cls}
            style={{ '--ally-accent': ally.accentColor } as React.CSSProperties}
            aria-label={`${ally.name} (${ally.className})`}
        >
            {typeof ally.level === 'number' && ally.level > 0 && (
                <span className="combat-ui__ally-level" aria-label={`Poziom ${ally.level}`}>
                    Lv {ally.level}
                </span>
            )}
            {ally.aggroCount > 0 && (
                <span className="combat-ui__ally-aggro" title={`${ally.aggroCount}× aggro`}>
                    <GameIcon name="bullseye" /><strong>×{ally.aggroCount}</strong>
                </span>
            )}

            <div className="combat-ui__ally-avatar">
                <img src={ally.avatarUrl} alt="" draggable={false} />
                {ally.isDead && (
                    <span className="combat-ui__ally-skull" aria-hidden="true"><GameIcon name="skull" /></span>
                )}
                {ally.summonSpawn && (
                    <div
                        key={`spawn-${ally.summonSpawn.id}`}
                        className={`combat-ui__summon-spawn combat-ui__summon-spawn--${ally.summonSpawn.type}`}
                        aria-hidden="true"
                    >
                        <span className="combat-ui__summon-spawn-glyph">
                            {ally.summonSpawn.type === 'skeleton' && <GameIcon name="skull" />}
                            {ally.summonSpawn.type === 'ghost' && <GameIcon name="ghost" />}
                            {ally.summonSpawn.type === 'demon' && <GameIcon name="smiling-face-with-horns" />}
                            {ally.summonSpawn.type === 'lich' && <GameIcon name="crown" />}
                        </span>
                        <span className="combat-ui__summon-spawn-aura" />
                    </div>
                )}
                {(ally.summonsByType && (
                    (ally.summonsByType.skeleton ?? 0) +
                    (ally.summonsByType.ghost ?? 0) +
                    (ally.summonsByType.demon ?? 0) +
                    (ally.summonsByType.lich ?? 0)
                ) > 0) && (() => {
                    const t = ally.summonsByType!;
                    const onClick = ally.onSummonClick;
                    const items: Array<{ key: 'skeleton' | 'ghost' | 'demon' | 'lich'; icon: string; count: number; label: string }> = [];
                    if (t.skeleton) items.push({ key: 'skeleton', icon: 'skull', count: t.skeleton, label: 'Szkielet' });
                    if (t.ghost) items.push({ key: 'ghost', icon: 'ghost', count: t.ghost, label: 'Duch' });
                    if (t.demon) items.push({ key: 'demon', icon: 'smiling-face-with-horns', count: t.demon, label: 'Demon' });
                    if (t.lich) items.push({ key: 'lich', icon: 'crown', count: t.lich, label: 'Lisz' });
                    return (
                        <span className="combat-ui__ally-summon-stack">
                            {items.map((it) => (
                                <button
                                    key={it.key}
                                    type="button"
                                    className="combat-ui__ally-summon-badge"
                                    title={onClick
                                        ? `${it.icon} ${it.label}: ${it.count} (kliknij aby odesłać)`
                                        : `${it.icon} ${it.label}: ${it.count}`}
                                    onClick={onClick ? (e) => { e.stopPropagation(); onClick(it.key); } : undefined}
                                    disabled={!onClick}
                                    aria-label={`${it.label} ×${it.count}`}
                                >
                                    <GameIcon name={it.icon} />×{it.count}
                                </button>
                            ))}
                        </span>
                    );
                })()}
            </div>

            <div className="combat-ui__ally-bars">
                <div className="combat-ui__ally-bar combat-ui__ally-bar--hp">
                    <span style={{ width: `${hpPct}%` }} />
                </div>
                <div className="combat-ui__ally-bar combat-ui__ally-bar--mp">
                    <span style={{ width: `${mpPct}%` }} />
                </div>
            </div>

            <div className="combat-ui__ally-foot">
                <span className="combat-ui__ally-name">
                    {ally.isBot && (
                        <span className="combat-ui__ally-bot-badge" aria-label="Bot">
                            <GameIcon name="robot" />
                        </span>
                    )}
                    <EmojiText>{ally.name}</EmojiText>
                </span>
            </div>

            {typeof ally.hitPulse === 'number' && ally.hitPulse > 0 && (
                <span
                    key={`hit-${ally.hitPulse}`}
                    className="combat-ui__ally-hit-pulse"
                    aria-hidden="true"
                />
            )}

            {ally.skillAnim && (
                <span
                    key={`skill-${ally.skillAnim.id}`}
                    className={`skill-anim-overlay ${ally.skillAnim.cssClass}`}
                    aria-hidden="true"
                >
                    {isImageUrl(ally.skillAnim.emoji) ? (
                        <img className="skill-anim-emoji skill-anim-emoji--img" src={ally.skillAnim.emoji} alt="" draggable={false} />
                    ) : (
                        <span className="skill-anim-emoji"><TinyIcon icon={ally.skillAnim.emoji} /></span>
                    )}
                </span>
            )}

            {ally.floats && ally.floats.length > 0 && (
                <div className="combat-ui__floats" aria-hidden="true">
                    {ally.floats.map((f) => (
                        <span
                            key={f.id}
                            className={[
                                'combat-ui__float',
                                `combat-ui__float--${f.kind}`,
                                f.isCrit ? 'combat-ui__float--crit' : '',
                            ].filter(Boolean).join(' ')}
                        >
                            {f.icon && (isImageUrl(f.icon)
                                ? <img className="combat-ui__float-icon combat-ui__float-icon--img" src={f.icon} alt="" draggable={false} />
                                : <span className="combat-ui__float-icon"><TinyIcon icon={f.icon} /></span>
                            )}
                            <span className="combat-ui__float-value">
                                {f.label ?? `${f.kind === 'heal' ? '+' : ''}${Math.max(0, Math.round(f.value))}`}
                            </span>
                            {f.isCrit && <span className="combat-ui__float-crit">CRIT</span>}
                        </span>
                    ))}
                </div>
            )}
        </div>
    );
};

export default AllyCard;
