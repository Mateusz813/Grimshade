import { isImageUrl } from '../../../systems/spriteAssets';
import GameIcon from '../../atoms/Twemoji/GameIcon';
import EmojiText from '../../atoms/Twemoji/EmojiText';

/**
 * TinyIcon — renders an "icon" that may be either:
 *   - an image URL (PNG art for spell chests / stones / potions / items)
 *   - a single icon name (slug, e.g. "crossed-swords") -> <GameIcon>
 *   - a multi-icon shortcode string (e.g. ":crossed-swords::shield:") -> <EmojiText>
 *
 * Centralises the `isImageUrl()` branch so every consumer that used to
 * interpolate `${getSpellChestIcon(...)} text` can swap in
 * `<TinyIcon icon={...} /> text` and get a properly-rendered <img>
 * without breaking the historical emoji fallback.
 *
 * Sizes (px): sm = 14, md = 18, lg = 24. Pick based on the surrounding
 * font size so the icon sits flush with the text baseline.
 */
interface ITinyIconProps {
    icon: string;
    size?: 'sm' | 'md' | 'lg' | number;
    className?: string;
    alt?: string;
}

const SIZE_PX: Record<string, number> = {
    sm: 14,
    md: 18,
    lg: 24,
};

const TinyIcon = ({ icon, size = 'md', className, alt = '' }: ITinyIconProps) => {
    const px = typeof size === 'number' ? size : (SIZE_PX[size] ?? 18);
    if (isImageUrl(icon)) {
        return (
            <img
                src={icon}
                alt={alt}
                draggable={false}
                className={className}
                style={{
                    width: px,
                    height: px,
                    objectFit: 'contain',
                    verticalAlign: 'middle',
                    display: 'inline-block',
                }}
            />
        );
    }
    return (
        <span className={className} style={{ fontSize: px, lineHeight: 1, verticalAlign: 'middle' }}>
            {icon.includes(':') ? <EmojiText>{icon}</EmojiText> : <GameIcon name={icon} />}
        </span>
    );
};

export default TinyIcon;
