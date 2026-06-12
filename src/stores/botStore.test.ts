import { describe, it, expect, beforeEach } from 'vitest';
import { useBotStore } from './botStore';
import type { IBot } from '../types/bot';

// -- Fixtures -----------------------------------------------------------------

const makeBot = (overrides?: Partial<IBot>): IBot => ({
    id: 'bot_test_1',
    name: 'Test Knight',
    class: 'Knight',
    level: 10,
    hp: 200,
    maxHp: 200,
    mp: 50,
    maxMp: 50,
    attack: 20,
    defense: 10,
    attackSpeed: 2,
    critChance: 5,
    magicLevel: 0,
    skillId: 'shield_bash',
    skillDamageMultiplier: 1.5,
    skillMpCost: 10,
    skillCooldownMs: 5000,
    alive: true,
    ...overrides,
});

beforeEach(() => {
    useBotStore.setState({ bots: [] });
});

// -- generateBots -------------------------------------------------------------

describe('generateBots', () => {
    it('produces a roster of 3 bots for the given player level', () => {
        useBotStore.getState().generateBots(20, 'Knight');
        const bots = useBotStore.getState().bots;
        expect(bots).toHaveLength(3);
        // All bots start alive at full HP.
        for (const b of bots) {
            expect(b.alive).toBe(true);
            expect(b.hp).toBe(b.maxHp);
        }
    });

    it('does NOT roll the player\'s class into the companion list', () => {
        // generateBotParty intentionally excludes the player class so the
        // synthetic party has variety.
        useBotStore.getState().generateBots(20, 'Mage');
        for (const b of useBotStore.getState().bots) {
            expect(b.class).not.toBe('Mage');
        }
    });

    it('overwrites any previous bot roster (fresh start, no leftovers)', () => {
        useBotStore.setState({ bots: [makeBot()] });
        useBotStore.getState().generateBots(10, 'Knight');
        // The single seeded bot should be gone, replaced by the new 3.
        expect(useBotStore.getState().bots).toHaveLength(3);
        expect(useBotStore.getState().bots.find((b) => b.id === 'bot_test_1')).toBeUndefined();
    });
});

// -- generateBotsCustom -------------------------------------------------------

describe('generateBotsCustom', () => {
    it('creates exactly the requested classes in order', () => {
        useBotStore.getState().generateBotsCustom(15, ['Cleric', 'Archer', 'Rogue']);
        const classes = useBotStore.getState().bots.map((b) => b.class);
        expect(classes).toEqual(['Cleric', 'Archer', 'Rogue']);
    });

    it('handles an empty class list — produces an empty roster', () => {
        useBotStore.getState().generateBotsCustom(10, []);
        expect(useBotStore.getState().bots).toHaveLength(0);
    });

    it('allows duplicate classes (manual builder may want 2 of the same role)', () => {
        useBotStore.getState().generateBotsCustom(10, ['Cleric', 'Cleric']);
        expect(useBotStore.getState().bots).toHaveLength(2);
        expect(useBotStore.getState().bots[0].class).toBe('Cleric');
        expect(useBotStore.getState().bots[1].class).toBe('Cleric');
    });
});

// -- updateBotHp --------------------------------------------------------------

