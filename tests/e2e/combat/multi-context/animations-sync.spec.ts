/**
 * Multi-context E2E — both party members see the same skill-cast animations
 * (BACKLOG 13.14 — "Multi-context: każdy widzi te same animacje").
 *
 * Spec: in shared party combat, when ANY member casts a skill, BOTH
 * clients' `lastSpellByCaster[<casterId>]` map slot populates with the
 * cast snapshot — so each side's `Combat.tsx` subscriber can fire the
 * matching ally-card / enemy-card animation overlay in sync.
 *
 * ## What this proves vs. the 13.22 sibling test
 *
 * `combat/party/ally-resurrect-broadcasts-through-channel.spec.ts` proves
 * the channel works UNIDIRECTIONALLY — secondary publishes, primary
 * receives. Good for the Cleric→Knight revive scenario.
 *
 * THIS test proves the channel works in BOTH directions on the SAME
 * party session:
 *   • PRIMARY casts a damage skill → BOTH primary's own state AND
 *     SECONDARY's `lastSpellByCaster` map populate.
 *   • SECONDARY casts a different skill → BOTH primary's
 *     `lastSpellByCaster` AND secondary's own state populate.
 *
 * That's the canonical multi-context animation-sync contract: "if I see
 * my own spell, every teammate sees it too" (and vice versa). A
 * regression where one direction silently dropped (e.g. broadcast event
 * subscription only registered for inbound from leader) would leak
 * "stuttered animations" — primary sees secondary's spell but not their
 * own, or secondary sees primary's basic attack but not their own spell
 * effect on the same monster.
 *
 * ## Strategy
 *
 * Setup: identical to existing party multi-context patterns
 *   (Knight primary leader + Knight secondary, both lvl 10) — both seeded
 *   with `shield_bash` slotted + unlocked so either side could realistically
 *   cast in real combat. We skip the live combat flow and directly call
 *   `publishSpellCast` on each side (the EXACT fn `combatEngine.ts` line
 *   414 invokes inside `huntApplySkillEffectV2`) to bypass tick timing.
 *
 * Action:
 *   1. PRIMARY publishes `shield_bash` spell-cast.
 *      → poll SECONDARY's `lastSpellByCaster[primaryCharId]` until populated.
 *      → ALSO verify PRIMARY's OWN `lastSpellByCaster[primaryCharId]`
 *        was populated (the publishSpellCast also mirrors local — line
 *        977-980 of partyCombatSyncStore.ts).
 *   2. SECONDARY publishes `shield_bash` spell-cast (their own).
 *      → poll PRIMARY's `lastSpellByCaster[secondaryCharId]` until populated.
 *      → ALSO verify SECONDARY's OWN `lastSpellByCaster[secondaryCharId]`
 *        was populated.
 *
 * Assertions:
 *   • PRIMARY's view sees BOTH casters' entries (their own + secondary's).
 *   • SECONDARY's view sees BOTH casters' entries (their own + primary's).
 *   • `skillId` payload matches the published value on both sides
 *     (proves wire transport preserves the skill identity — animation
 *     needs the right skill name/effect lookup).
 *   • Both casts carry distinct `casterId`s in the receivers' map
 *     (no overwrite collision — proves the map keys are per-character).
 *
 * ## What this does NOT prove (deferred)
 *
 *   • The actual DOM animation overlay rendering. That's covered for
 *     solo class casts in `tests/e2e/skills/animations/solo-trainer-per-class.spec.ts`
 *     — a render-side regression would be caught there.
 *   • Multi-context damage broadcast (`lastDamageByAttacker`) — separate
 *     channel event with its own publisher path. We focus on `spell-cast`
 *     here because that's the primary animation trigger (basic-attack
 *     dmg events are covered by the leader-authoritative state snapshot).
 *
 * 180 s timeout per multi-context combat convention.
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

/** Read the active character id from `characterStore.character.id`. */
const readActiveCharacterId = async (page: Page): Promise<string> => {
    const id = await page.evaluate(async () => {
        // @ts-expect-error — Vite URL
        const mod = await import('/src/stores/characterStore.ts');
        const useCharacterStore = (mod as { useCharacterStore: { getState: () => { character: { id: string } | null } } })
            .useCharacterStore;
        return useCharacterStore.getState().character?.id ?? '';
    });
    if (!id) throw new Error('[animations-sync] activeCharacterId empty — character not hydrated');
    return id;
};

