/**
 * Multi-context E2E — party member receives ally's `spell-cast` Realtime
 * cue (BACKLOG 12.6, smoke variant).
 *
 * Spec (user explicit 2026-05-25): "chce miec pewnosc ze animacje skilli
 * pokazuja sie poprawnie i tak i w party i solo i sojusznikom i na moim
 * ekranie". This file covers the **multi-context Realtime pipeline**
 * leg — the underlying mechanism that powers "sojusznik widzi animację
 * skilla". The receiver's `usePartyCombatSyncStore.lastSpellByCaster`
 * map is what Combat.tsx / Boss.tsx / Dungeon.tsx watch to fire
 * `fx.triggerEnemySkillAnim` / `fx.triggerAllySkillAnim` on remote
 * casts — proving this map updates cross-context proves the rest of
 * the path (which already has unit coverage via
 * `partyCombatSyncStore.test.ts`).
 *
 * Why store-level smoke vs. full in-combat render:
 *   • Full in-combat render requires both players to enter `phase=fighting`
 *     in a shared hunt (ready-check popup → secondary confirms → both
 *     clients `engineStartNewFight`). That's a 60s+ flow with multiple
 *     Realtime hops + non-deterministic timing (Rat dies in 1-2 hits
 *     on Knight lvl 5 → action bar disappears before our `.tap()` lands).
 *   • The store-level smoke takes ~30s and exercises the SAME Realtime
 *     channel (`party-combat-<partyId>`) + the SAME broadcast event
 *     (`spell-cast`) + the SAME receiver subscriber that the UI uses.
 *     If this passes, the bug surface for "sojusznik widzi animację"
 *     is reduced to "the Combat.tsx useEffect that watches
 *     `partyLastSpells` correctly dispatches `fx.trigger*SkillAnim`",
 *     which has unit coverage in `partyCombatSyncStore.test.ts` +
 *     `Combat.test.tsx`.
 *   • The solo per-class animation test
 *     (`skills/animations/solo-trainer-per-class.spec.ts`) already
 *     proves the `fx.trigger*SkillAnim` → DOM render path works for
 *     all 7 classes. So the multi-context smoke completes the chain:
 *     [primary publish] → [Realtime channel] → [secondary store] →
 *     (covered by solo) → [DOM render].
 *
 * Setup (mirrors `social/party/join/from-secondary-account.spec.ts`):
 *   1. Seed Knight (primary) + Mage (secondary) at lvl 10 via direct API.
 *   2. Open 2 browser contexts in parallel, parallel-login.
 *   3. Both pick character → Town. AppShell mounts `usePartyCombatSync`
 *      (line 72) which subscribes to `party-combat-<partyId>` once
 *      `partyStore.party` is hydrated AND has >= 2 humans.
 *   4. PRIMARY creates a public party via UI; SECONDARY joins via UI.
 *      Both `usePartyCombatSync` instances now subscribed to the same
 *      Realtime channel.
 *
 * Actions:
 *   5. PRIMARY's page.evaluate calls
 *      `usePartyCombatSyncStore.getState().publishSpellCast({
 *         casterId: <primary char id>, casterName: 'PrimaryNick',
 *         skillId: 'fireball', label: 'Kula Ognia',
 *         targetIdx: 0, isDamageHit: true
 *      })`. This is the exact call the engine fires from
 *      `combatEngine.ts` line 414 when a manual cast resolves.
 *
 * Assertions:
 *   6. SECONDARY's page.evaluate polls
 *      `usePartyCombatSyncStore.getState().lastSpellByCaster[<primary id>]`
 *      until it returns a non-null entry with the expected `skillId`
 *      + `casterId`. Up to 20 s budget — Realtime postgres_changes /
 *      broadcasts on mobile-chrome can take 5-15 s when the channel is
 *      cold.
 *   7. REVERSE direction: SECONDARY publishes another spell-cast →
 *      PRIMARY's `lastSpellByCaster` populates with secondary's caster
 *      id. Proves the channel is BIDIRECTIONAL (not just one-way leader
 *      → member). Real combat broadcasts originate from BOTH sides
 *      (every member's own cast) so we want guaranteed coverage of
 *      both directions.
 *
 * Cleanup: `openMultiContext.cleanup` nukes characters + parties.
 *
 * 120 s timeout per multi-context convention (README.md).
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

/**
 * Read the active character id from `characterStore.character.id` via
 * page.evaluate. We need this to feed `casterId` into publishSpellCast,
 * because Combat.tsx's receiver useEffect keys the animation off the
 * caster's character.id (line 789 — `for (const [casterId, cast] of …)`).
 */
