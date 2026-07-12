import { isImageUrl } from '../../../systems/spriteAssets';
import GameIcon from '../../atoms/Twemoji/GameIcon';
import EmojiText from '../../atoms/Twemoji/EmojiText';

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