/**
 * Publish a `spell-cast` event from the given page. Matches the exact
 * shape `combatEngine.ts` line 414 fires for manual casts.
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
 * Poll the page's `lastSpellByCaster[casterId]` until it matches the
 * expected skill id OR the budget expires.
 */
const waitForReceivedSpellCast = async (
    page: Page,
    args: { casterId: string; expectedSkillId: string; timeoutMs?: number },
): Promise<{ casterId: string; skillId: string; label: string; targetIdx: number; isDamageHit: boolean }> => {
    // 45s default — the cross-context broadcast can take 15-25s under
    // full-suite load.
    const timeoutMs = args.timeoutMs ?? 45_000;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const got = await page.evaluate(async (a) => {
            // @ts-expect-error — Vite URL
            const mod = await import('/src/stores/partyCombatSyncStore.ts');
            const usePartyCombatSyncStore = (mod as {
                usePartyCombatSyncStore: { getState: () => { lastSpellByCaster: Record<string, { casterId: string; skillId: string; label: string; targetIdx: number; isDamageHit: boolean }> } };
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

test.describe('Combat › Multi-Context', { tag: '@combat' }, () => {
    test.describe.configure({ timeout: 180_000 });

    test('both party members see each other\'s spell-cast events bidirectionally', async ({ browser }) => {
        const primaryNick = generateTestCharacterName();
        const secondaryNick = generateTestCharacterName();
        const partyName = `AnimSync ${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

        let primaryCharId: string | null = null;
        let secondaryCharId: string | null = null;
        let handles: Awaited<ReturnType<typeof openMultiContext>> | null = null;

        try {
            // 1. Seed two Knights lvl 10 — both have shield_bash unlocked
            //    (unlockLevel=5 per skills.json line 11). We seed
            //    skill slot + unlocked-flag so even though we don't
            //    actually exercise the cast UI, the stores look like a
            //    real player walking into a fight.
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
                class: 'Knight',
                overrides: { level: 10, highest_level: 10, hp_regen: 0, mp_regen: 0 },
            });
            secondaryCharId = secondaryCreated.id;

            const primaryUserId = await findUserIdByEmail(testUsers.primary.email);
            const secondaryUserId = await findUserIdByEmail(testUsers.secondary.email);
            await seedGameSave({
                characterId: primaryCharId, userId: primaryUserId,
                skills: { activeSkillSlots: ['shield_bash', null, null, null], unlockedSkills: { shield_bash: true } },
            });
            await seedGameSave({
                characterId: secondaryCharId, userId: secondaryUserId,
                skills: { activeSkillSlots: ['shield_bash', null, null, null], unlockedSkills: { shield_bash: true } },
            });

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

            // 6. Secondary refresh + join.
            await secondaryPage.locator('.party__refresh-btn').tap();
            const partyCard = secondaryPage.locator('.party__card', {
                has: secondaryPage.locator('.party__card-name', { hasText: partyName }),
            });
            await expect(partyCard).toBeVisible({ timeout: 15_000 });
            const joinBtn = partyCard.locator('.party__primary-btn', { hasText: /^Dołącz$/i });
            await expect(joinBtn).toBeEnabled({ timeout: 10_000 });
            await joinBtn.tap();

            // Synchronisation barrier — both rosters at 2/4 so both
            // sides' usePartyCombatSync has subscribed to the channel. 45s:
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

            // 8. LEG 1 — PRIMARY publishes spell-cast → SECONDARY receives.
            //    isDamageHit=true (shield_bash damage=1.5) — Combat.tsx
            //    receiver routes damage-hits to the enemy-card animation
            //    overlay (not the caster's ally card).
            await publishSpellCastFromPage(primaryPage, {
                casterId: primaryActiveId,
                casterName: primaryNick,
                skillId: 'shield_bash',
                label: 'Uderzenie Tarczą',
                targetIdx: 0,
                isDamageHit: true,
            });

            // Secondary receives primary's cast within the budget. 45s:
            // cross-context broadcast can take 15-25s under full-suite load.
            const secondaryReceivedPrimary = await waitForReceivedSpellCast(secondaryPage, {
                casterId: primaryActiveId,
                expectedSkillId: 'shield_bash',
                timeoutMs: 45_000,
            });
            expect(secondaryReceivedPrimary.skillId).toBe('shield_bash');
            expect(secondaryReceivedPrimary.casterId).toBe(primaryActiveId);
            expect(secondaryReceivedPrimary.label).toBe('Uderzenie Tarczą');
            expect(secondaryReceivedPrimary.targetIdx).toBe(0);
            expect(secondaryReceivedPrimary.isDamageHit).toBe(true);

            // PRIMARY also sees their OWN cast in the local lastSpellByCaster
            // map (publishSpellCast mirrors locally — line 977-980 of
            // partyCombatSyncStore.ts).
            const primaryOwnCast = await primaryPage.evaluate(async (id) => {
                // @ts-expect-error — Vite URL
                const mod = await import('/src/stores/partyCombatSyncStore.ts');
                return (mod as {
                    usePartyCombatSyncStore: { getState: () => { lastSpellByCaster: Record<string, { skillId: string }> } };
                }).usePartyCombatSyncStore.getState().lastSpellByCaster[id] ?? null;
            }, primaryActiveId);
            expect(primaryOwnCast).not.toBeNull();
            expect(primaryOwnCast?.skillId).toBe('shield_bash');

            // 9. LEG 2 — SECONDARY publishes spell-cast → PRIMARY receives.
            //    Same skill (shield_bash) but different caster — proves
            //    the receiver map keys per-caster (no overwrite collision).
            await publishSpellCastFromPage(secondaryPage, {
                casterId: secondaryActiveId,
                casterName: secondaryNick,
                skillId: 'shield_bash',
                label: 'Uderzenie Tarczą',
                targetIdx: 1, // Different target slot than primary's cast.
                isDamageHit: true,
            });

            // PRIMARY receives secondary's cast. 45s: cross-context
            // broadcast can take 15-25s under full-suite load.
            const primaryReceivedSecondary = await waitForReceivedSpellCast(primaryPage, {
                casterId: secondaryActiveId,
                expectedSkillId: 'shield_bash',
                timeoutMs: 45_000,
            });
            expect(primaryReceivedSecondary.skillId).toBe('shield_bash');
            expect(primaryReceivedSecondary.casterId).toBe(secondaryActiveId);
            expect(primaryReceivedSecondary.targetIdx).toBe(1);

            // SECONDARY also sees their OWN cast in local mirror.
            const secondaryOwnCast = await secondaryPage.evaluate(async (id) => {
                // @ts-expect-error — Vite URL
                const mod = await import('/src/stores/partyCombatSyncStore.ts');
                return (mod as {
                    usePartyCombatSyncStore: { getState: () => { lastSpellByCaster: Record<string, { skillId: string }> } };
                }).usePartyCombatSyncStore.getState().lastSpellByCaster[id] ?? null;
            }, secondaryActiveId);
            expect(secondaryOwnCast).not.toBeNull();
            expect(secondaryOwnCast?.skillId).toBe('shield_bash');

            // 10. CRITICAL contract — BOTH casters' entries are present
            //     on BOTH pages simultaneously. This is the "no-overwrite"
            //     proof: primary's earlier cast wasn't displaced by
            //     secondary's later cast, because they have distinct
            //     `casterId` keys in the map.
            const bothPagesMaps = await Promise.all([
                primaryPage.evaluate(async () => {
                    // @ts-expect-error — Vite URL
                    const mod = await import('/src/stores/partyCombatSyncStore.ts');
                    const map = (mod as {
                        usePartyCombatSyncStore: { getState: () => { lastSpellByCaster: Record<string, unknown> } };
                    }).usePartyCombatSyncStore.getState().lastSpellByCaster;
                    return Object.keys(map);
                }),
                secondaryPage.evaluate(async () => {
                    // @ts-expect-error — Vite URL
                    const mod = await import('/src/stores/partyCombatSyncStore.ts');
                    const map = (mod as {
                        usePartyCombatSyncStore: { getState: () => { lastSpellByCaster: Record<string, unknown> } };
                    }).usePartyCombatSyncStore.getState().lastSpellByCaster;
                    return Object.keys(map);
                }),
            ]);
            const [primaryMapKeys, secondaryMapKeys] = bothPagesMaps;
            // Primary's map contains BOTH primary (own) + secondary (received).
            expect(primaryMapKeys).toContain(primaryActiveId);
            expect(primaryMapKeys).toContain(secondaryActiveId);
            // Secondary's map contains BOTH primary (received) + secondary (own).
            expect(secondaryMapKeys).toContain(primaryActiveId);
            expect(secondaryMapKeys).toContain(secondaryActiveId);
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
