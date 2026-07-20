import type { TCharacterClass } from '../types/character';
import type { IBot, IBotAction } from '../types/bot';
import type { IBoss } from './bossSystem';
import classesData from '../data/classes.json';
import skillsData from '../data/skills.json';
import { mitigateDamage, compressPlayerDamage } from './combat';


interface IClassData {
    id: string;
    baseStats: { hp: number; mp: number; attack: number; defense: number; speed: number };
    classModifier: number;
    hpPerLevel: number;
    mpPerLevel: number;
    attackPerLevel: number;
    defensePerLevel: number;
    classColor: string;
}

const CLASS_DATA: Record<TCharacterClass, IClassData> = {} as Record<TCharacterClass, IClassData>;
for (const cls of classesData as IClassData[]) {
    CLASS_DATA[cls.id as TCharacterClass] = cls;
}


const ALL_CLASSES: TCharacterClass[] = ['Knight', 'Mage', 'Cleric', 'Archer', 'Rogue', 'Necromancer', 'Bard'];


const BOT_NAMES: Record<TCharacterClass, string[]> = {
    Knight:      ['Sir Aldric', 'Sir Gavain', 'Dame Irina', 'Sir Borin', 'Dame Elsa', 'Sir Tormund', 'Dame Kira'],
    Mage:        ['Mystic Elara', 'Archmage Zed', 'Sorceress Lyra', 'Magus Kael', 'Enchanter Nyx', 'Sage Orin', 'Witch Mira'],
    Cleric:      ['Brother Amon', 'Sister Celeste', 'Father Egan', 'Priestess Nara', 'Deacon Piers', 'Mother Thea', 'Abbot Lucius'],
    Archer:      ['Sharp Finn', 'Ranger Kael', 'Huntress Lyssa', 'Bowman Rex', 'Scout Mara', 'Tracker Dain', 'Sniper Vela'],
    Rogue:       ['Shadow Vex', 'Blade Nyx', 'Shade Kira', 'Phantom Rael', 'Whisper Thorn', 'Ghost Sable', 'Dusk Zara'],
    Necromancer: ['Darkis Vol', 'Witch Morrigan', 'Cursed Theron', 'Deathcaller Ula', 'Bonelord Sev', 'Plaguebringer Ash', 'Gravemind Ossa'],
    Bard:        ['Melody Aria', 'Minstrel Jay', 'Troubadour Lute', 'Songbird Faye', 'Rhymer Cal', 'Harmony Sage', 'Balladeer Tine'],
};


export const BOT_CLASS_ICONS: Record<TCharacterClass, string> = {
    Knight: 'crossed-swords',
    Mage: 'crystal-ball',
    Cleric: 'sparkles',
    Archer: 'bow-and-arrow',
    Rogue: 'dagger',
    Necromancer: 'skull',
    Bard: 'musical-note',
};

export const getBotLogIcon = (cls: TCharacterClass): string =>
    `:robot::${BOT_CLASS_ICONS[cls] ?? 'robot'}:`;


interface ISkillInfo {
    id: string;
    name_pl: string;
    damage: number;
    mpCost: number;
    cooldown: number;
}

const FIRST_SKILLS: Record<TCharacterClass, ISkillInfo | null> = {
    Knight: null,
    Mage: null,
    Cleric: null,
    Archer: null,
    Rogue: null,
    Necromancer: null,
    Bard: null,
};

const skillMap: Record<string, unknown[]> = (skillsData as { activeSkills: Record<string, unknown[]> }).activeSkills;
const classKeyMap: Record<TCharacterClass, string> = {
    Knight: 'knight',
    Mage: 'mage',
    Cleric: 'cleric',
    Archer: 'archer',
    Rogue: 'rogue',
    Necromancer: 'necromancer',
    Bard: 'bard',
};

for (const cls of ALL_CLASSES) {
    const skills = skillMap[classKeyMap[cls]];
    if (skills && skills.length > 0) {
        const first = skills[0] as { id: string; name_pl: string; damage: number; mpCost: number; cooldown: number };
        FIRST_SKILLS[cls] = {
            id: first.id,
            name_pl: first.name_pl,
            damage: first.damage,
            mpCost: first.mpCost,
            cooldown: first.cooldown,
        };
    }
}


const BOT_STAT_MULTIPLIER = 0.8;

const calculateBotStats = (level: number, cls: TCharacterClass) => {
    const data = CLASS_DATA[cls];
    if (!data) {
        return { hp: 100, mp: 50, attack: 10, defense: 5, speed: 1, magicLevel: 0 };
    }
    const base = data.baseStats;
    const hp = Math.floor((base.hp + data.hpPerLevel * level) * BOT_STAT_MULTIPLIER);
    const mp = Math.floor((base.mp + data.mpPerLevel * level) * BOT_STAT_MULTIPLIER);
    const attack = Math.floor((base.attack + data.attackPerLevel * level) * BOT_STAT_MULTIPLIER);
    const defense = Math.floor((base.defense + data.defensePerLevel * level) * BOT_STAT_MULTIPLIER);
    const speed = base.speed;
    const magicLevel = (cls === 'Mage' || cls === 'Cleric' || cls === 'Necromancer')
        ? Math.floor(level * 0.3)
        : 0;
    return { hp, mp, attack, defense, speed, magicLevel };
};


let botIdCounter = 0;

