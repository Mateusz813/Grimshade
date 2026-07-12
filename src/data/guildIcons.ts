
export interface IGuildIcon {
    id: string;
    icon: string;
    label: string;
}

export const GUILD_ICONS: IGuildIcon[] = [
    { id: 'castle',     icon: 'castle', label: 'Zamek' },
    { id: 'dragon',     icon: 'dragon', label: 'Smok' },
    { id: 'shield',     icon: 'shield', label: 'Tarcza' },
    { id: 'sword',      icon: 'crossed-swords', label: 'Miecze' },
    { id: 'crown',      icon: 'crown', label: 'Korona' },
    { id: 'phoenix',    icon: 'eagle', label: 'Feniks' },
    { id: 'wolf',       icon: 'wolf', label: 'Wilk' },
    { id: 'lion',       icon: 'lion', label: 'Lew' },
    { id: 'skull',      icon: 'skull', label: 'Czaszka' },
    { id: 'demon',      icon: 'ogre', label: 'Demon' },
    { id: 'angel',      icon: 'smiling-face-with-halo', label: 'Anioł' },
    { id: 'star',       icon: 'star', label: 'Gwiazda' },
    { id: 'flame',      icon: 'fire', label: 'Płomień' },
    { id: 'snowflake',  icon: 'snowflake', label: 'Śnieżynka' },
    { id: 'thunder',    icon: 'high-voltage', label: 'Piorun' },
    { id: 'leaf',       icon: 'herb', label: 'Liść' },
    { id: 'gem',        icon: 'gem-stone', label: 'Klejnot' },
    { id: 'moon',       icon: 'crescent-moon', label: 'Księżyc' },
    { id: 'sun',        icon: 'sun', label: 'Słońce' },
    { id: 'eye',        icon: 'eye', label: 'Oko' },
];

export const GUILD_COLORS: string[] = [
    '#e53935',
    '#d81b60',
    '#8e24aa',
    '#5e35b1',
    '#3949ab',
    '#1e88e5',
    '#039be5',
    '#00acc1',
    '#00897b',
    '#43a047',
    '#7cb342',
    '#c0ca33',
    '#fdd835',
    '#ffb300',
    '#fb8c00',
    '#f4511e',
    '#6d4c41',
    '#546e7a',
    '#bdbdbd',
    '#212121',
];

export const getGuildIcon = (id: string): string => {
    return GUILD_ICONS.find((g) => g.id === id)?.icon ?? 'castle';
};
