/**
 * Multi-context atomic E2E — primary's `hp_pct_25` buff broadcasts via
 * `usePartyPresence` so the secondary's Town view of primary's party row
 * shows the BOOSTED effective max HP.
 *
 * Spec (BACKLOG.md punkt 3.5 expansion): "Eliksir +25% HP -> HP identyczne
 * na: Town + TopHeader + CharacterSelect + każda walka + **party** + gildia"
 *
 * Pokrywa PARTY view (3.5-party slice).
 *
 * ## What this test pins
 *
 * The "consistency across party members" contract relies on the leader's
 * effective max HP (which includes elixir multipliers) being broadcast via
 * `usePartyPresence`. The broadcaster (usePartyPresence.ts line 99-100,
 * 128) sends `eff.max_hp` from `getEffectiveChar(c)` — NOT raw
 * `character.max_hp`. The receiver (Town.tsx line 490-494) reads
 * `snap.maxHp` for non-me members and displays it as text in
 * `.town__party-hp-text`.
 *
 * If a regression made the broadcaster send raw max HP, secondary would
 * see primary's HP cap at 120 (Knight base) while primary's own UI in
 * Combat / TopHeader popover shows 150 — split-brain inconsistency that
 * matters in raid/dungeon coordination ("can our tank survive this hit?").
 *
 * ## Bug surface this test guards
 *
 * 1. `usePartyPresence` broadcast omits the effective multiplier (would
 *    send 120 instead of 150 for Knight + hp_pct_25). Secondary would
 *    see "40/120" instead of "40/150".
 * 2. Realtime channel transport silently truncates the payload (extremely
 *    unlikely but possible if a future serialization change clamps
 *    fields to specific ranges).
 * 3. Town.tsx receiver-side rendering uses wrong snap field (e.g. reads
 *    `snap.hp` for max).
 *
 * ## Why we don't assert primary's OWN view of their HP row
 *
 * Town.tsx line 486-488 hardcodes `maxHp = character.max_hp` (raw,
 * NOT effective) for the local-player row in the party strip. This means
 * primary's own row would show "40/120" even with hp_pct_25 active —
 * which is a known app-level quirk (potential UX bug worth tracking, but
 * not in scope here). The TopHeader popover for primary's OWN view IS
 * effective-aware and shows "40/150" — that's covered by the existing
 * `shop/elixirs/hp-pct-elixir-consistency-across-views.spec.ts`.
 *
 * The CANONICAL "party consistency" check is: does a TEAMMATE see my
 * boosted max HP? That's what this test asserts.
 *
 * ## Setup
 *
 * - Primary: Knight, lvl 10, hp=40, buff hp_pct_25 -> expected 150 max HP.
 * - Secondary: Mage, lvl 10, vanilla (no buff).
 * - Both join party (primary creates, secondary joins via Refresh).
 * - Both navigate Town with `town__party-strip--expanded` (tap to expand
 *   when not auto-expanded).
 *
 * ## Cleanup
 *
 * `multiContext.cleanup` handles BOTH characters + the party row owned by
 * primary (no FK on party.leader_id, so character delete alone leaves the
 * `parties` row orphaned).
 */

import { test, expect, type Page } from '@playwright/test';
import { testUsers } from '../../../fixtures/testUsers';
import { createCharacterViaApi, generateTestCharacterName } from '../../../fixtures/createCharacter';
import { seedGameSave, findUserIdByEmail } from '../../../fixtures/seedGameSave';
import { openMultiContext } from '../../../fixtures/multiContext';

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

