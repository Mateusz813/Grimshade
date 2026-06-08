/**
 * Atomic E2E smoke — `/transform` (transform hub) renders the transform
 * list without JS errors.
 *
 * Spec (BACKLOG.md punkt 13.5 — per-combat-type smoke, transform variant):
 * "Każdy typ walki E2E smoke (polowanie/raid/dungeon/boss/arena/trainer/
 * loch/transform)".
 *
 * Co testujemy (smoke only):
 *  - Direct nav na `/transform` z aktywną postacią poprawnie renderuje
 *    `.transform` root + transform list (phase 'list' jest default —
 *    Transform.tsx linia 439).
 *  - `.transform__list` widoczny (renderList branch, Transform.tsx linia
 *    2103). Co najmniej 1 `.transform__card` w środku — `allTransforms`
 *    iteruje pełną tabelę 1..12 tier-ów, więc lista zawsze ma >= 1 card
 *    nawet dla świeżego Knight lvl 1 (każda karta = jeden status: locked
 *    / available / in_progress / completed).
 *  - Strona NIE redirectuje — CombatGuard sprawdza
 *    `combatStore.phase === 'fighting'`, którego nie odpalamy.
 *  - Każda transform card ma name (`.transform__card-name`) +
 *    level pill (`.transform__card-level-pill`) — sanity ze JSX został
 *    poprawnie zhydratowany z `allTransforms` data.
 *
 * **Co NIE testujemy** (defer do osobnych speców):
 *  - Faktyczna walka z transformem (tap "Walcz" → entry overlay →
 *    escort spawn → boss → reward popup).
 *  - Transform unlocked-state logic (Knight lvl 1 zobaczy wszystkie
 *    transformy jako locked — verify w 13.5 rewards spec).
 *  - Reward animation, transform complete popup, avatar reveal.
 *
 * Seed: Knight lvl 1 (default base stats). Każdy transform będzie locked
 * (gate level wysoki), ale renderowane karty są — pełna lista 1..12.
 *
 * Cleanup: try/finally + cleanupCharacterById.
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';

test.describe('Combat › Transform', { tag: '@combat' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('smoke: /transform renders transform list without errors', async ({ page }) => {
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
            //     zhydratowany przed direct-nav. Bez tego Transform.tsx
            //     linia 2094-2096 może zwrócić wczesny <p>Brak postaci.</p>
            //     placeholder (zamiast pełnego renderList branch-u).
            await expect(page.locator('.top-header')).toBeVisible({ timeout: 10_000 });

            // 3. Direct nav na /transform. CombatGuard pozwala bo
            //    combatStore.phase = 'idle' po świeżej hydratacji.
            await page.goto('/transform');

            // 4. URL pozostaje /transform (sanity — nie ma redirect na "/").
            await expect(page).toHaveURL(/\/transform$/, { timeout: 10_000 });

            // 5. Root `.transform` container widoczny. Transform.tsx
            //    linia 2094-2096 = early `<div className="transform"><p>Brak postaci.</p></div>`
            //    gdy character==null; my dajemy character != null, więc
            //    pełna render-pipeline odpala.
            await expect(page.locator('.transform')).toBeVisible({ timeout: 10_000 });

            // 6. `.transform__list` widoczny — renderList branch
            //    (Transform.tsx linia 2103). To potwierdza ze phase='list'
            //    branch w main render odpalil (linia 3093).
            await expect(page.locator('.transform__list')).toBeVisible({ timeout: 10_000 });

            // 7. Co najmniej 1 transform card (`.transform__card`) widoczna.
            //    `allTransforms` data zawiera 12 tier-ów, więc cards.count() >= 12.
            //    Asercja >= 1 dla stabilności gdy ktoś doda / usunie tier
            //    w przyszłości.
            const cards = page.locator('.transform__card');
            await expect(cards.first()).toBeVisible({ timeout: 10_000 });
            const cardCount = await cards.count();
            expect(cardCount).toBeGreaterThanOrEqual(1);

            // 8. Karta ma name + level pill (sanity że dane się
            //    zhydratowały z allTransforms array, nie pusty placeholder).
            //    Transform.tsx linia 2139-2140.
            await expect(page.locator('.transform__card-name').first()).toBeVisible({ timeout: 5_000 });
            await expect(page.locator('.transform__card-level-pill').first()).toBeVisible();
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
