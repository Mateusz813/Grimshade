import type { ICombatPotionSlot } from './types';
import { isImageUrl } from '../../../systems/spriteAssets';
import EmojiText from '../../atoms/Twemoji/EmojiText';

interface IProps {
    hpPotion?: ICombatPotionSlot | null;
    pctHpPotion?: ICombatPotionSlot | null;
    mpPotion?: ICombatPotionSlot | null;
    pctMpPotion?: ICombatPotionSlot | null;
}

const FALLBACK_GLYPHS: Record<ICombatPotionSlot['kind'], string> = {
    'hp':     'red-heart',
    'pct-hp': ':red-heart:%',
    'mp':     'droplet',
    'pct-mp': ':droplet:%',
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
                    : <EmojiText>{iconValue}</EmojiText>}
            </span>
            <span className="combat-ui__pot-dock-count">x{p.count}</span>
            {p.cooldownProgress < 1 && (
                <>
                    <span
                        className="combat-ui__pot-dock-cd"
                        style={{ height: `${(1 - p.cooldownProgress) * 100}%` }}
                    />
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
