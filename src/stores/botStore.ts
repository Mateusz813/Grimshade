import { create } from 'zustand';
import type { TCharacterClass } from '../types/character';
import type { IBot } from '../types/bot';
import { generateBotParty, generateBotWithClass } from '../systems/botSystem';

interface IBotStore {
    bots: IBot[];
    /** Generate 3 bot companions for a boss fight */
    generateBots: (playerLevel: number, playerClass: TCharacterClass) => void;
    /** Generate bots with explicit class picks (manual party builder) */
    generateBotsCustom: (playerLevel: number, botClasses: TCharacterClass[]) => void;
    /** Update a specific bot's HP after taking damage */
    updateBotHp: (botId: string, newHp: number) => void;
    /** Update a specific bot's MP after using a skill */
    updateBotMp: (botId: string, newMp: number) => void;
    /** Mark a bot as dead */
    killBot: (botId: string) => void;
    /** Get all alive bots */
    getAliveBots: () => IBot[];
    /** Reset bots (clear party) */
    clearBots: () => void;
}

export const useBotStore = create<IBotStore>()((set, get) => ({
    bots: [],

    generateBots: (playerLevel, playerClass) => {
        const bots = generateBotParty(playerLevel, playerClass, 3);
        set({ bots });
    },

    generateBotsCustom: (playerLevel, botClasses) => {
        const bots = botClasses.map((cls) => generateBotWithClass(playerLevel, cls));
        set({ bots });
    },

    updateBotHp: (botId, newHp) =>
        set((s) => ({
            bots: s.bots.map((b) => {
                if (b.id !== botId) return b;
                const clampedHp = Math.max(0, newHp);
                return {
                    ...b,
                    hp: clampedHp,
                    alive: clampedHp > 0,
                };
            }),
        })),

    updateBotMp: (botId, newMp) =>
        set((s) => ({
            bots: s.bots.map((b) =>
                b.id === botId ? { ...b, mp: Math.max(0, newMp) } : b,
            ),
        })),

    killBot: (botId) =>
        set((s) => ({
            bots: s.bots.map((b) =>
                b.id === botId ? { ...b, hp: 0, alive: false } : b,
            ),
        })),

    getAliveBots: () => get().bots.filter((b) => b.alive),

    clearBots: () => set({ bots: [] }),
}));
