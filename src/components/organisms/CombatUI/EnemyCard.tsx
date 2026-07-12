import { MonsterSprite, BossSprite } from '../../ui/Sprite/MonsterSprite';
import type { ICombatEnemy } from './types';
import { isImageUrl } from '../../../systems/spriteAssets';
import GameIcon from '../../atoms/Twemoji/GameIcon';
import TinyIcon from '../../ui/TinyIcon/TinyIcon';

interface IProps {
    enemy: ICombatEnemy | null;
    onTarget?: (enemy: ICombatEnemy) => void;
}

const RARITY_LABEL: Record<string, string> = {
    normal:    '',
    strong:    'STRONG',
    epic:      'EPIC',
    legendary: 'LEGENDARY',
    boss:      'BOSS',
};

const EnemyCard = ({ enemy, onTarget }: IProps) => {
    if (!enemy) {
        return <div className="combat-ui__enemy combat-ui__enemy--empty" aria-hidden="true" />;
    }

    const hpPct = enemy.maxHp > 0 ? Math.max(0, Math.min(100, (enemy.currentHp / enemy.maxHp) * 100)) : 0;

    const rarityLabel = RARITY_LABEL[enemy.rarity] ?? '';

    const Sprite = enemy.kind === 'boss' ? BossSprite : MonsterSprite;

    const cls = [
        'combat-ui__enemy',
        `combat-ui__enemy--${enemy.rarity}`,
        enemy.isDead ? 'combat-ui__enemy--dead' : '',
        enemy.isTargetedByPlayer ? 'combat-ui__enemy--targeted' : '',
        enemy.isHit ? 'combat-ui__enemy--hit' : '',
        enemy.attackingClassName ? `combat-ui__enemy--${enemy.attackingClassName}` : '',
    ].filter(Boolean).join(' ');

    return (
        <button
            type="button"
            className={cls}
            onClick={() => onTarget?.(enemy)}
            disabled={enemy.isDead}
            aria-label={`${enemy.name} (lvl ${enemy.level})`}
        >
            {rarityLabel && (
                <span className={`combat-ui__enemy-rarity combat-ui__enemy-rarity--${enemy.rarity}`}>
                    {rarityLabel}
                </span>
            )}

            {enemy.statusOverlay && (() => {
                const sec = (ms: number) => (ms / 1000).toFixed(ms > 1000 ? 0 : 1);
                const items: Array<{ key: string; icon: string; text: string; cls: string }> = [];
                if ((enemy.statusOverlay.stunMs ?? 0) > 0) {
                    items.push({ key: 'stun', icon: 'dizzy', text: `${sec(enemy.statusOverlay.stunMs!)}s`, cls: 'combat-ui__status-badge--stun' });
                }
                if ((enemy.statusOverlay.paralyzeMs ?? 0) > 0) {
                    items.push({ key: 'paral', icon: 'locked', text: `${sec(enemy.statusOverlay.paralyzeMs!)}s`, cls: 'combat-ui__status-badge--paral' });
                }
                if ((enemy.statusOverlay.immortalMs ?? 0) > 0) {
                    items.push({ key: 'immortal', icon: 'sparkles', text: `${sec(enemy.statusOverlay.immortalMs!)}s`, cls: 'combat-ui__status-badge--immortal' });
                }
                if ((enemy.statusOverlay.markHealToDmgMs ?? 0) > 0) {
                    items.push({ key: 'mark', icon: 'skull-and-crossbones', text: `${sec(enemy.statusOverlay.markHealToDmgMs!)}s`, cls: 'combat-ui__status-badge--stun' });
                }
                if ((enemy.statusOverlay.markAmpMs ?? 0) > 0) {
                    const mult = enemy.statusOverlay.markAmpMult ?? 0;
                    const label = mult > 1
                        ? `×${mult} · ${sec(enemy.statusOverlay.markAmpMs!)}s`
                        : `${sec(enemy.statusOverlay.markAmpMs!)}s`;
                    items.push({ key: 'amp', icon: 'skull-and-crossbones', text: label, cls: 'combat-ui__status-badge--stun' });
                }
                if ((enemy.statusOverlay.darkRitualMs ?? 0) > 0) {
                    const pct = enemy.statusOverlay.darkRitualPct ?? 0;
                    const label = pct > 0
                        ? `${pct}% · ${sec(enemy.statusOverlay.darkRitualMs!)}s`
                        : `${sec(enemy.statusOverlay.darkRitualMs!)}s`;
                    items.push({ key: 'ritual', icon: 'skull', text: label, cls: 'combat-ui__status-badge--stun' });
                }
                if ((enemy.statusOverlay.markAmpAllMs ?? 0) > 0) {
                    const mult = enemy.statusOverlay.markAmpAllMult ?? 0;
                    const label = mult > 1
                        ? `×${mult} · ${sec(enemy.statusOverlay.markAmpAllMs!)}s`
                        : `${sec(enemy.statusOverlay.markAmpAllMs!)}s`;
                    items.push({ key: 'ampAll', icon: 'drop-of-blood', text: label, cls: 'combat-ui__status-badge--stun' });
                }
                if ((enemy.statusOverlay.enemyAtkDownMs ?? 0) > 0) {
                    const pct = enemy.statusOverlay.enemyAtkDownPct ?? 0;
                    const label = pct > 0
                        ? `-${pct}% · ${sec(enemy.statusOverlay.enemyAtkDownMs!)}s`
                        : `${sec(enemy.statusOverlay.enemyAtkDownMs!)}s`;
                    items.push({ key: 'lull', icon: 'sleeping-face', text: label, cls: 'combat-ui__status-badge--paral' });
                }
                if ((enemy.statusOverlay.enemyNoHealMs ?? 0) > 0) {
                    items.push({ key: 'noheal', icon: 'muted-speaker', text: `${sec(enemy.statusOverlay.enemyNoHealMs!)}s`, cls: 'combat-ui__status-badge--paral' });
                }
                if (items.length === 0) return null;
                return (
                    <div className="combat-ui__status-stack">
                        {items.map((it) => (
                            <span key={it.key} className={`combat-ui__status-badge ${it.cls}`}>
                                <span className="combat-ui__status-badge-icon"><GameIcon name={it.icon} /></span>
                                <span className="combat-ui__status-badge-time">{it.text}</span>
                            </span>
                        ))}
                    </div>
                );
            })()}

            <div className="combat-ui__enemy-sprite">
                {enemy.imageUrl ? (
                    <img
                        src={enemy.imageUrl}
                        alt={enemy.name}
                        draggable={false}
                        style={{
                            width: '100%',
                            height: '100%',
                            objectFit: enemy.imageObjectFit ?? 'contain',
                            display: 'block',
                        }}
                    />
                ) : (
                    <Sprite level={enemy.level} sprite={enemy.sprite} name={enemy.name} style={{ objectFit: 'contain' }} />
                )}
                {enemy.isDead && (
                    <span className="combat-ui__enemy-skull" aria-hidden="true"><GameIcon name="skull" /></span>
                )}
            </div>

            <div className="combat-ui__enemy-bars">
                <div className="combat-ui__enemy-bar combat-ui__enemy-bar--hp">
                    <span style={{ width: `${hpPct}%` }} />
                </div>
            </div>

            <div className="combat-ui__enemy-foot">
                <span className="combat-ui__enemy-name">{enemy.name}</span>
            </div>

            {enemy.isTargetedByPlayer && (
                <span className="combat-ui__enemy-target" aria-hidden="true"><GameIcon name="bullseye" /></span>
            )}

            {typeof enemy.hitPulse === 'number' && enemy.hitPulse > 0 && (
                <span
                    key={`hit-${enemy.hitPulse}`}
                    className={`combat-ui__enemy-hit-pulse combat-ui__enemy-hit-pulse--${enemy.hitPulse % 2 === 1 ? 'strike-l' : 'strike-r'}`}
                    aria-hidden="true"
                />
            )}

            {enemy.skillAnim && (
                <span
                    key={`skill-${enemy.skillAnim.id}`}
                    className={`skill-anim-overlay ${enemy.skillAnim.cssClass}`}
                    aria-hidden="true"
                >
                    {isImageUrl(enemy.skillAnim.emoji) ? (
                        <img className="skill-anim-emoji skill-anim-emoji--img" src={enemy.skillAnim.emoji} alt="" draggable={false} />
                    ) : (
                        <span className="skill-anim-emoji"><TinyIcon icon={enemy.skillAnim.emoji} /></span>
                    )}
                </span>
            )}

            {enemy.floats && enemy.floats.length > 0 && (
                <div className="combat-ui__floats" aria-hidden="true">
                    {enemy.floats.map((f) => {
                        const isDeathAttack = f.label === 'DEATH ATTACK';
                        return (
                            <span
                                key={f.id}
                                className={[
                                    'combat-ui__float',
                                    `combat-ui__float--${f.kind}`,
                                    f.isCrit ? 'combat-ui__float--crit' : '',
                                    isDeathAttack ? 'combat-ui__float--death' : '',
                                ].filter(Boolean).join(' ')}
                            >
                                {f.icon && (isImageUrl(f.icon)
                                    ? <img className="combat-ui__float-icon combat-ui__float-icon--img" src={f.icon} alt="" draggable={false} />
                                    : <span className="combat-ui__float-icon"><TinyIcon icon={f.icon} /></span>
                                )}
                                <span className="combat-ui__float-value">
                                    {f.label ?? Math.max(0, Math.round(f.value))}
                                </span>
                                {f.isCrit && !isDeathAttack && <span className="combat-ui__float-crit">CRIT</span>}
                            </span>
                        );
                    })}
                </div>
            )}
        </button>
    );
};

export default EnemyCard;
