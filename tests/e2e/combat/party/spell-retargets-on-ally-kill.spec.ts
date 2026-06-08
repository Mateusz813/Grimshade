/**
 * Multi-context E2E — spell retargets to next alive monster when active
 * target was killed (BACKLOG 13.10).
 *
 * Spec: in party combat, primary queues a spell on a monster while
 * secondary's basic attack lands the killing blow on it. Primary's
 * spell must NOT be wasted — `huntApplySkillEffectV2` retargets the
 * cast to the next alive wave monster (combatEngine.ts line 363-388).
 * If no monsters are alive at apply time, the cast is refused entirely
 * (no MP burnt, no cooldown started) so the player can re-fire.
 *
 * ## Pragmatic adaptation vs. spec
 *
 * Real party hunt combat involves: ready-check popup → both confirm →
 * leader's engine drives the wave → secondary's basic-attack lands on
 * leader's authoritative state. Reproducing that full chain in E2E is
 * 60s+ of fragile timing (mob speed × tick cadence × Realtime hops) and
 * we'd be testing more than the retarget contract.
 *
 * Instead, we test the contract directly:
 *   1. Set up multi-context party (so `huntApplySkillEffectV2` sees the
 *      partyStore.party at the moment of cast — line 398) — proves the
 *      multi-context wiring is real.
 *   2. On primary, seed a 2-monster wave via combatStore.initCombat +
 *      addWaveMonster (the exact API combatEngine uses at line 2646 for
 *      `wavePlannedCount > 1` fights).
 *   3. Mark slot 0 dead via combatStore.markActiveWaveMonsterDead (the
 *      same API combatEngine uses at line 1155 when a monster dies in
 *      live combat).
 *   4. Call `huntApplySkillEffectV2('fireball', 0)` — the exact engine
 *      fn Combat.tsx invokes at line 1191. This is the production retarget
 *      path; no test doubles.
 *   5. Assert: `combatStore.activeTargetIdx` flipped to 1, the engine
 *      mirrors `monster` / `monsterCurrentHp` to slot 1's monster, and
 *      the helper returned a non-null effApply (proving cast didn't bail).
 *   6. Negative: kill BOTH wave slots → call retarget again → assert
 *      helper returned `null` (no alive targets → cast refused, MP saved).
 *
 * What this proves about the multi-context experience:
 *   • The retarget engine fn is invoked from the SAME context as
 *     publishSpellCast (combatEngine.ts line 414 → publishSpellCast
 *     happens at line 397-425 AFTER the retarget already shifted
 *     `activeIdx`), so a retargeted cast broadcasts the CORRECT slot to
 *     teammates. The bug we guard against: "primary queues spell on
 *     dead slot 0, retarget shifts to slot 1, but broadcast still says
 *     targetIdx=0 → teammates animate empty slot". Our test asserts
 *     primary's local state shifts; the publishSpellCast call reading
 *     `activeIdx` after retarget is the production code path.
 *   • Multi-context party is set up first so partyStore.party isn't
 *     null when huntApplySkillEffectV2 reads it (line 398) — otherwise
 *     we're really running a solo test and the spell-cast broadcast
 *     branch never executes.
 *
 * Why solo-equivalent test isn't enough: line 397-425 of combatEngine.ts
 * is the publish-to-teammates branch — only fires when partyStore.party
 * has at least one other human. A solo test would skip that branch
 * entirely, missing the load-bearing post-retarget broadcast slot.
 *
 * 180 s timeout per multi-context combat convention (slower than 120 s
 * party tests because we layer combat-store mutations on top of the
 * 2× login + party flow).
 */

import { test, expect, type Page } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { seedGameSave, findUserIdByEmail } from '../../fixtures/seedGameSave';
import { openMultiContext } from '../../fixtures/multiContext';

/** Pick the seeded character on `/character-select` → land in Town. */
const pickCharacterAndEnterTown = async (page: Page, nick: string): Promise<void> => {
    if (!page.url().endsWith('/character-select')) {
        await page.goto('/character-select');
    }
    await expect(page.locator('.char-select__card-name', { hasText: nick }))
        .toBeVisible({ timeout: 15_000 });
    const card = page.locator('.char-select__card', {
        has: page.locator('.char-select__card-name', { hasText: nick }),
    });
    await card.getByRole('button', { name: /Wybierz/i }).tap();
    await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
    await expect(page.locator('.town__char-name')).toHaveText(nick);
};

/** Navigate to /party + wait for either intro or roster panel. */
const navToParty = async (page: Page): Promise<void> => {
    await page.getByRole('button', { name: /^Społeczność$/i }).tap();
    await expect(page).toHaveURL(/\/social$/, { timeout: 10_000 });
    await page.locator('.social__tile--party').tap();
    await expect(page).toHaveURL(/\/party$/, { timeout: 10_000 });
    await expect(page.locator('.party__intro-title, .party__roster').first())
        .toBeVisible({ timeout: 15_000 });
};