describe('updateBotHp', () => {
    it('overwrites the bot\'s HP with the new value', () => {
        useBotStore.setState({ bots: [makeBot({ id: 'b1', hp: 200, maxHp: 200 })] });
        useBotStore.getState().updateBotHp('b1', 50);
        expect(useBotStore.getState().bots[0].hp).toBe(50);
    });

    it('clamps negative HP to 0 and flips `alive` to false', () => {
        useBotStore.setState({ bots: [makeBot({ id: 'b1', hp: 200, maxHp: 200 })] });
        useBotStore.getState().updateBotHp('b1', -50);
        const bot = useBotStore.getState().bots[0];
        expect(bot.hp).toBe(0);
        expect(bot.alive).toBe(false);
    });

    it('keeps `alive` true while HP stays above 0', () => {
        useBotStore.setState({ bots: [makeBot({ id: 'b1', hp: 200, maxHp: 200 })] });
        useBotStore.getState().updateBotHp('b1', 1);
        expect(useBotStore.getState().bots[0].alive).toBe(true);
    });

    it('does nothing when the bot id is unknown', () => {
        const initial = [makeBot({ id: 'b1' }), makeBot({ id: 'b2' })];
        useBotStore.setState({ bots: initial });
        useBotStore.getState().updateBotHp('nope', 99);
        // Reference equality not preserved (the store .map()s) but values must match.
        const after = useBotStore.getState().bots;
        expect(after).toHaveLength(2);
        expect(after[0].hp).toBe(initial[0].hp);
        expect(after[1].hp).toBe(initial[1].hp);
    });

    it('updates only the targeted bot, leaves siblings untouched', () => {
        useBotStore.setState({ bots: [makeBot({ id: 'b1', hp: 200 }), makeBot({ id: 'b2', hp: 200 })] });
        useBotStore.getState().updateBotHp('b1', 100);
        const bots = useBotStore.getState().bots;
        expect(bots.find((b) => b.id === 'b1')!.hp).toBe(100);
        expect(bots.find((b) => b.id === 'b2')!.hp).toBe(200);
    });
});

// -- updateBotMp --------------------------------------------------------------

describe('updateBotMp', () => {
    it('overwrites MP with the new value', () => {
        useBotStore.setState({ bots: [makeBot({ id: 'b1', mp: 50, maxMp: 50 })] });
        useBotStore.getState().updateBotMp('b1', 10);
        expect(useBotStore.getState().bots[0].mp).toBe(10);
    });

    it('clamps negative MP to 0', () => {
        useBotStore.setState({ bots: [makeBot({ id: 'b1', mp: 50 })] });
        useBotStore.getState().updateBotMp('b1', -5);
        expect(useBotStore.getState().bots[0].mp).toBe(0);
    });

    it('does NOT touch `alive` even when MP hits 0', () => {
        useBotStore.setState({ bots: [makeBot({ id: 'b1', mp: 50, alive: true })] });
        useBotStore.getState().updateBotMp('b1', 0);
        expect(useBotStore.getState().bots[0].alive).toBe(true);
    });
});

// -- killBot ------------------------------------------------------------------

describe('killBot', () => {
    it('zeros HP and flips alive to false', () => {
        useBotStore.setState({ bots: [makeBot({ id: 'b1', hp: 150, alive: true })] });
        useBotStore.getState().killBot('b1');
        const bot = useBotStore.getState().bots[0];
        expect(bot.hp).toBe(0);
        expect(bot.alive).toBe(false);
    });

    it('is a safe no-op for unknown ids', () => {
        useBotStore.setState({ bots: [makeBot({ id: 'b1' })] });
        expect(() => useBotStore.getState().killBot('ghost')).not.toThrow();
        expect(useBotStore.getState().bots[0].alive).toBe(true);
    });
});

// -- getAliveBots -------------------------------------------------------------

describe('getAliveBots', () => {
    it('returns only bots flagged alive', () => {
        useBotStore.setState({
            bots: [
                makeBot({ id: 'b1', alive: true }),
                makeBot({ id: 'b2', alive: false }),
                makeBot({ id: 'b3', alive: true }),
            ],
        });
        const alive = useBotStore.getState().getAliveBots();
        expect(alive.map((b) => b.id)).toEqual(['b1', 'b3']);
    });

    it('returns an empty list when nothing is alive', () => {
        useBotStore.setState({
            bots: [makeBot({ id: 'b1', alive: false }), makeBot({ id: 'b2', alive: false })],
        });
        expect(useBotStore.getState().getAliveBots()).toHaveLength(0);
    });
});

// -- clearBots ----------------------------------------------------------------

describe('clearBots', () => {
    it('empties the bot roster', () => {
        useBotStore.setState({ bots: [makeBot({ id: 'b1' }), makeBot({ id: 'b2' })] });
        useBotStore.getState().clearBots();
        expect(useBotStore.getState().bots).toEqual([]);
    });
});
