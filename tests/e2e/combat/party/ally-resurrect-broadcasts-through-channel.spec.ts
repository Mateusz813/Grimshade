/**
 * Multi-context E2E — Cleric ally's Resurrection Aura broadcasts through
 * the party-combat channel + parses to reviveDeadAllies flag (BACKLOG
 * 13.22, smoke variant).
 *
 * Spec ("Wskrzeszenie sojusznika podczas walki"): Knight primary dies in
 * party combat with Cleric secondary still alive. Cleric casts Aura
 * Wskrzeszenia (`resurrection_aura`, `revive_party:0:0`) — primary's HP
 * returns to a non-zero value, fight continues.
 *
 * ## Pragmatic adaptation vs. spec (testable surface scoping)
 *
 * The end-to-end flow has three legs:
 *
 *   1. Realtime wire — Cleric's local `spell-cast` broadcast lands in
 *      Knight's `usePartyCombatSyncStore.lastSpellByCaster`. <- THIS TEST
 *   2. Effect parsing — `resurrection_aura.effect = 'revive_party:0:0'`
 *      parses to `reviveDeadAllies: true` in skillEffectsV2. Knight's
 *      receiver useEffect dispatches `fx.triggerAllySkillAnim` on the
 *      Cleric ally card. <- THIS TEST (parser side)
 *   3. State mutation — combatEngine line 1886-1899 reads `effApply.
 *      reviveDeadAllies` and revives any dead BOT. Player can't die in
 *      hunt anyway (engine auto-heals to 1 HP) — for HUMAN revival the
 *      mechanism is the deathChoicePopup "Czekaj na wskrzeszenie" + heal
 *      logic in `handlePlayerDeath`. The "human revival" branch involves
 *      multi-monster combat ticking + leader-death gate + Cleric AOE
 *      heal path; that's a multi-screen / multi-tick scenario which
 *      requires a stable framework for "primary deliberately runs out
 *      of HP in party combat" that doesn't exist yet.
 *
 * What we deliver:
 *   - Test 1 (Realtime wire): secondary (Cleric) publishes `spell-cast`
 *     event for `resurrection_aura` -> primary's `lastSpellByCaster[secondary]`
 *     populates with that skillId. This proves: (a) `usePartyCombatSync`
 *     subscriber wired correctly for the revive skill, (b) Cleric -> Knight
 *     direction works (the spec's primary use case — Cleric is the only
 *     class with the spell, Knight is the typical revival target).
 *   - Test 2 (effect parser): runtime-invoke `parseEffects` +
 *     `applyEffects` on `revive_party:0:0` (resurrection_aura's effect
 *     string) -> assert the result has `reviveDeadAllies === true`. This
 *     proves combatEngine.ts line 1886 will see the flag set when this
 *     skill resolves locally.
 *
 * Together these two assertions cover the multi-context CONTRACT:
 *   - Cleric's broadcast is received by Knight (wire path)
 *   - The same skill, parsed locally on either side, triggers the
 *     revive flag (effect parser)
 *
 * What's NOT covered (explicit gaps):
 *   - Player HP actually rising from 0 -> N after the revive flag fires.
 *     handlePlayerDeath's "wait for revive" gate involves the
 *     deathChoicePopup state machine — testable via combatStore
 *     mutations but requires the leader-in-multi-human-party HP=0
 *     gate to fire (combatEngine.ts line 1346) and a heal source on
 *     the engine tick. Deferred to a follow-up that builds a "leader
 *     pseudo-dies" helper.
 *   - Bot ally revival from `reviveDeadAllies` flag. Pure unit coverage
 *     in skillCatalog.test.ts line 531-534 + 615 already proves the
 *     `applyEffects` output flag is set. The combatEngine consumer
 *     (line 1886-1899) is a 14-line direct loop that flips bot.hp on
 *     dead bots — single-context combat tests would catch any regression
 *     in that loop.
 *
 * 180 s timeout per multi-ctx combat convention.
 */

import { test, expect, type Page } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { seedGameSave, findUserIdByEmail } from '../../fixtures/seedGameSave';
import { openMultiContext } from '../../fixtures/multiContext';