export const generateBot = (
    playerLevel: number,
    playerClass: TCharacterClass,
    existingClasses: TCharacterClass[],
): IBot => {
    const excluded = new Set<TCharacterClass>([playerClass, ...existingClasses]);
    const available = ALL_CLASSES.filter((c) => !excluded.has(c));
    const botClass = available.length > 0
        ? available[Math.floor(Math.random() * available.length)]
        : ALL_CLASSES[Math.floor(Math.random() * ALL_CLASSES.length)];

    const levelOffset = Math.floor(Math.random() * 5) - 2;
    const botLevel = Math.max(1, playerLevel + levelOffset);

    const stats = calculateBotStats(botLevel, botClass);

    const names = BOT_NAMES[botClass];
    const name = names[Math.floor(Math.random() * names.length)];

    const skill = FIRST_SKILLS[botClass];

    botIdCounter++;
    return {
        id: `bot_${botIdCounter}_${Date.now()}`,
        name,
        class: botClass,
        level: botLevel,
        hp: stats.hp,
        maxHp: stats.hp,
        mp: stats.mp,
        maxMp: stats.mp,
        attack: stats.attack,
        defense: stats.defense,
        attackSpeed: stats.speed,
        critChance: 5,
        magicLevel: stats.magicLevel,
        skillId: skill?.id ?? null,
        skillDamageMultiplier: skill?.damage ?? 0,
        skillMpCost: skill?.mpCost ?? 0,
        skillCooldownMs: skill?.cooldown ?? 5000,
        alive: true,
    };
};


export const generateBotWithClass = (
    playerLevel: number,
    botClass: TCharacterClass,
): IBot => {
    const levelOffset = Math.floor(Math.random() * 5) - 2;
    const botLevel = Math.max(1, playerLevel + levelOffset);
    const stats = calculateBotStats(botLevel, botClass);
    const names = BOT_NAMES[botClass];
    const name = names[Math.floor(Math.random() * names.length)];
    const skill = FIRST_SKILLS[botClass];

    botIdCounter++;
    return {
        id: `bot_${botIdCounter}_${Date.now()}`,
        name,
        class: botClass,
        level: botLevel,
        hp: stats.hp,
        maxHp: stats.hp,
        mp: stats.mp,
        maxMp: stats.mp,
        attack: stats.attack,
        defense: stats.defense,
        attackSpeed: stats.speed,
        critChance: 5,
        magicLevel: stats.magicLevel,
        skillId: skill?.id ?? null,
        skillDamageMultiplier: skill?.damage ?? 0,
        skillMpCost: skill?.mpCost ?? 0,
        skillCooldownMs: skill?.cooldown ?? 5000,
        alive: true,
    };
};


export const generateBotParty = (
    playerLevel: number,
    playerClass: TCharacterClass,
    count: number = 3,
): IBot[] => {
    const bots: IBot[] = [];
    const usedClasses: TCharacterClass[] = [];
    for (let i = 0; i < count; i++) {
        const bot = generateBot(playerLevel, playerClass, usedClasses);
        usedClasses.push(bot.class);
        bots.push(bot);
    }
    return bots;
};


export const calculateBotAction = (
    bot: IBot,
    boss: IBoss,
    canUseSkill: boolean,
): IBotAction => {
    const baseDmg = mitigateDamage(bot.attack, boss.defense, bot.level, true);
    const variance = Math.floor(baseDmg * 0.2);
    const finalBaseDmg = Math.max(1, baseDmg - variance + Math.floor(Math.random() * (variance * 2 + 1)));

    if (canUseSkill && bot.skillId && bot.mp >= bot.skillMpCost && bot.skillDamageMultiplier > 0) {
        const skillDmg = Math.max(1, Math.floor(compressPlayerDamage(bot.attack * bot.skillDamageMultiplier * 0.15)));
        const skillInfo = FIRST_SKILLS[bot.class];
        return {
            botId: bot.id,
            botName: bot.name,
            type: 'skill',
            damage: skillDmg,
            skillName: skillInfo?.name_pl ?? bot.skillId,
        };
    }

    return {
        botId: bot.id,
        botName: bot.name,
        type: 'attack',
        damage: finalBaseDmg,
    };
};


import { pickWeightedAggroTarget } from './partySystem';
import type { CharacterClass } from '../api/v1/characterApi';

export interface IAggroCandidate {
    id: string;
    class: CharacterClass;
}

export function pickAggroTarget(aliveBotIds: string[]): string;
export function pickAggroTarget(candidates: IAggroCandidate[]): string;
export function pickAggroTarget(arg: string[] | IAggroCandidate[]): string {
    if (arg.length === 0) return 'player';
    if (typeof arg[0] === 'string') {
        const targets = ['player', ...(arg as string[])];
        return targets[Math.floor(Math.random() * targets.length)];
    }
    const candidates = arg as IAggroCandidate[];
    return pickWeightedAggroTarget(candidates) ?? 'player';
}


export const calculateAoeDamage = (
    bossAttack: number,
    targetDefense: number,
    bossLevel: number,
): number => {
    const baseDmg = mitigateDamage(bossAttack, targetDefense, bossLevel);
    return Math.max(1, Math.floor(baseDmg * 0.5));
};


export const isBossAoeTurn = (turnCounter: number): boolean =>
    turnCounter > 0 && turnCounter % 5 === 0;


export const getAggroSwitchInterval = (): number =>
    3 + Math.floor(Math.random() * 3);