test.describe('Social › Party › Elixirs', { tag: '@party' }, () => {
    test.describe.configure({ timeout: 180_000 });

    test('primary hp_pct_25 buff -> secondary sees primary boosted HP in Town party row via usePartyPresence broadcast', async ({ browser }) => {
        const primaryNick = generateTestCharacterName();
        const secondaryNick = generateTestCharacterName();
        const partyName = `Pres ${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

        let primaryCharId: string | null = null;
        let secondaryCharId: string | null = null;
        let handles: Awaited<ReturnType<typeof openMultiContext>> | null = null;

        try {
            // 1. Seed characters. Primary = Knight (max_hp baseline=120 -> 150
            //    with hp_pct_25). Secondary = Mage for the standard contrast.
            //    Both at lvl 10 to avoid level-gate complications.
            const primaryCreated = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: primaryNick,
                class: 'Knight',
                overrides: { hp: 40, mp: 15, level: 10, highest_level: 10, hp_regen: 0, mp_regen: 0 },
            });
            primaryCharId = primaryCreated.id;
            const secondaryCreated = await createCharacterViaApi({
                userEmail: testUsers.secondary.email,
                name: secondaryNick,
                class: 'Mage',
                overrides: { level: 10, highest_level: 10, hp_regen: 0, mp_regen: 0 },
            });
            secondaryCharId = secondaryCreated.id;

            // 2. Seed game_saves. Primary has the buff seeded so it
            //    rehydrates into useBuffStore on switchToCharacter.
            //    Secondary is vanilla — no buff, so their broadcast shows
            //    their raw max MP and won't confuse the test.
            const primaryUserId = await findUserIdByEmail(testUsers.primary.email);
            const secondaryUserId = await findUserIdByEmail(testUsers.secondary.email);
            await seedGameSave({
                characterId: primaryCharId,
                userId: primaryUserId,
                buffs: [
                    {
                        id: 'hp_pct_25',
                        name: 'Max HP +25%',
                        icon: 'heart-on-fire',
                        effect: 'hp_pct_25',
                    },
                ],
            });
            await seedGameSave({
                characterId: secondaryCharId,
                userId: secondaryUserId,
            });

            // 3. Open multi-context + login both.
            handles = await openMultiContext(browser);
            const { primaryPage, secondaryPage } = handles;

            // 4. Both pick character -> Town.
            await Promise.all([
                pickCharacterAndEnterTown(primaryPage, primaryNick),
                pickCharacterAndEnterTown(secondaryPage, secondaryNick),
            ]);

            // 5. Sanity: primary's buff hydrated.
            const hasBuffPrimary = await primaryPage.evaluate(async () => {
                // @ts-expect-error — dev-time Vite URL not resolvable by tsc
                const mod = await import('/src/stores/buffStore.ts');
                return (mod as {
                    useBuffStore: { getState: () => { hasBuff: (e: string) => boolean } };
                }).useBuffStore.getState().hasBuff('hp_pct_25');
            });
            expect(hasBuffPrimary).toBe(true);

            // 6. Both navigate to /party so primary can create + secondary
            //    can join. Public party (no password) — Town shortcut
            //    creates one inline, but we go through /party for the
            //    explicit name + parity with other multi-ctx tests.
            await Promise.all([
                navToParty(primaryPage),
                navToParty(secondaryPage),
            ]);

            // 7. Primary creates public party.
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

            // 8. Secondary refresh + join.
            await secondaryPage.locator('.party__refresh-btn').tap();
            const partyCard = secondaryPage.locator('.party__card', {
                has: secondaryPage.locator('.party__card-name', { hasText: partyName }),
            });
            await expect(partyCard).toBeVisible({ timeout: 15_000 });
            const joinBtn = partyCard.locator('.party__primary-btn', { hasText: /^Dołącz$/i });
            await expect(joinBtn).toBeEnabled({ timeout: 10_000 });
            await joinBtn.tap();

            // 9. Synchronisation barrier — both rosters at 2/4. 45s: the
            //    cross-context Realtime broadcast (secondary's join reaching
            //    primary) can take 15-25s under full-suite load.
            await expect(primaryPage.locator('.party__roster-meta'))
                .toContainText(/2\/4\s+graczy/i, { timeout: 45_000 });
            await expect(secondaryPage.locator('.party__roster-meta'))
                .toContainText(/2\/4\s+graczy/i, { timeout: 45_000 });

            // 10. Both navigate back to Town via BottomNav Miasto tap.
            //     `page.goto('/')` from /party caused a redirect to
            //     /character-select on mobile-safari (likely AppShell auth
            //     guard race during the hard navigation). Using the BottomNav
            //     button mirrors what a real user does and stays inside the
            //     React Router state so the character context survives.
            await Promise.all([
                primaryPage.getByRole('button', { name: /^Miasto$/i }).tap(),
                secondaryPage.getByRole('button', { name: /^Miasto$/i }).tap(),
            ]);
            await expect(primaryPage).toHaveURL(/\/$/, { timeout: 10_000 });
            await expect(secondaryPage).toHaveURL(/\/$/, { timeout: 10_000 });
            await expect(primaryPage.locator('.town__char-name')).toHaveText(primaryNick, { timeout: 10_000 });
            await expect(secondaryPage.locator('.town__char-name')).toHaveText(secondaryNick, { timeout: 10_000 });

            // 11. Tap to expand the party strip on secondary's side (Town's
            //     party strip is collapsed by default — only the avatar row
            //     shows. The HP text lives in the expanded body).
            const stripHeader = secondaryPage.locator('.town__party-strip-header');
            await expect(stripHeader).toBeVisible({ timeout: 10_000 });
            await stripHeader.tap();
            await expect(secondaryPage.locator('.town__party-strip--expanded'))
                .toBeVisible({ timeout: 5_000 });

            // 12. Wait for party presence broadcast to arrive on secondary
            //     (usePartyPresence publishes every 2s + on HP change; party
            //     ID also drives an immediate publish on subscribe). 45s: the
            //     cross-context presence broadcast can take 15-25s under
            //     full-suite load.
            //
            //     KEY ASSERTION: secondary's view of primary's row shows
            //     `40/150` — the EFFECTIVE max HP broadcast via partyPresence.
            //     If the broadcaster regression-shipped raw 120 instead of
            //     effective 150, this would fail with `40/120`.
            const primaryRow = secondaryPage.locator('.town__party-row', {
                has: secondaryPage.locator('.town__party-row-name', { hasText: primaryNick }),
            });
            await expect(primaryRow).toBeVisible({ timeout: 45_000 });
            const hpText = primaryRow.locator('.town__party-hp-text');
            await expect(hpText).toHaveText('40/150', { timeout: 45_000 });

            // 13. Cross-check via partyPresence store directly — proves the
            //     broadcast payload itself carried maxHp=150 (not just the
            //     UI rendering it). If a future race kept the UI showing
            //     stale 120 from an initial null snap, the store assertion
            //     would catch it independently of the DOM.
            const presenceMaxHp = await secondaryPage.evaluate(async (charId) => {
                // @ts-expect-error — dev-time Vite URL not resolvable by tsc
                const mod = await import('/src/stores/partyPresenceStore.ts');
                const store = (mod as {
                    usePartyPresenceStore: { getState: () => { byMember: Record<string, { maxHp: number }> } };
                }).usePartyPresenceStore.getState();
                return store.byMember[charId]?.maxHp ?? null;
            }, primaryCharId);
            expect(presenceMaxHp).toBe(150);
        } finally {
            if (handles) {
                await handles.cleanup({ primaryCharId, secondaryCharId });
            }
        }
    });
});
