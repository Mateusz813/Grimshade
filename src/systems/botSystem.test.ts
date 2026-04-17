import { describe, it, expect } from 'vitest';
import {
    generateBot,
    generateBotParty,
    calculateBotAction,
    pickAggroTarget,
    calculateAoeDamage,
    isBossAoeTurn,
    getAggroSwitchInterval,
} from './botSystem';
import type { IBoss } from './bossSystem';

const mockBoss: IBoss = {
    id: 'test_boss',
    name_pl: 'Test Boss',
    name_en: 'Test Boss',
    level: 25,
    hp: 5000,
    attack: 50,
    defense: 20,
    speed: 1.5,
    xp: 1000,
    gold: [100, 500],
    sprite: '👹',
    description_pl: 'Test boss description',
};

describe('generateBot', () => {
    it('should generate a bot with valid properties', () => {
        const bot = generateBot(10, 'Knight', []);
        expect(bot.id).toBeTruthy();
        expect(bot.name).toBeTruthy();
        expect(bot.class).toBeTruthy();
        expect(bot.class).not.toBe('Knight');
        expect(bot.level).toBeGreaterThanOrEqual(8);
        expect(bot.level).toBeLessThanOrEqual(12);
        expect(bot.hp).toBeGreaterThan(0);
        expect(bot.maxHp).toBeGreaterThan(0);
        expect(bot.attack).toBeGreaterThan(0);
        expect(bot.defense).toBeGreaterThanOrEqual(0);
        expect(bot.alive).toBe(true);
    });

    it('should not pick excluded classes', () => {
        const bot = generateBot(10, 'Knight', ['Mage', 'Cleric', 'Archer', 'Rogue', 'Necromancer']);
        expect(bot.class).toBe('Bard');
    });

    it('should generate bot at level >= 1 even for low player levels', () => {
        const bot = generateBot(1, 'Knight', []);
        expect(bot.level).toBeGreaterThanOrEqual(1);
    });

    it('should never produce NaN stats', () => {
        const bot = generateBot(100, 'Mage', []);
        expect(Number.isNaN(bot.hp)).toBe(false);
        expect(Number.isNaN(bot.maxHp)).toBe(false);
        expect(Number.isNaN(bot.mp)).toBe(false);
        expect(Number.isNaN(bot.attack)).toBe(false);
        expect(Number.isNaN(bot.defense)).toBe(false);
    });
});

describe('generateBotParty', () => {
    it('should generate 3 bots by default', () => {
        const bots = generateBotParty(10, 'Knight');
        expect(bots).toHaveLength(3);
    });

    it('should generate bots with different classes', () => {
        const bots = generateBotParty(10, 'Knight', 3);
        const classes = bots.map((b) => b.class);
        const uniqueClasses = new Set(classes);
        expect(uniqueClasses.size).toBe(3);
    });

    it('should not include player class in bot classes', () => {
        const bots = generateBotParty(10, 'Knight', 3);
        for (const bot of bots) {
            expect(bot.class).not.toBe('Knight');
        }
    });

    it('should handle custom count', () => {
        const bots = generateBotParty(10, 'Knight', 2);
        expect(bots).toHaveLength(2);
    });
});

describe('calculateBotAction', () => {
    it('should return attack action with positive damage', () => {
        const bot = generateBot(25, 'Knight', []);
        const action = calculateBotAction(bot, mockBoss, false);
        expect(action.type).toBe('attack');
        expect(action.damage).toBeGreaterThan(0);
        expect(action.botId).toBe(bot.id);
        expect(action.botName).toBe(bot.name);
    });

    it('should return skill action when canUseSkill is true and bot has MP', () => {
        const bot = generateBot(25, 'Knight', []);
        // Ensure bot has a skill and enough MP
        if (bot.skillId && bot.mp >= bot.skillMpCost && bot.skillDamageMultiplier > 0) {
            const action = calculateBotAction(bot, mockBoss, true);
            expect(action.type).toBe('skill');
            expect(action.damage).toBeGreaterThan(0);
            expect(action.skillName).toBeTruthy();
        }
    });

    it('should never return NaN damage', () => {
        const bot = generateBot(1, 'Mage', []);
        const action = calculateBotAction(bot, mockBoss, false);
        expect(Number.isNaN(action.damage)).toBe(false);
    });
});

describe('pickAggroTarget', () => {
    it('should return player when no bots alive', () => {
        const target = pickAggroTarget([]);
        expect(target).toBe('player');
    });

    it('should return either player or a bot id', () => {
        const targets = new Set<string>();
        for (let i = 0; i < 100; i++) {
            targets.add(pickAggroTarget(['bot_1', 'bot_2']));
        }
        // With 100 attempts, all options should appear
        expect(targets.has('player')).toBe(true);
        expect(targets.size).toBeGreaterThan(1);
    });
});

describe('calculateAoeDamage', () => {
    it('should return 50% of base damage', () => {
        const dmg = calculateAoeDamage(100, 20);
        expect(dmg).toBe(40); // (100 - 20) * 0.5 = 40
    });

    it('should return minimum 1 damage', () => {
        const dmg = calculateAoeDamage(1, 1000);
        expect(dmg).toBeGreaterThanOrEqual(1);
    });

    it('should never return NaN', () => {
        const dmg = calculateAoeDamage(0, 0);
        expect(Number.isNaN(dmg)).toBe(false);
    });
});

describe('isBossAoeTurn', () => {
    it('should return true for every 5th turn', () => {
        expect(isBossAoeTurn(5)).toBe(true);
        expect(isBossAoeTurn(10)).toBe(true);
        expect(isBossAoeTurn(15)).toBe(true);
    });

    it('should return false for non-5th turns', () => {
        expect(isBossAoeTurn(0)).toBe(false);
        expect(isBossAoeTurn(1)).toBe(false);
        expect(isBossAoeTurn(3)).toBe(false);
        expect(isBossAoeTurn(7)).toBe(false);
    });
});

describe('getAggroSwitchInterval', () => {
    it('should return a value between 3 and 5', () => {
        for (let i = 0; i < 50; i++) {
            const interval = getAggroSwitchInterval();
            expect(interval).toBeGreaterThanOrEqual(3);
            expect(interval).toBeLessThanOrEqual(5);
        }
    });
});
