
import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName, type CharacterClass } from '../../fixtures/createCharacter';
import { seedGameSave, findUserIdByEmail } from '../../fixtures/seedGameSave';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { runCombatViaSkip, getCharacterSnapshot } from '../../fixtures/combatSim';
import { DMG_ELIXIR_TIER_MULT } from '../../fixtures/balance';

interface IElixirVariant {
    buffId: string;
    effect: string;
    name: string;
    icon: string;
    klass: CharacterClass;
    expectedMultiplier: number;
    helperImport: { module: string; export: string };
    description: string;
}

const VARIANTS: IElixirVariant[] = [
    {
        buffId: 'atk_dmg_50',
        effect: 'atk_dmg_50',
        name: 'ATK DMG +50%',
        icon: 'crossed-swords',
        klass: 'Knight',
        expectedMultiplier: DMG_ELIXIR_TIER_MULT.t50,
        helperImport: { module: '/src/systems/combatElixirs.ts', export: 'getAtkDamageMultiplier' },
        description: '+50% ATK damage tier (Knight)',
    },
    {
        buffId: 'hp_pct_25',
        effect: 'hp_pct_25',
        name: 'Max HP +25%',
        icon: 'heart-on-fire',
        klass: 'Knight',
        expectedMultiplier: 1.25,
        helperImport: { module: '/src/systems/combatElixirs.ts', export: 'getElixirHpPctMultiplier' },
        description: '+25% Max HP (Knight)',
    },
    {
        buffId: 'mp_pct_25',
        effect: 'mp_pct_25',
        name: 'Max MP +25%',
        icon: 'diamond-with-a-dot',
        klass: 'Mage',
        expectedMultiplier: 1.25,
        helperImport: { module: '/src/systems/combatElixirs.ts', export: 'getElixirMpPctMultiplier' },
        description: '+25% Max MP (Mage — visible delta vs Knight)',
    },
    {
        buffId: 'xp_boost',
        effect: 'xp_boost',
        name: 'XP +50%',
        icon: 'star',
        klass: 'Knight',
        expectedMultiplier: 1.5,
        helperImport: { module: '/src/stores/buffStore.ts', export: 'useBuffStore' },
        description: '+50% XP reward (Knight) — reward-side, not damage-side',
    },
];

test.describe('Shop › Elixirs', { tag: '@shop' }, () => {
    test.describe.configure({ timeout: 120_000 });

    for (const variant of VARIANTS) {
        test(`${variant.buffId} buff active -> SKIP fight against rat resolves to victory + multiplier helper confirms ${variant.expectedMultiplier}× — ${variant.description}`, async ({ page }) => {
            const nick = generateTestCharacterName();
            let createdId: string | null = null;

            try {
                const created = await createCharacterViaApi({
                    userEmail: testUsers.secondary.email,
                    name: nick,
                    class: variant.klass,
                    overrides: { hp_regen: 0, mp_regen: 0 },
                });
                createdId = created.id;

                const userId = await findUserIdByEmail(testUsers.secondary.email);
                await seedGameSave({
                    characterId: createdId,
                    userId,
                    buffs: [
                        {
                            id: variant.buffId,
                            name: variant.name,
                            icon: variant.icon,
                            effect: variant.effect,
                        },
                    ],
                });

                await loginViaUI(page, testUsers.secondary);
                await page.goto('/character-select');
                const card = page.locator('.char-select__card', {
                    has: page.locator('.char-select__card-name', { hasText: nick }),
                });
                await expect(card).toBeVisible({ timeout: 15_000 });
                await card.getByRole('button', { name: /Wybierz/i }).tap();
                await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
                await expect(page.locator('.town__char-name')).toHaveText(nick, { timeout: 10_000 });

                const hasBuffOnEnter = await page.evaluate(async (effect) => {
                    const mod = await import('/src/stores/buffStore.ts');
                    return (mod as {
                        useBuffStore: { getState: () => { hasBuff: (e: string) => boolean } };
                    }).useBuffStore.getState().hasBuff(effect);
                }, variant.effect);
                expect(hasBuffOnEnter).toBe(true);

                const multiplier = await page.evaluate(async (v) => {
                    if (v.helperImport.export === 'useBuffStore') {
                        const mod = await import(v.helperImport.module);
                        const store = (mod as {
                            useBuffStore: { getState: () => { getBuffMultiplier: (e: string) => number } };
                        }).useBuffStore.getState();
                        return store.getBuffMultiplier(v.effect);
                    }
                    const mod = await import(v.helperImport.module);
                    const helper = (mod as Record<string, unknown>)[v.helperImport.export] as () => number;
                    return helper();
                }, variant);
                expect(multiplier).toBe(variant.expectedMultiplier);

                const before = await getCharacterSnapshot(page);
                expect(before).not.toBeNull();
                const preXp = before!.xp;

                const result = await runCombatViaSkip(page, 'rat');

                expect(result.phase).toBe('victory');

                expect(result.earnedXp).toBeGreaterThan(0);

                expect(result.sessionKills.normal).toBeGreaterThanOrEqual(1);

                const after = await getCharacterSnapshot(page);
                expect(after).not.toBeNull();
                expect(after!.xp).toBeGreaterThan(preXp);

                const hasBuffOnExit = await page.evaluate(async (effect) => {
                    const mod = await import('/src/stores/buffStore.ts');
                    return (mod as {
                        useBuffStore: { getState: () => { hasBuff: (e: string) => boolean } };
                    }).useBuffStore.getState().hasBuff(effect);
                }, variant.effect);
                expect(hasBuffOnExit).toBe(true);
            } finally {
                if (createdId) {
                    await cleanupCharacterById(createdId);
                }
            }
        });
    }
});
