// Shared sprite renderer for monsters & bosses.
//
// Every call site used to do `<span className="...">{m.sprite}</span>`, which
// hard-coded the emoji into the output. Now that the user has shipped real
// PNG art for every monster level (`monster-{lvl}.png`) and boss level
// (`boss-{lvl}.png`), each call site swaps its inline emoji for one of these
// components and gets the image (or emoji fallback) for free.
//
// Both components keep the same outer wrapper element so existing styles and
// container sizing keep working — only the *child* inside the wrapper
// changes from text glyph to <img>. When no PNG exists for that level (or
// the registry hasn't loaded yet) we render the original emoji so nothing
// breaks visually.

import {
    getBossImage,
    getBossImageNearest,
    getMonsterImage,
    getMonsterImageNearest,
} from '../../../systems/spriteAssets';

interface ISpriteProps {
    /** Monster/boss level — used as the lookup key in the sprite registry. */
    level: number;
    /** Original emoji to fall back to if no PNG exists for this level. */
    sprite?: string;
    /** Display name used as the image alt-text for screen readers. */
    name?: string;
    /** ClassName applied to the rendered element (img OR span fallback). */
    className?: string;
    /** Inline style passthrough — used by the hub & wave-slot sizing. */
    style?: React.CSSProperties;
    /** When true, the image fills the parent (object-fit: contain). Default true. */
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

/** Renders the monster art for the given level, or the emoji fallback.
 *  Tries the exact-level PNG first, then the nearest available tier
 *  (closest level walking UP the registry, then DOWN if nothing is
 *  higher) so a level-79 monster reuses the level-80 art instead of
 *  collapsing to the generic :alien-monster: emoji. Combat cards across hunting /
 *  dungeon / boss / raid / transform all flow through this helper, so
 *  every monster slot now shows real artwork. The emoji fallback only
 *  triggers when the entire monster registry is empty (dev-mode
 *  asset misconfig). */
export const MonsterSprite = ({ level, sprite, name, className, style, fill = true }: ISpriteProps) => {
    const url = getMonsterImage(level) ?? getMonsterImageNearest(level);
    return url
        ? renderImage(url, name, className, style, fill)
        : renderEmoji(sprite, className, style);
};

/** Renders the boss art for the given level, or the emoji fallback.
 *  Same nearest-tier fallback as `MonsterSprite` so boss-card art is
 *  never replaced by a :ogre: glyph mid-fight just because the player's
 *  current boss level lacks its own PNG. */
export const BossSprite = ({ level, sprite, name, className, style, fill = true }: ISpriteProps) => {
    const url = getBossImage(level) ?? getBossImageNearest(level);
    return url
        ? renderImage(url, name, className, style, fill)
        : renderEmoji(sprite, className, style);
};