const readActiveCharacterId = async (page: Page): Promise<string> => {
    const id = await page.evaluate(async () => {
        // Dynamic import — characterStore is bundled with the app; this
        // call resolves to the same singleton zustand store the app uses.
        const mod = await import('/src/stores/characterStore.ts');
        const useCharacterStore = (mod as { useCharacterStore: { getState: () => { character: { id: string } | null } } }).useCharacterStore;
        return useCharacterStore.getState().character?.id ?? '';
    });
    if (!id) throw new Error('[party-member-sees-ally-spell-cast] activeCharacterId is empty — character not hydrated yet');
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
        const mod = await import('/src/stores/partyCombatSyncStore.ts');
        const usePartyCombatSyncStore = (mod as {
            usePartyCombatSyncStore: { getState: () => { publishSpellCast: (cast: typeof a) => void } };
        }).usePartyCombatSyncStore;
        usePartyCombatSyncStore.getState().publishSpellCast(a);
    }, args);
};

/**
 * Poll the receiver page's `lastSpellByCaster[casterId]` until it matches
 * the expected skill id OR the budget expires. Returns the entry on
 * success, throws on timeout.
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

test.describe('Skills › Animations', { tag: '@skills' }, () => {
    // Multi-context = 2× login + 2× character pick + party flow + 2× Realtime
    // hop → bumped to 120 s per multi-ctx README convention.
    test.describe.configure({ timeout: 120_000 });

    test('multi-context: party member receives ally `spell-cast` Realtime cue (both directions)', async ({ browser }) => {
        const primaryNick = generateTestCharacterName();
        const secondaryNick = generateTestCharacterName();
        const partyName = `SkillAnim ${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

        let primaryCharId: string | null = null;
        let secondaryCharId: string | null = null;
        let handles: Awaited<ReturnType<typeof openMultiContext>> | null = null;

        try {
            // 1. Seed Knight (primary) + Mage (secondary). lvl 10 z hp_regen=0
            //    + mp_regen=0 — match z party multi-ctx fixture conventions.
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

            // Seed empty game_saves po stronie obu kont — pattern z party
            // join test (z fixture multi-context). Bez tego switch postaci
            // moze złoznic hydration race.
            const primaryUserId = await findUserIdByEmail(testUsers.primary.email);
            const secondaryUserId = await findUserIdByEmail(testUsers.secondary.email);
            await seedGameSave({ characterId: primaryCharId, userId: primaryUserId });
            await seedGameSave({ characterId: secondaryCharId, userId: secondaryUserId });

            // 2. Open 2 browser contexts + parallel login.
            handles = await openMultiContext(browser);
            const { primaryPage, secondaryPage } = handles;

            // 3. Both pick character → Town. AppShell mounts usePartyCombatSync
            //    but it only subscribes once party exists with >= 2 humans;
            //    we still need to navigate so the hook re-runs after we
            //    create the party.
            await Promise.all([
                pickCharacterAndEnterTown(primaryPage, primaryNick),
                pickCharacterAndEnterTown(secondaryPage, secondaryNick),
            ]);

            // 4. Both nav to /party.
            await Promise.all([
                navToParty(primaryPage),
                navToParty(secondaryPage),
            ]);

            // 5. PRIMARY: create a PUBLIC party.
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
            // Roster appears with 1/4 members.
            await expect(primaryPage.locator('.party__roster')).toBeVisible({ timeout: 15_000 });
            await expect(primaryPage.locator('.party__roster-meta'))
                .toContainText(/1\/4\s+graczy/i);

            // 6. SECONDARY: refresh public feed + join.
            await secondaryPage.locator('.party__refresh-btn').tap();
            const partyCard = secondaryPage.locator('.party__card', {
                has: secondaryPage.locator('.party__card-name', { hasText: partyName }),
            });
            await expect(partyCard).toBeVisible({ timeout: 15_000 });
            const joinBtn = partyCard.locator('.party__primary-btn', { hasText: /^Dołącz$/i });
            await expect(joinBtn).toBeEnabled({ timeout: 10_000 });
            await joinBtn.tap();

            // Wait until BOTH sides see 2/4 — once that's true, the
            // `usePartyCombatSync` re-subscription effect has fired on
            // both sides because party.members.length transitioned from
            // 1 → 2 (or undefined → 2 on the joiner). Without this
            // synchronisation barrier, publishSpellCast on primary could
            // fire before secondary's `subscribe(partyId)` has registered
            // the channel, dropping the broadcast.
            // 45s: the cross-context Realtime broadcast (secondary's join
            // reaching primary) can take 15-25s under full-suite load.
            await expect(secondaryPage.locator('.party__roster-meta'))
                .toContainText(/2\/4\s+graczy/i, { timeout: 45_000 });
            await expect(primaryPage.locator('.party__roster-meta'))
                .toContainText(/2\/4\s+graczy/i, { timeout: 45_000 });

            // Small buffer (1 s) — Supabase Realtime's "channel SUBSCRIBED"
            // callback can lag behind the visible UI roster sync by a
            // few hundred ms on mobile-chrome. publishSpellCast fires a
            // broadcast on the channel; if the receiver hasn't completed
            // its SUBSCRIBE handshake yet, the broadcast is silently
            // dropped (Realtime doesn't queue for late subscribers).
            await primaryPage.waitForTimeout(1_000);

            // 7. Read the active character ids — we need them to feed
            //    casterId into publishSpellCast + assert lastSpellByCaster
            //    on the receiver.
            const primaryActiveId = await readActiveCharacterId(primaryPage);
            const secondaryActiveId = await readActiveCharacterId(secondaryPage);
            expect(primaryActiveId).toBe(primaryCharId);
            expect(secondaryActiveId).toBe(secondaryCharId);

            // 8. DIRECTION A: PRIMARY publishes `fireball` cast → SECONDARY
            //    receives it in `lastSpellByCaster[primaryActiveId]`.
            //    Matches the engine's manual-cast publish shape
            //    (combatEngine.ts line 414).
            await publishSpellCastFromPage(primaryPage, {
                casterId: primaryActiveId,
                casterName: primaryNick,
                skillId: 'fireball',
                label: 'Kula Ognia',
                targetIdx: 0,
                isDamageHit: true,
            });

            const receivedA = await waitForReceivedSpellCast(secondaryPage, {
                casterId: primaryActiveId,
                expectedSkillId: 'fireball',
                timeoutMs: 45_000,
            });
            expect(receivedA.skillId).toBe('fireball');
            expect(receivedA.casterId).toBe(primaryActiveId);

            // 9. DIRECTION B: SECONDARY publishes `shield_bash` cast →
            //    PRIMARY receives. Bidirectional confirms the channel
            //    isn't leader-only — every member's local casts must
            //    broadcast so leader sees their teammate's animations.
            //    (combatEngine.ts publishes for both leader and member
            //    when they manually cast in hunt/boss/dungeon/raid.)
            await publishSpellCastFromPage(secondaryPage, {
                casterId: secondaryActiveId,
                casterName: secondaryNick,
                skillId: 'shield_bash',
                label: 'Uderzenie Tarczą',
                targetIdx: 0,
                isDamageHit: true,
            });

            const receivedB = await waitForReceivedSpellCast(primaryPage, {
                casterId: secondaryActiveId,
                expectedSkillId: 'shield_bash',
                timeoutMs: 45_000,
            });
            expect(receivedB.skillId).toBe('shield_bash');
            expect(receivedB.casterId).toBe(secondaryActiveId);
        } finally {
            if (handles) {
                await handles.cleanup({ primaryCharId, secondaryCharId });
            } else {
                // Fixture never opened (early seed failure) — still try
                // to wipe characters directly via the cleanup helper.
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
