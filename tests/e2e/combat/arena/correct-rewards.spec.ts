
import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';

interface IArenaSnapshot {
    arenaPointsInInventory: number;
    mySeasonAp: number;
    myLeaguePoints: number;
    matchLogLength: number;
    matchesWon: number;
    myCompetitorId: string | null;
    firstBotId: string | null;
}

const getArenaSnapshot = async (
    page: import('@playwright/test').Page,
): Promise<IArenaSnapshot> => {
    return await page.evaluate(async (): Promise<IArenaSnapshot> => {
        const arenaMod = await import('/src/stores/arenaStore.ts');
        const invMod = await import('/src/stores/inventoryStore.ts');
        const charMod = await import('/src/stores/characterStore.ts');

        const arenaState = (arenaMod as {
            useArenaStore: {
                getState: () => {
                    currentArena: {
                        competitors: Array<{
                            id: string;
                            isBot: boolean;
                            seasonArenaPoints: number;
                            leaguePoints: number;
                        }>;
                    } | null;
                    matchLog: unknown[];
                    stats: { matchesWon: number };
                };
            };
        }).useArenaStore.getState();

        const character = (charMod as {
            useCharacterStore: { getState: () => { character: { id?: string } | null } };
        }).useCharacterStore.getState().character;

        const myCompId = character?.id ? `player_${character.id}` : null;
        const me = arenaState.currentArena?.competitors.find((c) => c.id === myCompId);
        const firstBot = arenaState.currentArena?.competitors.find((c) => c.isBot) ?? null;

        const inv = (invMod as {
            useInventoryStore: { getState: () => { arenaPoints: number } };
        }).useInventoryStore.getState();

        return {
            arenaPointsInInventory: inv.arenaPoints,
            mySeasonAp: me?.seasonArenaPoints ?? 0,
            myLeaguePoints: me?.leaguePoints ?? 0,
            matchLogLength: arenaState.matchLog.length,
            matchesWon: arenaState.stats.matchesWon,
            myCompetitorId: myCompId,
            firstBotId: firstBot?.id ?? null,
        };
    });
};

test.describe('Combat › Arena', { tag: '@combat' }, () => {
    test.describe.configure({ timeout: 90_000 });

    test('finalizeMatch attacker-down win: AP+=100, LP+=1, log+=1, matchesWon+=1', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: { level: 10, highest_level: 10, hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            await loginViaUI(page, testUsers.primary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 10_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
            await expect(page.locator('.top-header')).toBeVisible({ timeout: 10_000 });

            await page.goto('/arena');
            await expect(page).toHaveURL(/\/arena$/, { timeout: 10_000 });
            await expect(page.locator('.arena__league-strip')).toBeVisible({ timeout: 15_000 });

            const before = await getArenaSnapshot(page);
            expect(before.myCompetitorId).not.toBeNull();
            expect(before.firstBotId).not.toBeNull();
            expect(before.arenaPointsInInventory).toBe(0);
            expect(before.mySeasonAp).toBe(0);
            expect(before.myLeaguePoints).toBe(0);
            expect(before.matchLogLength).toBe(0);
            expect(before.matchesWon).toBe(0);

            const after = await page.evaluate(async (args) => {
                const arenaMod = await import('/src/stores/arenaStore.ts');
                const invMod = await import('/src/stores/inventoryStore.ts');
                const arena = (arenaMod as {
                    useArenaStore: {
                        getState: () => {
                            finalizeMatch: (m: unknown) => unknown;
                            currentArena: { competitors: Array<{ id: string; seasonArenaPoints: number; leaguePoints: number }> } | null;
                            matchLog: unknown[];
                            stats: { matchesWon: number };
                        };
                    };
                }).useArenaStore;
                arena.getState().finalizeMatch({
                    myCompetitorId: args.myCompetitorId,
                    opponentId: args.firstBotId,
                    attackerWon: true,
                    attackerIsHigher: false,
                    opponentName: 'TestOpponent',
                    opponentClass: 'Mage',
                    opponentLevel: 10,
                });
                const st = arena.getState();
                const me = st.currentArena?.competitors.find((c) => c.id === args.myCompetitorId);
                const inv = (invMod as {
                    useInventoryStore: { getState: () => { arenaPoints: number } };
                }).useInventoryStore.getState();
                return {
                    arenaPointsInInventory: inv.arenaPoints,
                    mySeasonAp: me?.seasonArenaPoints ?? 0,
                    myLeaguePoints: me?.leaguePoints ?? 0,
                    matchLogLength: st.matchLog.length,
                    matchesWon: st.stats.matchesWon,
                };
            }, { myCompetitorId: before.myCompetitorId!, firstBotId: before.firstBotId! });

            expect(after.arenaPointsInInventory).toBe(before.arenaPointsInInventory + 100);

            expect(after.mySeasonAp).toBe(before.mySeasonAp + 100);

            expect(after.myLeaguePoints).toBe(before.myLeaguePoints + 1);

            expect(after.matchLogLength).toBe(before.matchLogLength + 1);

            expect(after.matchesWon).toBe(before.matchesWon + 1);
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
