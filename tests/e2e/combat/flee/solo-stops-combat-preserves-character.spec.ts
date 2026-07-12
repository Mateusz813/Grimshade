
import { test, expect, type Page } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';

const pickCharacterAndEnterTown = async (page: Page, nick: string): Promise<void> => {
    await page.goto('/character-select');
    const card = page.locator('.char-select__card', {
        has: page.locator('.char-select__card-name', { hasText: nick }),
    });
    await expect(card).toBeVisible({ timeout: 15_000 });
    await card.getByRole('button', { name: /Wybierz/i }).tap();
    await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
};

interface IFleeSnapshot {
    phase: 'idle' | 'fighting' | 'victory' | 'dead';
    monsterIsNull: boolean;
    waveMonstersCount: number;
    characterHp: number;
    characterMp: number;
    characterLevel: number;
    characterXp: number;
    bagSize: number;
}

const readFleeSnapshot = async (page: Page): Promise<IFleeSnapshot> => {
    return await page.evaluate(async (): Promise<IFleeSnapshot> => {
        const combatMod = await import('/src/stores/combatStore.ts');
        const charMod = await import('/src/stores/characterStore.ts');
        const invMod = await import('/src/stores/inventoryStore.ts');

        const combat = (combatMod as {
            useCombatStore: {
                getState: () => {
                    phase: 'idle' | 'fighting' | 'victory' | 'dead';
                    monster: unknown;
                    waveMonsters: unknown[];
                };
            };
        }).useCombatStore.getState();

        const character = (charMod as {
            useCharacterStore: {
                getState: () => { character: { hp: number; mp: number; level: number; xp: number } | null };
            };
        }).useCharacterStore.getState().character;
        if (!character) throw new Error('[fleeSnapshot] no character hydrated');

        const inv = (invMod as {
            useInventoryStore: { getState: () => { bag: unknown[] } };
        }).useInventoryStore.getState();

        return {
            phase: combat.phase,
            monsterIsNull: combat.monster === null,
            waveMonstersCount: combat.waveMonsters.length,
            characterHp: character.hp,
            characterMp: character.mp,
            characterLevel: character.level,
            characterXp: character.xp,
            bagSize: inv.bag.length,
        };
    });
};

test.describe('Combat › Flee', { tag: '@combat' }, () => {
    test.describe.configure({ timeout: 90_000 });

    test('solo stopCombat() resets phase + preserves character (no penalty, no item loss)', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: { level: 50, highest_level: 50, hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            await loginViaUI(page, testUsers.primary);
            await pickCharacterAndEnterTown(page, nick);

            await page.evaluate(async () => {
                const invMod = await import('/src/stores/inventoryStore.ts');
                const useInventoryStore = (invMod as {
                    useInventoryStore: {
                        getState: () => { addItem: (item: unknown) => boolean };
                    };
                }).useInventoryStore;
                const mkItem = (itemId: string): Record<string, unknown> => ({
                    uuid: `${itemId}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                    itemId,
                    rarity: 'rare',
                    bonuses: {},
                    itemLevel: 1,
                    upgradeLevel: 0,
                });
                for (const itemId of ['iron_sword', 'iron_helmet', 'leather_armor']) {
                    useInventoryStore.getState().addItem(mkItem(itemId));
                }
            });

            await page.evaluate(async () => {
                const engineMod = await import('/src/systems/combatEngine.ts');
                const combatMod = await import('/src/stores/combatStore.ts');
                const engine = engineMod as {
                    getAllMonsters: () => Array<{ id: string }>;
                };
                const useCombatStore = (combatMod as {
                    useCombatStore: {
                        getState: () => {
                            initCombat: (m: unknown, hp: number, mp: number, rarity?: string) => void;
                        };
                        setState: (patch: { playerCurrentHp: number }) => void;
                    };
                }).useCombatStore;
                const rat = engine.getAllMonsters().find((m) => m.id === 'rat');
                if (!rat) throw new Error('[stage fight] rat monster not found');
                useCombatStore.getState().initCombat(rat, 40, 30, 'normal');
                useCombatStore.setState({ playerCurrentHp: 40 });
            });

            const preSnapshot = await readFleeSnapshot(page);
            expect(preSnapshot.phase).toBe('fighting');
            expect(preSnapshot.monsterIsNull).toBe(false);
            expect(preSnapshot.waveMonstersCount).toBeGreaterThanOrEqual(1);
            expect(preSnapshot.characterLevel).toBe(50);
            expect(preSnapshot.characterXp).toBe(0);
            expect(preSnapshot.bagSize).toBe(3);

            await page.evaluate(async () => {
                const engineMod = await import('/src/systems/combatEngine.ts');
                const engine = engineMod as { stopCombat: () => void };
                engine.stopCombat();
            });

            const postSnapshot = await readFleeSnapshot(page);

            expect(postSnapshot.phase).toBe('idle');
            expect(postSnapshot.monsterIsNull).toBe(true);
            expect(postSnapshot.waveMonstersCount).toBe(0);
            expect(postSnapshot.characterHp).toBe(40);
            expect(postSnapshot.characterMp).toBe(30);
            expect(postSnapshot.characterLevel).toBe(50);
            expect(postSnapshot.characterXp).toBe(0);
            expect(postSnapshot.bagSize).toBe(3);
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
