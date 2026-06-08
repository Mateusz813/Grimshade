/**
 * Atomic E2E smoke — `/raid` (raid lobby) renders the "no party" gate
 * for a solo player without JS errors.
 *
 * Spec (BACKLOG.md punkt 13.5 — per-combat-type smoke, raid variant):
 * "Każdy typ walki E2E smoke (polowanie/raid/dungeon/boss/arena/trainer/
 * loch/transform)".
 *
 * Co testujemy (smoke only):
 *  - Direct nav na `/raid` z aktywną solo postacią poprawnie renderuje
 *    `.raid` root + `.raid__gate` (no-party gate). Raid.tsx linia 3209
 *    `const noParty = !party;` → renderuje `.raid__gate` z "Potrzebujesz
 *    Party" heading + CTA → /party.
 *  - URL pozostaje `/raid` — OnlineOnlyGuard PASSES (online by default
 *    fresh boot), CombatGuard PASSES (phase='idle').
 *
 * **Co NIE testujemy** (defer do osobnych speców):
 *  - Faktyczna walka raidowa (wymaga party 2+ → multi-context).
 *  - Raid list z filterami (wymaga `showList` = party + leader).
 *  - Party-too-small / not-leader gates (osobne party-state setups).
 *
 * Co solo Knight widzi (potwierdzone przez source-reading 2026-05-25):
 *  - `noParty = true` (party store empty po świeżym character-create)
 *  - `partyTooSmall = false` (no party = skipped)
 *  - `notLeader = false` (no party = skipped)
 *  - `showList = false`
 *  - Renderuje TYLKO `<div className="raid__gate">` z icon 🔒 +
 *    `<h2>Potrzebujesz Party</h2>` + CTA "Przejdź do Party"
 *  - `.raid__panel` / `.raid__hub-filters` NIE renderowane bez party
 *
 * **App-bug note**: Raid.tsx NIE ma Rules of Hooks violation jak Boss /
 * Transform / Dungeon / Trainer — nie ma top-level `if (!character) return …`,
 * tylko inline `?? defaults` w renderze. Verified manually 2026-05-25.
 *
 * Seed: Knight lvl 1.
 *
 * Cleanup: try/finally + cleanupCharacterById.
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';

test.describe('Combat › Raid', { tag: '@combat' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('smoke: /raid renders no-party gate for solo player', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            // 1. Seed Knight lvl 1.
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: { hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            // 2. Login → wybierz postać → Town
            await loginViaUI(page, testUsers.primary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 10_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });

            // 2b. Wait dla TopHeader żeby characterStore.character zostal
            //     zhydratowany przed direct-nav.
            await expect(page.locator('.top-header')).toBeVisible({ timeout: 10_000 });

            // 3. Direct nav na /raid. OnlineOnlyGuard PASSES (online default).
            //    CombatGuard PASSES (phase='idle').
            await page.goto('/raid');

            // 4. URL pozostaje /raid (sanity — żaden guard nie redirectuje).
            await expect(page).toHaveURL(/\/raid$/, { timeout: 10_000 });

            // 5. Root `.raid` container widoczny. Raid.tsx renderuje
            //    `<div className="raid">` w lobby phase (default) na linii 3231.
            await expect(page.locator('.raid')).toBeVisible({ timeout: 10_000 });

            // 6. `.raid__gate` widoczny — solo player ma `noParty=true`,
            //    więc gate "Potrzebujesz Party" renderuje się (linia 3232-3239).
            //    `:has-text` żeby targetować konkretnie no-party gate
            //    (są 3 możliwe gate-y: no-party / too-small / not-leader),
            //    nie cokolwiek z `.raid__gate`.
            const noPartyGate = page.locator('.raid__gate', {
                hasText: /Potrzebujesz Party/i,
            });
            await expect(noPartyGate).toBeVisible({ timeout: 15_000 });

            // 7. Sanity — `.raid__panel` (showList branch) NIE jest
            //    renderowany dla solo gracza (showList wymaga party + 2+ ppl
            //    + iAmLeader). Defensive assertion żeby złapać kiedyś gdyby
            //    ktoś usunął party-gate logic.
            await expect(page.locator('.raid__panel')).toHaveCount(0);
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
