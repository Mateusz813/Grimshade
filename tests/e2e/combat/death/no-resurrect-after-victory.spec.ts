/**
 * Atomic E2E — death penalty survives the victory transition; no
 * auto-revive after fight (BACKLOG 13.23 — "Sojusznik umiera + nikt
 * nie wskrzesza + party wygrywa -> animacja śmierci + nie bierze
 * udziału w next").
 *
 * Spec: in shared party combat, when a member dies WITHOUT being revived
 * by a Cleric, and the fight goes to `phase === 'victory'`, the death
 * penalty MUST apply (level drop + XP reset + death feed entry) — the
 * victory transition must NOT magically revive the dead member to full
 * HP or undo the penalty.
 *
 * ## Pragmatic adaptation vs. spec
 *
 * Full multi-context scenario:
 *   1. Knight primary + Mage secondary (no Cleric) in party
 *   2. Combat starts, both attack monster
 *   3. Primary's HP drains to 0 via monster swings
 *   4. Primary's PartyDeathChoice popup: picks "Wróć do miasta" -> death
 *      penalty applies + nav home
 *   5. OR primary picks "Czekaj na wskrzeszenie" -> no Cleric -> fight
 *      finishes -> Combat.tsx auto-death-on-victory useEffect (line
 *      521-527) fires `handleDeathReturnToTown` -> death penalty applies
 *
 * Reproducing the full chain requires:
 *   - Multi-context (2 browsers)
 *   - Live combat with predictable HP drain
 *   - Cleric absence guard (don't accidentally give either side Cleric)
 *   - Wait for victory phase (could take 10s+ of mob HP grind)
 *   - UI interaction with PartyDeathChoice popup OR observation of the
 *     auto-popup-after-victory effect
 *
 * Per the task brief ("Use `triggerPlayerDeath` + force victory phase
 * via combatSim"), we test the CONTRACT directly:
 *
 *   1. Seed Knight lvl 50 (solo — no party for the engine-level test,
 *      which exercises the SAME `handlePlayerDeath` path the multi-
 *      context scenario eventually hits via `handleDeathReturnToTown`
 *      with forceConfirm=true).
 *   2. Stage death penalty: invoke `triggerPlayerDeath` which calls
 *      `handlePlayerDeath(forceConfirm=true)` — same call site
 *      `handleDeathReturnToTown` uses (Combat.tsx line 498) when
 *      victory comes for a dead player.
 *   3. Snapshot post-death state: level dropped from 50 -> 49, xp reset
 *      to 0, hp at max (fullHealEffective ran inside handlePlayerDeath).
 *   4. Now force `combatStore.phase = 'victory'` via `setPhase` — the
 *      same transition the engine fires at line 1186/1192 when a wave
 *      clears.
 *   5. Re-snapshot character + verify:
 *      - level STILL at 49 (victory didn't undo the level loss)
 *      - xp STILL at 0 (victory didn't restore pre-death XP)
 *      - hp STILL at max (no extra revive — it was already max from
 *        the death's fullHealEffective)
 *      - phase NOW 'victory' (sanity that setPhase took effect)
 *
 * What this proves:
 *   - The victory phase is purely a UI/state transition — it doesn't
 *     touch character.level / character.xp / character.hp. So no
 *     "phantom revive" path can sneak in via the victory branch.
 *   - The death penalty is COMMITTED to the character store before the
 *     fight resolution code runs (handlePlayerDeath writes via
 *     updateCharacter line 1414-1418). Even if the victory transition
 *     came moments later, the persisted penalty is what the next
 *     `/character-select` would show.
 *
 * Contrast with `real-death-applies-xp-penalty.spec.ts`:
 *   - That test proves the death-penalty branch fires AT ALL.
 *   - THIS test proves the death-penalty branch fires AND PERSISTS
 *     ACROSS the subsequent victory phase. The pair together cover the
 *     full death-during-victory contract.
 *
 * ## What we don't test (deferred to multi-context follow-up)
 *
 *   - The PartyDeathChoice popup auto-trigger from Combat.tsx's
 *     auto-death-on-victory effect (line 521-527). Requires:
 *       - Real multi-context party with HP=0 leader-in-multi-human-party
 *       - phase transition observed in React render cycle
 *     Deferred to a `tests/e2e/combat/party/death-popup-on-victory.spec.ts`
 *     follow-up once we have a "leader pseudo-dies in party combat"
 *     helper (also flagged in `ally-resurrect-broadcasts-through-channel.spec.ts`).
 *
 * Cleanup: try/finally + cleanupCharacterById.
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { triggerPlayerDeath, getCharacterSnapshot } from '../../fixtures/combatSim';

test.describe('Combat › Death', { tag: '@combat' }, () => {
    test.describe.configure({ timeout: 90_000 });

    test('victory phase after death does not revive: level/xp penalty persists post-victory', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            // 1. Seed Knight lvl 50 / xp=0 / no consumables. Same setup as
            //    `real-death-applies-xp-penalty.spec.ts` for a deterministic
            //    1-level drop: floor(50 * 0.02) = 1.
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: {
                    level: 50,
                    highest_level: 50,
                    hp_regen: 0,
                    mp_regen: 0,
                },
            });
            createdId = created.id;

            // 2. Login -> Town.
            await loginViaUI(page, testUsers.primary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 10_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
            await expect(page.locator('.town__char-name')).toHaveText(nick, { timeout: 10_000 });

            // 3. Pre-death snapshot.
            const before = await getCharacterSnapshot(page);
            expect(before).not.toBeNull();
            expect(before!.level).toBe(50);

            // 4. Trigger death via combat-sim helper. Mirrors what
            //    `handleDeathReturnToTown` (Combat.tsx line 498) calls
            //    when a dead player taps "Wróć do miasta" OR when the
            //    auto-death-on-victory effect (line 526) fires.
            await triggerPlayerDeath(page, 'rat');

            // 5. Post-death snapshot — penalty applied.
            const afterDeath = await getCharacterSnapshot(page);
            expect(afterDeath).not.toBeNull();
            expect(afterDeath!.level).toBe(49); // dropped by 1
            expect(afterDeath!.xp).toBe(0);     // reset
            expect(afterDeath!.hp).toBe(afterDeath!.max_hp); // healed by fullHealEffective

            // 6. ACTION: force victory phase — same transition the engine
            //    fires at combatEngine.ts line 1186/1192 when a wave is
            //    cleared. This simulates "fight finishes with primary
            //    already dead — wave goes to victory regardless".
            const victoryResult = await page.evaluate(async () => {
                // @ts-expect-error — dev-time Vite URL not resolvable by tsc
                const combatMod = await import('/src/stores/combatStore.ts');
                const useCombatStore = (combatMod as {
                    useCombatStore: {
                        getState: () => {
                            phase: string;
                            setPhase: (p: string) => void;
                        };
                    };
                }).useCombatStore;

                // Snapshot phase before to prove we actually transitioned.
                const prePhase = useCombatStore.getState().phase;
                useCombatStore.getState().setPhase('victory');
                const postPhase = useCombatStore.getState().phase;

                return { prePhase, postPhase };
            });

            // 7. Sanity: phase transitioned to victory.
            expect(victoryResult.postPhase).toBe('victory');

            // 8. Post-victory snapshot — penalty PERSISTS.
            const afterVictory = await getCharacterSnapshot(page);
            expect(afterVictory).not.toBeNull();

            //    a) Level is STILL the post-death value (49). If the
            //       victory branch ever wrote `updateCharacter({ level })`
            //       (e.g. an accidental "restore on win" path), this would
            //       jump back to 50.
            expect(afterVictory!.level).toBe(49);

            //    b) XP is STILL 0 (penalty reset stuck). If victory
            //       awarded XP that drifted us past 0, this would be > 0
            //       — but earnedXp from a fight-with-dead-player should
            //       not flow into character.xp via the victory transition
            //       itself (only via `handleMonsterDeath` -> addXp, which
            //       fires DURING the kill, not at phase-set time).
            expect(afterVictory!.xp).toBe(0);

            //    c) HP is STILL at max — no extra revive bumps via
            //       victory. (fullHealEffective inside handlePlayerDeath
            //       already brought us to max during step 4; victory does
            //       not call it again.)
            expect(afterVictory!.hp).toBe(afterVictory!.max_hp);

            //    d) max_hp unchanged — sanity that no equipment/buff
            //       drift happened between snapshots.
            expect(afterVictory!.max_hp).toBe(afterDeath!.max_hp);
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