/** Pick the seeded character on `/character-select` -> land in Town. */
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

/** Read the active character id from `characterStore.character.id`. */
const readActiveCharacterId = async (page: Page): Promise<string> => {
    const id = await page.evaluate(async () => {
        // @ts-expect-error — Vite URL
        const mod = await import('/src/stores/characterStore.ts');
        const useCharacterStore = (mod as { useCharacterStore: { getState: () => { character: { id: string } | null } } })
            .useCharacterStore;
        return useCharacterStore.getState().character?.id ?? '';
    });
    if (!id) throw new Error('[ally-resurrect-broadcasts] activeCharacterId empty — character not hydrated');
    return id;
};

/**
 * Publish a `spell-cast` event from the given page. Matches the exact
 * shape `combatEngine.ts` line 414 fires for manual casts (or auto-casts
 * resolving locally — same shape).
 */
const publishSpellCastFromPage = async (
    page: Page,
    args: { casterId: string; casterName: string; skillId: string; label: string; targetIdx: number; isDamageHit: boolean },
): Promise<void> => {
    await page.evaluate(async (a) => {
        // @ts-expect-error — Vite URL
        const mod = await import('/src/stores/partyCombatSyncStore.ts');
        const usePartyCombatSyncStore = (mod as {
            usePartyCombatSyncStore: { getState: () => { publishSpellCast: (cast: typeof a) => void } };
        }).usePartyCombatSyncStore;
        usePartyCombatSyncStore.getState().publishSpellCast(a);
    }, args);
};

/**
 * Poll the receiver's `lastSpellByCaster[casterId]` until it matches the
 * expected skill id OR the budget expires.
 */
const waitForReceivedSpellCast = async (
    page: Page,
    args: { casterId: string; expectedSkillId: string; timeoutMs?: number },
): Promise<{ casterId: string; skillId: string }> => {
    // 45s default — the cross-context broadcast can take 15-25s under
    // full-suite load.
    const timeoutMs = args.timeoutMs ?? 45_000;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const got = await page.evaluate(async (a) => {
            // @ts-expect-error — Vite URL
            const mod = await import('/src/stores/partyCombatSyncStore.ts');
            const usePartyCombatSyncStore = (mod as {
                usePartyCombatSyncStore: { getState: () => { lastSpellByCaster: Record<string, { casterId: string; skillId: string }> } };
            }).usePartyCombatSyncStore;
            return usePartyCombatSyncStore.getState().lastSpellByCaster[a.casterId] ?? null;
        }, args);
        if (got && got.skillId === args.expectedSkillId) return got;
        await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(
        `[waitForReceivedSpellCast] timeout after ${timeoutMs}ms — never received spell-cast for casterId=${args.casterId} skillId=${args.expectedSkillId}`,
    );
};