test.describe('Combat › Party', { tag: '@combat' }, () => {
    // Multi-context combat = login × 2 + party creation + combat-store
    // mutations. 180 s per task brief (multi-ctx combat is VERY slow).
    test.describe.configure({ timeout: 180_000 });

    test('spell retargets on ally-killed slot, refuses cast when no alive monsters remain', async ({ browser }) => {
        const primaryNick = generateTestCharacterName();
        const secondaryNick = generateTestCharacterName();
        const partyName = `Retarget ${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

        let primaryCharId: string | null = null;
        let secondaryCharId: string | null = null;
        let handles: Awaited<ReturnType<typeof openMultiContext>> | null = null;

        try {
            // 1. Seed Knight (primary leader) + Mage (secondary) at lvl 10.
            //    Knight class chosen because retarget happens in hunt combat
            //    where any class can cast a damage spell; Knight 'shield_bash'
            //    is tier-1 unlocked at lvl 5, used as the retarget probe.
            const primaryCreated = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: primaryNick,
                class: 'Knight',
                overrides: { level: 10, highest_level: 10, hp_regen: 0, mp_regen: 0 },
            });
            primaryCharId = primaryCreated.id;
            const secondaryCreated = await createCharacterViaApi({
                userEmail: testUsers.secondary.email,
                name: secondaryNick,
                class: 'Mage',
                overrides: { level: 10, highest_level: 10, hp_regen: 0, mp_regen: 0 },
            });
            secondaryCharId = secondaryCreated.id;

            const primaryUserId = await findUserIdByEmail(testUsers.primary.email);
            const secondaryUserId = await findUserIdByEmail(testUsers.secondary.email);
            await seedGameSave({ characterId: primaryCharId, userId: primaryUserId });
            await seedGameSave({ characterId: secondaryCharId, userId: secondaryUserId });

            // 2. Open multi-context + login both.
            handles = await openMultiContext(browser);
            const { primaryPage, secondaryPage } = handles;

            // 3. Both pick character → Town.
            await Promise.all([
                pickCharacterAndEnterTown(primaryPage, primaryNick),
                pickCharacterAndEnterTown(secondaryPage, secondaryNick),
            ]);

            // 4. Both nav to /party.
            await Promise.all([
                navToParty(primaryPage),
                navToParty(secondaryPage),
            ]);

            // 5. Primary creates public party.
            await primaryPage
                .locator('.party__primary-btn', { hasText: /Stwórz nowe party/i })
                .tap();
            await expect(primaryPage.locator('.party__create-form'))
                .toBeVisible({ timeout: 5_000 });
            await primaryPage.locator('.party__field', { hasText: /Nazwa party/i })
                .locator('input').fill(partyName);
            const primarySubmitBtn = primaryPage.locator('.party__form-actions')
                .getByRole('button', { name: /^Utwórz$/i });
            await expect(primarySubmitBtn).toBeEnabled({ timeout: 10_000 });
            await primarySubmitBtn.tap();
            await expect(primaryPage.locator('.party__roster')).toBeVisible({ timeout: 15_000 });
            await expect(primaryPage.locator('.party__roster-meta'))
                .toContainText(/1\/4\s+graczy/i);

            // 6. Secondary refresh + join.
            await secondaryPage.locator('.party__refresh-btn').tap();
            const partyCard = secondaryPage.locator('.party__card', {
                has: secondaryPage.locator('.party__card-name', { hasText: partyName }),
            });
            await expect(partyCard).toBeVisible({ timeout: 15_000 });
            const joinBtn = partyCard.locator('.party__primary-btn', { hasText: /^Dołącz$/i });
            await expect(joinBtn).toBeEnabled({ timeout: 10_000 });
            await joinBtn.tap();

            // Synchronisation barrier — wait both sides see 2/4 so partyStore
            // is hydrated on primary before our combat-store mutations + the
            // retarget invocation. 45s: the cross-context Realtime broadcast
            // (secondary's join reaching primary) can take 15-25s under
            // full-suite load.
            await expect(primaryPage.locator('.party__roster-meta'))
                .toContainText(/2\/4\s+graczy/i, { timeout: 45_000 });
            await expect(secondaryPage.locator('.party__roster-meta'))
                .toContainText(/2\/4\s+graczy/i, { timeout: 45_000 });

            // 7. PRIMARY ONLY: set up a 2-monster wave via the same store
            //    APIs combatEngine uses for `wavePlannedCount > 1` fights.
            //    No need to involve secondary for this contract test — the
            //    retarget contract is local to primary's engine. Secondary
            //    is set up earlier only to populate primary's partyStore
            //    so huntApplySkillEffectV2's party-broadcast branch runs.
            const setupResult = await primaryPage.evaluate(async () => {
                // @ts-expect-error — dev-time Vite URL not resolvable by tsc
                const engineMod = await import('/src/systems/combatEngine.ts');
                // @ts-expect-error — dev-time Vite URL not resolvable by tsc
                const combatMod = await import('/src/stores/combatStore.ts');
                const engine = engineMod as {
                    getAllMonsters: () => Array<{ id: string; level: number; hp: number }>;
                };
                const useCombatStore = (combatMod as {
                    useCombatStore: {
                        getState: () => {
                            initCombat: (m: unknown, hp: number, mp: number, rarity?: string) => void;
                            addWaveMonster: (m: unknown, rarity: string) => boolean;
                            waveMonsters: Array<{ isDead: boolean; currentHp: number }>;
                            activeTargetIdx: number;
                        };
                    };
                }).useCombatStore;

                const rat = engine.getAllMonsters().find((m) => m.id === 'rat');
                if (!rat) throw new Error('rat monster def missing');

                // Start combat with rat in slot 0.
                useCombatStore.getState().initCombat(rat, 100, 30, 'normal');
                // Add second rat in slot 1.
                const added = useCombatStore.getState().addWaveMonster(rat, 'normal');
                if (!added) throw new Error('addWaveMonster slot 1 failed');

                const wave = useCombatStore.getState().waveMonsters;
                return {
                    waveLen: wave.length,
                    slot0Dead: wave[0].isDead,
                    slot1Dead: wave[1].isDead,
                    activeIdx: useCombatStore.getState().activeTargetIdx,
                };
            });

            expect(setupResult.waveLen).toBe(2);
            expect(setupResult.slot0Dead).toBe(false);
            expect(setupResult.slot1Dead).toBe(false);
            expect(setupResult.activeIdx).toBe(0);

            // 8. Simulate "secondary killed slot 0": mark wave slot 0 dead
            //    + zero its HP via damageWaveMonster (the live-combat path
            //    combatEngine.ts uses at line 1155 when a hit lands the
            //    killing blow). This puts the store in the exact shape it'd
            //    have after secondary's basic-attack reduced slot 0 to 0 HP.
            //    Now call huntApplySkillEffectV2 from primary (activeTargetIdx
            //    still points at 0 because secondary's kill didn't auto-shift
            //    primary's pointer yet — the bug surface).
            const retargetResult = await primaryPage.evaluate(async () => {
                // @ts-expect-error — dev-time Vite URL not resolvable by tsc
                const engineMod = await import('/src/systems/combatEngine.ts');
                // @ts-expect-error — dev-time Vite URL not resolvable by tsc
                const combatMod = await import('/src/stores/combatStore.ts');
                const engine = engineMod as {
                    huntApplySkillEffectV2: (skillId: string, activeIdx: number) => unknown | null;
                };
                const useCombatStore = (combatMod as {
                    useCombatStore: {
                        getState: () => {
                            damageWaveMonster: (idx: number, dmg: number) => void;
                            markActiveWaveMonsterDead: () => void;
                            waveMonsters: Array<{ isDead: boolean; currentHp: number; monster: { id: string } }>;
                            activeTargetIdx: number;
                            monster: { id: string } | null;
                            monsterCurrentHp: number;
                        };
                    };
                }).useCombatStore;

                // Kill slot 0 (zero HP + mark dead) — same call combatEngine
                // makes when a hit lands the killing blow.
                useCombatStore.getState().damageWaveMonster(0, 9999);
                useCombatStore.getState().markActiveWaveMonsterDead();

                const preWave = useCombatStore.getState().waveMonsters;
                const preActiveIdx = useCombatStore.getState().activeTargetIdx;

                // INVOKE THE RETARGET PATH. activeIdx=0 (the dead slot) is
                // the bug-surface scenario — without the retarget branch
                // (combatEngine.ts line 371-388), the cast would either
                // damage a dead monster or NaN out.
                //
                // `shield_bash` is the Knight tier-1 spell — guaranteed
                // unlocked at lvl 5. It's a damage spell (skill.damage=1.4)
                // so the isDamageHit branch + publishSpellCast both run.
                const effApply = engine.huntApplySkillEffectV2('shield_bash', 0);

                const postWave = useCombatStore.getState().waveMonsters;
                const postActiveIdx = useCombatStore.getState().activeTargetIdx;
                const postMonsterId = useCombatStore.getState().monster?.id ?? null;
                const postMonsterHp = useCombatStore.getState().monsterCurrentHp;

                return {
                    effApplyIsNull: effApply === null,
                    preActiveIdx,
                    postActiveIdx,
                    preSlot0Dead: preWave[0].isDead,
                    preSlot1Dead: preWave[1].isDead,
                    postSlot1Dead: postWave[1].isDead,
                    postMonsterId,
                    postMonsterHp,
                    slot1MonsterId: postWave[1].monster.id,
                    slot1Hp: postWave[1].currentHp,
                };
            });

            // 9. Assertions:
            //    a) huntApplySkillEffectV2 returned a non-null apply
            //       (cast accepted, MP burned, cooldown started — the
            //       OPPOSITE of "refused, no MP spent" branch).
            expect(retargetResult.effApplyIsNull).toBe(false);

            //    b) Pre-state: slot 0 IS dead (we just killed it),
            //       slot 1 is alive, activeIdx was still 0.
            expect(retargetResult.preSlot0Dead).toBe(true);
            expect(retargetResult.preSlot1Dead).toBe(false);
            expect(retargetResult.preActiveIdx).toBe(0);

            //    c) RETARGET HAPPENED: post-state shifted activeIdx to
            //       1 (combatEngine.ts line 374 — `activeIdx = aliveIdx`
            //       then line 381 sets it on the store).
            expect(retargetResult.postActiveIdx).toBe(1);

            //    d) Mirrored monster fields synced (combatEngine.ts
            //       lines 382-387 — `monster`, `monsterCurrentHp`,
            //       `monsterMaxHp`, `monsterRarity` all flipped to slot 1).
            //       Without this, downstream callers reading `s.monster`
            //       would see stale slot-0 data.
            expect(retargetResult.postMonsterId).toBe('rat');
            // slot 1's HP is what monsterCurrentHp now mirrors.
            expect(retargetResult.postMonsterHp).toBe(retargetResult.slot1Hp);
            expect(retargetResult.postSlot1Dead).toBe(false);

            // 10. NEGATIVE BRANCH: kill slot 1 too → call huntApplySkillEffectV2
            //     again → MUST return null (no alive monsters → cast refused
            //     → MP saved). This is the "spec ('jezeli archer zabije 4
            //     potwory to spell anulowany')" branch on line 373.
            const negativeResult = await primaryPage.evaluate(async () => {
                // @ts-expect-error — dev-time Vite URL not resolvable by tsc
                const engineMod = await import('/src/systems/combatEngine.ts');
                // @ts-expect-error — dev-time Vite URL not resolvable by tsc
                const combatMod = await import('/src/stores/combatStore.ts');
                const engine = engineMod as {
                    huntApplySkillEffectV2: (skillId: string, activeIdx: number) => unknown | null;
                };
                const useCombatStore = (combatMod as {
                    useCombatStore: {
                        getState: () => {
                            damageWaveMonster: (idx: number, dmg: number) => void;
                            markActiveWaveMonsterDead: () => void;
                            waveMonsters: Array<{ isDead: boolean; currentHp: number }>;
                        };
                    };
                }).useCombatStore;

                // Kill slot 1 too (it was already the active target after
                // retarget). Same kill path as combatEngine.ts line 1155.
                useCombatStore.getState().damageWaveMonster(1, 9999);
                useCombatStore.getState().markActiveWaveMonsterDead();

                const wave = useCombatStore.getState().waveMonsters;
                const allDead = wave.every((w) => w.isDead);

                // Cast again — should return null because no alive monsters.
                const effApply = engine.huntApplySkillEffectV2('shield_bash', 1);

                return {
                    allDead,
                    effApplyIsNull: effApply === null,
                };
            });

            expect(negativeResult.allDead).toBe(true);
            // Critical: null return = MP saved, cooldown not started, player
            // can re-fire after spawning new wave. This is the contract
            // "kazdy gracz moze wciaz uzyc skill jak wszyscy potwory na ekranie zginely
            // — nie strace MP/cooldown za darmo".
            expect(negativeResult.effApplyIsNull).toBe(true);
        } finally {
            if (handles) {
                await handles.cleanup({ primaryCharId, secondaryCharId });
            } else {
                const { cleanupCharacterById } = await import('../../fixtures/cleanup');
                const { getAdminClient } = await import('../../fixtures/adminClient');
                const idsToWipe = [primaryCharId, secondaryCharId].filter(
                    (id): id is string => id !== null,
                );
                if (idsToWipe.length > 0) {
                    try {
                        const admin = getAdminClient();
                        const idList = idsToWipe.map((id) => `"${id}"`).join(',');
                        await admin.from('parties').delete().or(`leader_id.in.(${idList})`);
                    } catch { /* non-fatal */ }
                    await Promise.all(idsToWipe.map((id) => cleanupCharacterById(id)));
                }
            }
        }
    });
});
