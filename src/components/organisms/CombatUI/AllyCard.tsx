import type { ICombatAlly } from './types';
import { isImageUrl } from '../../../systems/spriteAssets';

interface IProps {
    ally: ICombatAlly | null;
}

/**
 * One slot in the 4-slot allies column. Mirrors EnemyCard's layout so the
 * whole arena reads as a clean 4×2 grid:
 *   • avatar (with transform-tier border, lvl badge top-left)
 *   • thin HP bar
 *   • thin MP bar
 *   • name + aggro badge (X mobs targeting me)
 *
 * Bars sit BELOW the avatar so the portrait is never visually shoved down by
 * the bars rounding/padding. Empty slots render as transparent placeholders
 * to lock layout.
 */
const AllyCard = ({ ally }: IProps) => {
    if (!ally) {
        return <div className="combat-ui__ally combat-ui__ally--empty" aria-hidden="true" />;
    }

    const hpPct = ally.maxHp > 0 ? Math.max(0, Math.min(100, (ally.currentHp / ally.maxHp) * 100)) : 0;
    const mpPct = ally.maxMp > 0 ? Math.max(0, Math.min(100, (ally.currentMp / ally.maxMp) * 100)) : 0;

    // Per-hit shake — alternates between TWO modifier classes based on
    // `hitPulse % 2` parity. Each class binds to its own keyframes name
    // (`combat-ui-ally-shake-a` / `…-b`) but the keyframes are identical.
    // This is the well-known "dual-keyframe parity trick" for restarting
    // a CSS animation without unmounting the element: when the class flips
    // from `--shake-a` → `--shake-b`, the browser sees a NEW animation name
    // and starts it from frame 0. So each individual hit replays the shake
    // even when the previous hasn't finished yet (e.g. 4 monsters hitting
    // the same ally back-to-back). When `hitPulse` is undefined / 0 we
    // apply no class at all so the card sits perfectly still while idle.
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
        // Legacy boolean still honoured so views that haven't migrated to
        // `hitPulse` keep flashing. New code should pass `hitPulse` so each
        // individual hit re-triggers the keyed overlay below.
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
            {/* Level + aggro badges live on the CARD (not on the avatar) so
                their presence never shrinks the portrait — they overlay the
                top corners of the whole tile via absolute positioning. */}
            {typeof ally.level === 'number' && ally.level > 0 && (
                <span className="combat-ui__ally-level" aria-label={`Poziom ${ally.level}`}>
                    Lv {ally.level}
                </span>
            )}
            {ally.aggroCount > 0 && (
                <span className="combat-ui__ally-aggro" title={`${ally.aggroCount}× aggro`}>
                    🎯<strong>×{ally.aggroCount}</strong>
                </span>
            )}

            <div className="combat-ui__ally-avatar">
                <img src={ally.avatarUrl} alt="" draggable={false} />
                {ally.isDead && (
                    <span className="combat-ui__ally-skull" aria-hidden="true">💀</span>
                )}
                {/* 2026-05 v7: Necromancer summon-spawn overlay. Each type
                    plays its own 2s keyframe animation when the caster
                    raises a new minion. `key` = anim id forces React to
                    re-mount the div so back-to-back spawns of the same
                    type each replay the keyframe from frame 0. */}
                {ally.summonSpawn && (
                    <div
                        key={`spawn-${ally.summonSpawn.id}`}
                        className={`combat-ui__summon-spawn combat-ui__summon-spawn--${ally.summonSpawn.type}`}
                        aria-hidden="true"
                    >
                        <span className="combat-ui__summon-spawn-glyph">
                            {ally.summonSpawn.type === 'skeleton' && '💀'}
                            {ally.summonSpawn.type === 'ghost' && '👻'}
                            {ally.summonSpawn.type === 'demon' && '😈'}
                            {ally.summonSpawn.type === 'lich' && '👑'}
                        </span>
                        <span className="combat-ui__summon-spawn-aura" />
                    </div>
                )}
                {/* 2026-05 v7: per-type summon badges (💀×N 👻×M 😈×K 👑×L)
                    so the player can see the breakdown at a glance instead of
                    one combined ×N count. Each badge is clickable (when
                    `onSummonClick` is provided — i.e. on the player's own
                    card) and despawns the oldest summon of that type. Bots'
                    cards still render the badges but without click handlers,
                    so the player only manages their own summon queue. */}
                {(ally.summonsByType && (
                    (ally.summonsByType.skeleton ?? 0) +
                    (ally.summonsByType.ghost ?? 0) +
                    (ally.summonsByType.demon ?? 0) +
                    (ally.summonsByType.lich ?? 0)
                ) > 0) && (() => {
                    const t = ally.summonsByType!;
                    const onClick = ally.onSummonClick;
                    const items: Array<{ key: 'skeleton' | 'ghost' | 'demon' | 'lich'; icon: string; count: number; label: string }> = [];
                    if (t.skeleton) items.push({ key: 'skeleton', icon: '💀', count: t.skeleton, label: 'Szkielet' });
                    if (t.ghost) items.push({ key: 'ghost', icon: '👻', count: t.ghost, label: 'Duch' });
                    if (t.demon) items.push({ key: 'demon', icon: '😈', count: t.demon, label: 'Demon' });
                    if (t.lich) items.push({ key: 'lich', icon: '👑', count: t.lich, label: 'Lisz' });
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
                                    {it.icon}×{it.count}
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
                <span className="combat-ui__ally-name">{ally.name}</span>
            </div>

            {/* Per-attack hit pulse — keyed by `hitPulse` so each distinct
                hit re-mounts a fresh overlay element and the CSS animation
                replays from frame 0. Critical for multi-mob solo combat
                (4 monsters with different attack speeds): without this the
                second hit landing inside the same 300ms window would be
                visually invisible because the shake class was already on. */}
            {typeof ally.hitPulse === 'number' && ally.hitPulse > 0 && (
                <span
                    key={`hit-${ally.hitPulse}`}
                    className="combat-ui__ally-hit-pulse"
                    aria-hidden="true"
                />
            )}

            {/* Per-slot skill animation overlay — fired when THIS ally casts
                (e.g. a self-buff or a heal landing on themselves). Same
                `cssClass`-driven render as EnemyCard. When the icon resolved
                to a spell PNG, render the <img> so the artwork shows during
                the cast — otherwise fall back to the emoji string. */}
            {ally.skillAnim && (
                <span
                    key={`skill-${ally.skillAnim.id}`}
                    className={`skill-anim-overlay ${ally.skillAnim.cssClass}`}
                    aria-hidden="true"
                >
                    {isImageUrl(ally.skillAnim.emoji) ? (
                        <img className="skill-anim-emoji skill-anim-emoji--img" src={ally.skillAnim.emoji} alt="" draggable={false} />
                    ) : (
                        <span className="skill-anim-emoji">{ally.skillAnim.emoji}</span>
                    )}
                </span>
            )}

            {/* Floating numbers stack — monster-attack damage in red, heals
                in green. Same lifecycle/keying as the enemy floats. */}
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
                                : <span className="combat-ui__float-icon">{f.icon}</span>
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
