
import {
    getBossImage,
    getBossImageNearest,
    getMonsterImage,
    getMonsterImageNearest,
} from '../../../systems/spriteAssets';

interface ISpriteProps {
    level: number;
    sprite?: string;
    name?: string;
    className?: string;
    style?: React.CSSProperties;
    fill?: boolean;
}

const renderImage = (
    url: string,
    name: string | undefined,
    className: string | undefined,
    style: React.CSSProperties | undefined,
    fill: boolean,
) => (
    <img
        src={url}
        alt={name ?? ''}
        draggable={false}
        className={className}
        style={fill ? {
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            display: 'block',
            ...style,
        } : style}
    />
);

const renderEmoji = (
    sprite: string | undefined,
    className: string | undefined,
    style: React.CSSProperties | undefined,
) => (
    <span className={className} style={style} aria-hidden="true">
        {sprite ?? 'alien-monster'}
    </span>
);

export const MonsterSprite = ({ level, sprite, name, className, style, fill = true }: ISpriteProps) => {
    const url = getMonsterImage(level) ?? getMonsterImageNearest(level);
    return url
        ? renderImage(url, name, className, style, fill)
        : renderEmoji(sprite, className, style);
};

export const BossSprite = ({ level, sprite, name, className, style, fill = true }: ISpriteProps) => {
    const url = getBossImage(level) ?? getBossImageNearest(level);
    return url
        ? renderImage(url, name, className, style, fill)
        : renderEmoji(sprite, className, style);
};