test.describe('Combat › Party', { tag: '@combat' }, () => {
    test.describe.configure({ timeout: 180_000 });

    test('cleric resurrection_aura broadcasts through party-combat channel + parses to reviveDeadAllies flag', async ({ browser }) => {
        const primaryNick = generateTestCharacterName();
        const secondaryNick = generateTestCharacterName();
        const partyName = `Resurrect ${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

        let primaryCharId: string | null = null;
        let secondaryCharId: string | null = null;
        let handles: Awaited<ReturnType<typeof openMultiContext>> | null = null;

        try {
            // 1. Seed Knight (primary — the typical revival target in spec)
            //    + Cleric (secondary — the only class with resurrection_aura).
            //    Cleric needs lvl 50 to actually CAST resurrection_aura in
            //    live combat (skills.json unlockLevel=50), but our
            //    broadcast-level test doesn't care about the level gate —
            //    we publishSpellCast directly. Still seed at lvl 50 so
            //    the test reflects the canonical scenario (Cleric ≥ 50
            //    has the skill unlocked).
            const primaryCreated = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: primaryNick,
                class: 'Knight',
                overrides: { level: 50, highest_level: 50, hp_regen: 0, mp_regen: 0 },
            });
            primaryCharId = primaryCreated.id;
            const secondaryCreated = await createCharacterViaApi({
                userEmail: testUsers.secondary.email,
                name: secondaryNick,
                class: 'Cleric',
                overrides: { level: 50, highest_level: 50, hp_regen: 0, mp_regen: 0 },
            });
            secondaryCharId = secondaryCreated.id;

            const primaryUserId = await findUserIdByEmail(testUsers.primary.email);
            const secondaryUserId = await findUserIdByEmail(testUsers.secondary.email);
            await seedGameSave({ characterId: primaryCharId, userId: primaryUserId });
            await seedGameSave({ characterId: secondaryCharId, userId: secondaryUserId });

            // 2. Open multi-context + login both.
            handles = await openMultiContext(browser);
            const { primaryPage, secondaryPage } = handles;

            // 3. Both pick character -> Town.
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

            // 6. Secondary refresh + join.
            await secondaryPage.locator('.party__refresh-btn').tap();
            const partyCard = secondaryPage.locator('.party__card', {
                has: secondaryPage.locator('.party__card-name', { hasText: partyName }),
            });
            await expect(partyCard).toBeVisible({ timeout: 15_000 });
            const joinBtn = partyCard.locator('.party__primary-btn', { hasText: /^Dołącz$/i });
            await expect(joinBtn).toBeEnabled({ timeout: 10_000 });
            await joinBtn.tap();

            // Synchronisation barrier — wait both sides see 2/4 so each
            // side's usePartyCombatSync has subscribed to the channel. 45s:
            // the cross-context Realtime broadcast (secondary's join reaching
            // primary) can take 15-25s under full-suite load.
            await expect(primaryPage.locator('.party__roster-meta'))
                .toContainText(/2\/4\s+graczy/i, { timeout: 45_000 });
            await expect(secondaryPage.locator('.party__roster-meta'))
                .toContainText(/2\/4\s+graczy/i, { timeout: 45_000 });

            // Small buffer — Supabase Realtime SUBSCRIBED callback can lag
            // behind visible UI roster sync by ~hundred ms on mobile-chrome.
            await primaryPage.waitForTimeout(1_000);

            // 7. Read active character ids.
            const primaryActiveId = await readActiveCharacterId(primaryPage);
            const secondaryActiveId = await readActiveCharacterId(secondaryPage);
            expect(primaryActiveId).toBe(primaryCharId);
            expect(secondaryActiveId).toBe(secondaryCharId);

            // 8. LEG 1 — Realtime wire: SECONDARY (Cleric) publishes
            //    `spell-cast` for `resurrection_aura` -> PRIMARY (Knight)
            //    receives it in `lastSpellByCaster[secondaryActiveId]`.
            //
            //    Note: `isDamageHit=false` for resurrection_aura (damage=0
            //    per skills.json line 50) — receiver Combat.tsx routes
            //    non-damage casts to `fx.triggerAllySkillAnim` on the
            //    caster's ally card (not the enemy card).
            await publishSpellCastFromPage(secondaryPage, {
                casterId: secondaryActiveId,
                casterName: secondaryNick,
                skillId: 'resurrection_aura',
                label: 'Aura Wskrzeszenia',
                targetIdx: 0,
                isDamageHit: false,
            });

            // 45s: cross-context broadcast can take 15-25s under full-suite load.
            const received = await waitForReceivedSpellCast(primaryPage, {
                casterId: secondaryActiveId,
                expectedSkillId: 'resurrection_aura',
                timeoutMs: 45_000,
            });
            expect(received.skillId).toBe('resurrection_aura');
            expect(received.casterId).toBe(secondaryActiveId);

            // 9. LEG 2 — Effect parser: runtime-invoke `parseEffects` +
            //    `applyEffects` on the resurrection_aura effect string +
            //    assert reviveDeadAllies flag is true. This is what
            //    combatEngine.ts line 1886 reads to trigger bot revival
            //    (and what the human-revive path in handlePlayerDeath
            //    would also key off if we extend it for player revival).
            //
            //    We run this on PRIMARY's context (the receiver). The
            //    parser is pure — same result on every JS heap — but
            //    asserting on the receiver matches the scenario "Knight
            //    receives Cleric's revive broadcast and the engine could
            //    decode it locally".
            const parserResult = await primaryPage.evaluate(async () => {
                // @ts-expect-error — Vite URL
                const mod = await import('/src/systems/skillEffectsV2.ts');
                const skillFx = mod as {
                    parseEffects: (effect: string) => unknown[];
                    newStatusState: () => unknown;
                    applyEffects: (
                        atoms: unknown[],
                        casterStatus: unknown,
                        targetStatus: unknown | null,
                        targetHpPct: number,
                        partyStatus: unknown[],
                        enemyStatus: unknown[],
                    ) => {
                        reviveDeadAllies: boolean;
                        revivePartyProtectMs: number;
                        revivePartyGraceMs: number;
                    };
                };
                // resurrection_aura.effect = 'revive_party:0:0' per
                // src/data/skills.json line 50. We pass that exact string.
                // applyEffects needs caster + target + party + enemy
                // status states; pass fresh blank ones via newStatusState
                // (skillEffectsV2.ts line 244) so the parser sees the
                // canonical shape it expects.
                const atoms = skillFx.parseEffects('revive_party:0:0');
                const casterStatus = skillFx.newStatusState();
                const partyStatus = [casterStatus]; // single ally party (self)
                const result = skillFx.applyEffects(
                    atoms,
                    casterStatus,
                    null,
                    100,
                    partyStatus,
                    [],
                );
                return {
                    parsedAtomCount: atoms.length,
                    reviveDeadAllies: result.reviveDeadAllies,
                    revivePartyProtectMs: result.revivePartyProtectMs,
                    revivePartyGraceMs: result.revivePartyGraceMs,
                };
            });

            // The effect string `revive_party:0:0` parses to ONE atom of
            // kind 'revive_party' with a=0, b=0. applyEffects sets
            // reviveDeadAllies=true unconditionally + the two ms windows
            // to 0 (instant revive). See skillEffectsV2.ts line 782-789.
            expect(parserResult.parsedAtomCount).toBe(1);
            expect(parserResult.reviveDeadAllies).toBe(true);
            expect(parserResult.revivePartyProtectMs).toBe(0);
            expect(parserResult.revivePartyGraceMs).toBe(0);

            // 10. Sanity: parser also handles the lvl 1000 Cleric Holy
            //     Apocalypse path `aoe;party_immortal:5000;revive_party:5000:10000`
            //     since it shares the same revive_party atom but with
            //     non-zero windows. Quick negative regression — proves
            //     the parser doesn't mis-route revive_party variants.
            const holyApocalypseResult = await primaryPage.evaluate(async () => {
                // @ts-expect-error — Vite URL
                const mod = await import('/src/systems/skillEffectsV2.ts');
                const skillFx = mod as {
                    parseEffects: (effect: string) => unknown[];
                    newStatusState: () => unknown;
                    applyEffects: (
                        atoms: unknown[],
                        casterStatus: unknown,
                        targetStatus: unknown | null,
                        targetHpPct: number,
                        partyStatus: unknown[],
                        enemyStatus: unknown[],
                    ) => {
                        reviveDeadAllies: boolean;
                        revivePartyProtectMs: number;
                        revivePartyGraceMs: number;
                    };
                };
                const atoms = skillFx.parseEffects('aoe;party_immortal:5000;revive_party:5000:10000');
                const casterStatus = skillFx.newStatusState();
                const partyStatus = [casterStatus];
                return skillFx.applyEffects(
                    atoms,
                    casterStatus,
                    null,
                    100,
                    partyStatus,
                    [],
                );
            });
            // Holy Apocalypse: party-wide immortal for 5s, then revive
            // dead allies after a 10s grace. reviveDeadAllies still true.
            expect(holyApocalypseResult.reviveDeadAllies).toBe(true);
            expect(holyApocalypseResult.revivePartyProtectMs).toBe(5000);
            expect(holyApocalypseResult.revivePartyGraceMs).toBe(10000);
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
