/**
 * Guild logo + colour palettes.
 *
 * 20 distinct emoji icons cover every fantasy banner the create-guild
 * picker exposes; 20 palette swatches give the player a wide hue range
 * for the background tile so two guilds with the same icon still feel
 * visually distinct on the list.
 *
 * Both arrays are stable IDs — what we store in `guilds.logo` and
 * `guilds.color` server-side is the icon id (string) and the colour hex.
 * The picker and every list row look the icon up by id; the colour goes
 * straight into a CSS variable.
 */

export interface IGuildIcon {
    id: string;
    icon: string;
    label: string;
}

export const GUILD_ICONS: IGuildIcon[] = [
    { id: 'castle',     icon: '🏰', label: 'Zamek' },
    { id: 'dragon',     icon: '🐉', label: 'Smok' },
    { id: 'shield',     icon: '🛡️', label: 'Tarcza' },
    { id: 'sword',      icon: '⚔️', label: 'Miecze' },
    { id: 'crown',      icon: '👑', label: 'Korona' },
    { id: 'phoenix',    icon: '🦅', label: 'Feniks' },
    { id: 'wolf',       icon: '🐺', label: 'Wilk' },
    { id: 'lion',       icon: '🦁', label: 'Lew' },
    { id: 'skull',      icon: '💀', label: 'Czaszka' },
    { id: 'demon',      icon: '👹', label: 'Demon' },
    { id: 'angel',      icon: '😇', label: 'Anioł' },
    { id: 'star',       icon: '⭐', label: 'Gwiazda' },
    { id: 'flame',      icon: '🔥', label: 'Płomień' },
    { id: 'snowflake',  icon: '❄️', label: 'Śnieżynka' },
    { id: 'thunder',    icon: '⚡', label: 'Piorun' },
    { id: 'leaf',       icon: '🌿', label: 'Liść' },
    { id: 'gem',        icon: '💎', label: 'Klejnot' },
    { id: 'moon',       icon: '🌙', label: 'Księżyc' },
    { id: 'sun',        icon: '☀️', label: 'Słońce' },
    { id: 'eye',        icon: '👁️', label: 'Oko' },
];

/** Hex colour swatches for the guild banner background tile. */
export const GUILD_COLORS: string[] = [
    '#e53935', // red
    '#d81b60', // pink
    '#8e24aa', // purple
    '#5e35b1', // deep purple
    '#3949ab', // indigo
    '#1e88e5', // blue
    '#039be5', // light blue
    '#00acc1', // cyan
    '#00897b', // teal
    '#43a047', // green
    '#7cb342', // light green
    '#c0ca33', // lime
    '#fdd835', // yellow
    '#ffb300', // amber
    '#fb8c00', // orange
    '#f4511e', // deep orange
    '#6d4c41', // brown
    '#546e7a', // blue grey
    '#bdbdbd', // grey
    '#212121', // near black
];

/** Look up the rendered icon glyph for a stored logo id. Falls back to
 *  the castle when the id isn't recognised (e.g. legacy row from before
 *  an icon was renamed). */
export const getGuildIcon = (id: string): string => {
    return GUILD_ICONS.find((g) => g.id === id)?.icon ?? '🏰';
};
