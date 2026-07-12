
import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { seedConsumables } from '../../fixtures/seedInventory';
import { seedGameSave, findUserIdByEmail } from '../../fixtures/seedGameSave';

test.describe('Combat › Auto-Potion', { tag: '@combat' }, () => {
    test.describe.configure({ timeout: 90_000 });

    test('auto-spell + auto-potion fire in same tick: skill dmg applied + MP consumed + HP healed + no crash', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: {
                    level: 10,
                    highest_level: 10,
                    hp_regen: 0,
                    mp_regen: 0,
                },
            });
            createdId = created.id;

            const userId = await findUserIdByEmail(testUsers.primary.email);
            await seedGameSave({
                characterId: created.id,
                userId,
                skills: {
                    activeSkillSlots: ['shield_bash', null, null, null],
                    unlockedSkills: { shield_bash: true },
                },
            });

            await seedConsumables({
                characterId: created.id,
                counts: { hp_potion_sm: 5 },
            });

            await loginViaUI(page, testUsers.primary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 10_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
            await expect(page.locator('.town__char-name')).toHaveText(nick, { timeout: 10_000 });

            const preCheck = await page.evaluate(async () => {
                const skillMod = await import('/src/stores/skillStore.ts');
                const invMod = await import('/src/stores/inventoryStore.ts');
                const settingsMod = await import('/src/stores/settingsStore.ts');
                const skill = (skillMod as {
                    useSkillStore: { getState: () => { activeSkillSlots: Array<string | null>; unlockedSkills: Record<string, boolean> } };
                }).useSkillStore.getState();
                const inv = (invMod as {
                    useInventoryStore: { getState: () => { consumables: Record<string, number> } };
                }).useInventoryStore.getState();
                const settings = (settingsMod as {
                    useSettingsStore: { getState: () => { skillMode: string; autoPotionHpEnabled: boolean; autoPotionHpId: string } };
                }).useSettingsStore.getState();
                return {
                    slot0: skill.activeSkillSlots[0],
                    shieldBashUnlocked: skill.unlockedSkills['shield_bash'] === true,
                    potionCount: inv.consumables['hp_potion_sm'] ?? 0,
                    skillMode: settings.skillMode,
                    autoPotionHpEnabled: settings.autoPotionHpEnabled,
                    autoPotionHpId: settings.autoPotionHpId,
                };
            });
            expect(preCheck.slot0).toBe('shield_bash');
            expect(preCheck.shieldBashUnlocked).toBe(true);
            expect(preCheck.potionCount).toBe(5);
            expect(preCheck.skillMode).toBe('auto');
            expect(preCheck.autoPotionHpEnabled).toBe(true);
            expect(preCheck.autoPotionHpId).toBe('hp_potion_sm');

            const result = await page.evaluate(async () => {
                const engineMod = await import('/src/systems/combatEngine.ts');
                const combatMod = await import('/src/stores/combatStore.ts');
                const invMod = await import('/src/stores/inventoryStore.ts');
                const cdMod = await import('/src/stores/cooldownStore.ts');
                const charMod = await import('/src/stores/characterStore.ts');

                const engine = engineMod as {
                    doPlayerAttackTick: (autoSkillOnly?: boolean) => void;
                    getAllMonsters: () => Array<{ id: string; hp: number; level: number }>;
                    advanceSkillCooldowns: (ms: number) => void;
                };
                const useCombatStore = (combatMod as {
                    useCombatStore: {
                        getState: () => {
                            initCombat: (m: unknown, hp: number, mp: number, rarity?: string) => void;
                            phase: string;
                            monsterCurrentHp: number;
                            monsterMaxHp: number;
                            playerCurrentHp: number;
                            playerCurrentMp: number;
                            sessionLog: Array<{ id: number; text: string; type: string }>;
                            log: Array<{ id: number; text: string; type: string }>;
                            resetCombat: () => void;
                        };
                    };
                }).useCombatStore;
                const useInventoryStore = (invMod as {
                    useInventoryStore: { getState: () => { consumables: Record<string, number> } };
                }).useInventoryStore;
                const useCooldownStore = (cdMod as {
                    useCooldownStore: {
                        getState: () => {
                            hpPotionCooldown: number;
                            mpPotionCooldown: number;
                            clearAll: () => void;
                        };
                    };
                }).useCooldownStore;
                const useCharacterStore = (charMod as {
                    useCharacterStore: { getState: () => { character: { max_hp: number; max_mp: number; hp: number; mp: number } | null } };
                }).useCharacterStore;

                const character = useCharacterStore.getState().character;
                if (!character) throw new Error('character not hydrated post-Town');

                useCooldownStore.getState().clearAll();
                engine.advanceSkillCooldowns(1e9);

                const rat = engine.getAllMonsters().find((m) => m.id === 'rat');
                if (!rat) throw new Error('rat monster missing from registry');

                const bossRat = { ...rat, hp: 10_000, level: 1 };

                useCombatStore.getState().initCombat(bossRat, 30, 30, 'normal');

                const preCombat = useCombatStore.getState();
                const preInv = useInventoryStore.getState();
                const preMpFromChar = character.mp;
                const preMonsterHp = preCombat.monsterCurrentHp;
                const prePlayerHp = preCombat.playerCurrentHp;
                const prePlayerMp = preCombat.playerCurrentMp;
                const prePotionCount = preInv.consumables['hp_potion_sm'] ?? 0;

                let crashed = false;
                let crashMsg = '';
                try {
                    engine.doPlayerAttackTick(false);
                } catch (e) {
                    crashed = true;
                    crashMsg = (e as Error).message ?? String(e);
                }

                const postCombat = useCombatStore.getState();
                const postInv = useInventoryStore.getState();
                const postCd = useCooldownStore.getState();

                return {
                    crashed,
                    crashMsg,
                    prePlayerHp,
                    prePlayerMp,
                    preMonsterHp,
                    prePotionCount,
                    preMpFromChar,
                    postPhase: postCombat.phase,
                    postPlayerHp: postCombat.playerCurrentHp,
                    postPlayerMp: postCombat.playerCurrentMp,
                    postMonsterHp: postCombat.monsterCurrentHp,
                    postMonsterMaxHp: postCombat.monsterMaxHp,
                    postPotionCount: postInv.consumables['hp_potion_sm'] ?? 0,
                    postHpPotionCooldown: postCd.hpPotionCooldown,
                    postSessionLog: postCombat.sessionLog.map((l) => ({ ...l })),
                    postLog: postCombat.log.map((l) => ({ ...l })),
                };
            });

            expect(result.crashed, `tick should not crash: ${result.crashMsg}`).toBe(false);

            expect(result.postPhase).toBe('fighting');

            expect(result.postPotionCount).toBe(result.prePotionCount - 1);
            expect(result.postPlayerHp).toBeGreaterThan(result.prePlayerHp);
            expect(result.postHpPotionCooldown).toBeGreaterThan(0);
            const autoPotionLog = result.postSessionLog.find((l) =>
                /\[Auto-Potion\]/.test(l.text),
            );
            expect(autoPotionLog, 'expected [Auto-Potion] log entry').toBeDefined();
            expect(autoPotionLog?.text).toMatch(/\+50 HP/);

            const monsterDmgTaken = result.preMonsterHp - result.postMonsterHp;
            expect(monsterDmgTaken).toBeGreaterThan(0);
            const mpConsumed = result.prePlayerMp - result.postPlayerMp;
            expect(mpConsumed).toBeGreaterThanOrEqual(15);
            const hasDmgLog = result.postSessionLog.some((l) =>
                /Szczur|Atakujesz|Uderzenie Tarczą|Shield Bash/i.test(l.text),
            );
            expect(hasDmgLog, 'expected basic/skill attack log entry').toBe(true);

            expect(result.postPlayerHp).toBeGreaterThan(0);
            expect(result.postMonsterHp).toBeGreaterThan(0);
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
