import { useState } from 'react';
import './ItemIcon.scss';

interface IItemIconProps {
    icon: string;
    rarity: string;
    upgradeLevel?: number;
    itemLevel?: number;
    size?: 'sm' | 'md' | 'lg';
    onClick?: () => void;
    tooltip?: string;
    showTooltip?: boolean;
    className?: string;
    selected?: boolean;
    quantity?: number;
}

const RARITY_BG: Record<string, string> = {
    common:    '#9e9e9e',
    rare:      '#2196f3',
    epic:      '#4caf50',
    legendary: '#f44336',
    mythic:    '#ffc107',
    heroic:    '#9c27b0',
};

/**
 * Enhancement glow tiers:
 *  +5  → red
 *  +7  → yellow
 *  +9  → blue
 *  +12 → purple
 *  +15 black
 *  +20 gold-black
 */
const getEnhancementGlowTier = (level: number): string | null => {
    if (level >= 20) return 'goldblack';
    if (level >= 15) return 'black';
    if (level >= 12) return 'purple';
    if (level >= 9) return 'blue';
    if (level >= 7) return 'yellow';
    if (level >= 5) return 'red';
    return null;
};

const ItemIcon = ({ icon, rarity, upgradeLevel, itemLevel, size = 'md', onClick, tooltip, showTooltip = true, className = '', selected, quantity }: IItemIconProps) => {
    const [showTip, setShowTip] = useState(false);
    const bg = RARITY_BG[rarity] ?? '#9e9e9e';

    const sizeClass = `item-icon--${size}`;
    const enhancementTier = getEnhancementGlowTier(upgradeLevel ?? 0);
    const enhancementClass = enhancementTier ? ` item-icon--enhanced item-icon--enhanced-${enhancementTier}` : '';

    return (
        <div
            className={`item-icon ${sizeClass}${selected ? ' item-icon--selected' : ''}${enhancementClass} ${className}`}
            style={{
                '--item-rarity-color': bg,
                borderColor: bg,
                background: `linear-gradient(135deg, ${bg}33 0%, ${bg}15 50%, ${bg}08 100%)`,
            } as React.CSSProperties}
            onClick={(e) => {
                if (onClick) onClick();
                if (tooltip && showTooltip) {
                    e.stopPropagation();
                    setShowTip(prev => !prev);
                }
            }}
            onMouseEnter={() => tooltip && showTooltip && setShowTip(true)}
            onMouseLeave={() => setShowTip(false)}
        >
            <span className="item-icon__emoji">{icon}</span>

            {(upgradeLevel ?? 0) > 0 && (
                <span className="item-icon__upgrade">+{upgradeLevel}</span>
            )}

            {(itemLevel ?? 0) > 0 && (
                <span className="item-icon__level">Lv{itemLevel}</span>
            )}

            {quantity && quantity > 1 && (
                <span className="item-icon__quantity">x{quantity}</span>
            )}

            <div className="item-icon__glow" style={{ backgroundColor: bg }} />

            {enhancementTier && (
                <>
                    <div className="item-icon__shimmer" />
                    <div className="item-icon__shimmer item-icon__shimmer--alt" />
                </>
            )}

            {showTip && tooltip && (
                <div className="item-icon__tooltip">{tooltip}</div>
            )}
        </div>
    );
};

export default ItemIcon;
