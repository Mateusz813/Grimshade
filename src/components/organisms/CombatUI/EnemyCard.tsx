import { MonsterSprite, BossSprite } from '../../ui/Sprite/MonsterSprite';
import type { ICombatEnemy } from './types';
import { isImageUrl } from '../../../systems/spriteAssets';
import GameIcon from '../../atoms/Twemoji/GameIcon';
import TinyIcon from '../../ui/TinyIcon/TinyIcon';

interface IProps {
    enemy: ICombatEnemy | null;
    /** Click handler to retarget the player onto this enemy. */
    onTarget?: (enemy: ICombatEnemy) => void;
}

const RARITY_LABEL: Record<string, string> = {
    normal:    '',
    strong:    'STRONG',
    epic:      'EPIC',
    legendary: 'LEGENDARY',
    boss:      'BOSS',
};

/**
 * One slot in the 4-slot enemies column. Renders an empty placeholder when
 * `enemy` is null so the next-slot-up never reflows.
 *
 * Layout (top -> bottom):
 *   - sprite (PNG via MonsterSprite/BossSprite, falls back to emoji)
 *   - thin HP bar
 *   - thin MP bar (only if maxMp > 0)
 *   - name + optional rarity label
 *
 * Bars sit BELOW the sprite so the artwork is never clipped/shoved by the
 * bar row. The whole card is rarity-tinted via `combat-ui__enemy--{rarity}`.
 * Dead enemies get the gray skull overlay with low opacity so the player can
 * still see who died.
 */
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
        // Legacy boolean — see `hitPulse` for re-triggerable per-hit flash.
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
            {/* Rarity label pinned to the absolute TOP-CENTRE of the card so it
                reads as a banner over the artwork. Lives outside `&__enemy-foot`
                now (the foot only carries the name) — that way the label can
                overlap the sprite without pushing it down or eating into the
                bar/foot area. Hidden entirely when the enemy is `normal` so the
                top of the card stays clean for plain mobs. */}
            {rarityLabel && (
                <span className={`combat-ui__enemy-rarity combat-ui__enemy-rarity--${enemy.rarity}`}>
                    {rarityLabel}
                </span>
            )}

            {/* 2026-05 v6: live status countdowns (stun / paralyze / immortal)
                pinned top-left so the player can time their next cast. The
                badge hides itself when the timer is ≤ 0 — view recomputes
                every render so the ms count drains visibly. */}
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
                    // Rogue Naznaczony na Śmierć — heals reversed to dmg.
                    // Reuses the stun badge styling for visual cohesion.
                    items.push({ key: 'mark', icon: 'skull-and-crossbones', text: `${sec(enemy.statusOverlay.markHealToDmgMs!)}s`, cls: 'combat-ui__status-badge--stun' });
                }
                if ((enemy.statusOverlay.markAmpMs ?? 0) > 0) {
                    // Necromancer Klątwa Śmierci — next hit gets ×N dmg.
                    // Badge reads ":skull-and-crossbones: ×N · Ts" so the player sees the
                    // amp value AND the time-to-expire at a glance.
                    const mult = enemy.statusOverlay.markAmpMult ?? 0;
                    const label = mult > 1
                        ? `×${mult} · ${sec(enemy.statusOverlay.markAmpMs!)}s`
                        : `${sec(enemy.statusOverlay.markAmpMs!)}s`;
                    items.push({ key: 'amp', icon: 'skull-and-crossbones', text: label, cls: 'combat-ui__status-badge--stun' });
                }
                if ((enemy.statusOverlay.darkRitualMs ?? 0) > 0) {
                    // Necromancer Mroczny Rytuał — countdown until target
                    // loses N% of max HP. Badge reads ":skull: 25% · 4.7s" so
                    // the player can time burst windows around it.
                    const pct = enemy.statusOverlay.darkRitualPct ?? 0;
                    const label = pct > 0
                        ? `${pct}% · ${sec(enemy.statusOverlay.darkRitualMs!)}s`
                        : `${sec(enemy.statusOverlay.darkRitualMs!)}s`;
                    items.push({ key: 'ritual', icon: 'skull', text: label, cls: 'combat-ui__status-badge--stun' });
                }
                if ((enemy.statusOverlay.markAmpAllMs ?? 0) > 0) {
                    // Necromancer Kraina Śmierci — duration-based ×mult
                    // damage on EVERY hit until the timer expires.
                    // Distinct from Klątwa Śmierci :skull-and-crossbones: (one-shot count
                    // charge); reuse the :drop-of-blood: icon to differentiate.
                    const mult = enemy.statusOverlay.markAmpAllMult ?? 0;
                    const label = mult > 1
                        ? `×${mult} · ${sec(enemy.statusOverlay.markAmpAllMs!)}s`
                        : `${sec(enemy.statusOverlay.markAmpAllMs!)}s`;
                    items.push({ key: 'ampAll', icon: 'drop-of-blood', text: label, cls: 'combat-ui__status-badge--stun' });
                }
                if ((enemy.statusOverlay.enemyAtkDownMs ?? 0) > 0) {
                    // Bard Kołysanka — enemy ATK reduced by N% for the
                    // window. Reuses the stun-style pill so the player
                    // sees the debuff at a glance.
                    const pct = enemy.statusOverlay.enemyAtkDownPct ?? 0;
                    const label = pct > 0
                        ? `-${pct}% · ${sec(enemy.statusOverlay.enemyAtkDownMs!)}s`
                        : `${sec(enemy.statusOverlay.enemyAtkDownMs!)}s`;
                    items.push({ key: 'lull', icon: 'sleeping-face', text: label, cls: 'combat-ui__status-badge--paral' });
                }
                if ((enemy.statusOverlay.enemyNoHealMs ?? 0) > 0) {
                    // Bard Pieśń Syren — enemy can't heal for N s. Heals
                    // attempted during the window have zero effect.
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
                {/* `objectFit: contain` — the player preferred contain over
                    cover for the standard bestiary art; cover was cropping
                    the top/bottom of the sprite (heads/tails of the monster
                    art) which looked worse than the small letterbox bands on
                    the sides.
                    `imageUrl` opt-out lets a view (Transform) plug in its own
                    artwork (e.g. the per-tier phoenix card image) instead of
                    the level-keyed bestiary lookup the Sprite components do.
                    For overridden artwork the view can also pick its own
                    `imageObjectFit` — the phoenix card art is composed to
                    fill a portrait frame, so contain leaves dead bars top
                    and bottom and `cover` is the right call there. Default
                    stays `contain` for any view that just plugs in `imageUrl`
                    without an explicit fit choice. */}
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

            {/* HP-only bar row — monsters have no MP pool by design (they cast
                spells "for free" without a mana cost), so the MP bar that used
                to sit under HP has been removed entirely. The single HP bar
                still lives BELOW the sprite so the artwork is never clipped. */}
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

            {/* Per-attack hit pulse — same pattern as AllyCard. The keyed
                element re-mounts on every distinct `hitPulse` increment so
                rapid attacks (player auto + skill landing within the same
                300ms window) each get their own visible flash instead of
                visually merging into one.
                The parity-based `--strike-l` / `--strike-r` modifier shifts
                the flash to the LEFT half of the card on odd pulses and the
                RIGHT half on even pulses. Crucial for Rogue dual-wield: the
                two strikes fire 150ms apart but the 320ms pulse animation
                means the first flash is still ~70% visible when the second
                begins. With identical full-card flashes the eye reads it as
                ONE strike; offsetting them spatially makes the player see
                two distinct hit points (left dagger -> right dagger). For
                non-dual classes this just means consecutive autos alternate
                sides, which adds a bit of visual variety without breaking
                the "got hit" read. */}
            {typeof enemy.hitPulse === 'number' && enemy.hitPulse > 0 && (
                <span
                    key={`hit-${enemy.hitPulse}`}
                    className={`combat-ui__enemy-hit-pulse combat-ui__enemy-hit-pulse--${enemy.hitPulse % 2 === 1 ? 'strike-l' : 'strike-r'}`}
                    aria-hidden="true"
                />
            )}

            {/* Per-slot skill animation overlay — fired when a player or ally
                casts a spell on THIS enemy. The `cssClass` (e.g.
                `skill-anim--fire`) ships its own keyframes from
                skill-animations.scss; we just inject the emoji and let
                `useCombatFx` clear the entry after the animation duration.
                Keyed by `id` so two casts in rapid succession unmount the
                stale overlay and replay cleanly. */}
            {enemy.skillAnim && (
                <span
                    key={`skill-${enemy.skillAnim.id}`}
                    className={`skill-anim-overlay ${enemy.skillAnim.cssClass}`}
                    aria-hidden="true"
                >
                    {/* Inner `.skill-anim-emoji` is the selector skill-animations.scss
                        targets to animate the glyph (scale/rotate/fade); the outer
                        overlay only carries the halo via ::before. When the icon
                        resolved to a spell PNG (per-class artwork) we render an
                        <img> instead of the emoji string so the artwork flies
                        across the card rather than the URL appearing as text. */}
                    {isImageUrl(enemy.skillAnim.emoji) ? (
                        <img className="skill-anim-emoji skill-anim-emoji--img" src={enemy.skillAnim.emoji} alt="" draggable={false} />
                    ) : (
                        <span className="skill-anim-emoji"><TinyIcon icon={enemy.skillAnim.emoji} /></span>
                    )}
                </span>
            )}

            {/* Floating damage / heal numbers anchored to the card. Each
                spawn from `pushEnemyFloat` adds an entry; `useCombatFx`
                self-prunes after 1.5s. The float drifts up + fades out via
                `combat-ui-float-rise`. The colour family + weight are driven
                by `--{kind}` so player vs. ally vs. crit each read distinct
                at a glance — see CombatUI.scss for the per-kind tints. */}
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
                                    // 2026-05 v6: dedicated red-glow modifier for
                                    // instant-kill procs so DEATH ATTACK reads
                                    // distinctly from a regular crit (yellow).
                                    isDeathAttack ? 'combat-ui__float--death' : '',
                                ].filter(Boolean).join(' ')}
                            >
                                {f.icon && (isImageUrl(f.icon)
                                    ? <img className="combat-ui__float-icon combat-ui__float-icon--img" src={f.icon} alt="" draggable={false} />
                                    : <span className="combat-ui__float-icon"><TinyIcon icon={f.icon} /></span>
                                )}
                                {/* `label` (e.g. "STUN", "PARAL", "DEATH ATTACK")
                                    replaces the numeric value for status-effect
                                    floats so a debuff cast doesn't show "0". */}
                                <span className="combat-ui__float-value">
                                    {f.label ?? Math.max(0, Math.round(f.value))}
                                </span>
                                {/* CRIT chip suppressed for DEATH ATTACK floats
                                    so the "DEATH ATTACK" label stands alone. */}
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
