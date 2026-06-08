/**
 * Atomic E2E — Auto-potion settings UI renders 4 threshold panels.
 *
 * Spec (BACKLOG.md punkt 11.4): "Auto-potion settings UI renders (smoke
 * — verify HP threshold + MP threshold inputs present)".
 *
 * Setup state:
 *   1. Seed Knight via API (deterministyczne base — settings store
 *      hydratuje z game_saves defaults / characterScope: 4 slots, kazdy
 *      threshold = 50% lub 40%, kazdy enable=true/false zgodnie z domyslnymi).
 *   2. Login + select character → wejscie do Town (`/`).
 *
 * One action:   navigate to `/inventory` → tap "Potion" w action row pod
 *               paperdoll-em (`aria-label="Auto-potion"`,
 *               `setPopupKey('potion')` — Inventory.tsx linia 3482).
 *
 * One outcome:  Popup `.inventory__popup--potion` sie otwiera (linia 3577)
 *               i zawiera:
 *               - 2 zakladki: "⚙️ Auto-potion" + "🧪 Alchemia" (linia 3598-3613)
 *               - aktywna jest Auto-potion (default tab — Inventory.tsx
 *                 line 2705: `useState<'auto' | 'alchemy'>('auto')`)
 *               - 4 bloki `.inventory__potion-setting` (linia 3618, 3667,
 *                 3716, 3765) — Flat HP / Flat MP / Pct HP / Pct MP
 *               - Kazdy blok ma `input[type="range"]` (slider) +
 *                 `input[type="checkbox"]` (enable toggle)
 *               - Labelki w blokach: "Auto HP Potion", "Auto MP Potion",
 *                 "Auto % HP Potion", "Auto % MP Potion"
 *
 * Cleanup:      try/finally → `cleanupCharacterById(createdId)`.
 *
 * Co testujemy (i co NIE):
 *  - SMOKE: popup sie otwiera + ma wymaganą strukturę 4-slot threshold
 *    panelu. NIE testujemy persistencji (to test 11.1 osobno), NIE
 *    sprawdzamy default values (jak threshold === 50%) bo settingsStore
 *    default w hydratacji moze sie roznic od on-disk defaults gdy
 *    properties są nieobecne w blobie save-a.
 *  - NIE klikamy w tab Alchemia tutaj — test 11.4 is "Auto-potion UI",
 *    osobny alchemy/ui-renders.spec.ts pokrywa Alchemia surface.
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../fixtures/testUsers';
import { loginViaUI } from '../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../fixtures/createCharacter';
import { cleanupCharacterById } from '../fixtures/cleanup';

test.describe('Auto-Potion › Settings', { tag: '@auto-potion' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('settings popup renders 4 threshold slots (Flat HP / Flat MP / Pct HP / Pct MP)', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            // 1. Seed Knight — wystarcza domyslnym settings store defaults
            //    z characterScope (linia 234-241). hp_regen=0 + mp_regen=0
            //    żeby nie tickowało HP/MP w trakcie testu (mniej noise w UI).
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: { hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            // 2. Login + wejście do Town przez postać
            await loginViaUI(page, testUsers.primary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 10_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });

            // 3. /inventory → wait for paperdoll actions row to be ready.
            await page.goto('/inventory');
            await expect(page.locator('.inventory__paperdoll-actions')).toBeVisible({ timeout: 10_000 });

            // 4. Tap "Auto-potion" button (Inventory.tsx linia 3482).
            await page.getByRole('button', { name: /^auto-potion$/i }).tap();

            // 5. Popup `.inventory__popup--potion` is visible (linia 3577).
            const popup = page.locator('.inventory__popup--potion');
            await expect(popup).toBeVisible({ timeout: 5_000 });

            // 6. Header title "🧪 Potiony" (linia 3585).
            await expect(popup.getByText('Potiony')).toBeVisible();

            // 7. 2 popup tabs widoczne (linia 3598-3613).
            await expect(popup.getByRole('button', { name: /Auto-potion/i })).toBeVisible();
            await expect(popup.getByRole('button', { name: /Alchemia/i })).toBeVisible();

            // 8. Domyślnie aktywna jest zakladka Auto-potion — klasa
            //    `inventory__popup-tab--active` na Auto-potion button.
            //    Inventory.tsx linia 2705: useState('auto').
            await expect(popup.locator('.inventory__popup-tab--active'))
                .toContainText(/Auto-potion/i);

            // 9. 4 settings blocks rendered (linia 3618, 3667, 3716, 3765 —
            //    `.inventory__potion-setting`). Smoke = wszystkie 4 obecne.
            await expect(popup.locator('.inventory__potion-setting')).toHaveCount(4);

            // 10. Per-block labels (Inventory.tsx linia 3630, 3679, 3728, 3777).
            //     Każdy blok = jeden potion threshold (HP flat / MP flat /
            //     HP %, MP %). Asercja na obecność labelek = sanity check
            //     że JSX nie został zmieniony bez aktualizacji testu.
            await expect(popup.getByText('Auto HP Potion')).toBeVisible();
            await expect(popup.getByText('Auto MP Potion')).toBeVisible();
            await expect(popup.getByText('Auto % HP Potion')).toBeVisible();
            await expect(popup.getByText('Auto % MP Potion')).toBeVisible();

            // 11. KRYTYCZNE: kazdy block ma slider (`input[type="range"]`).
            //     min=0, max=99, step=1 — patrz linia 3638-3640.
            //     4 sliderow = 4 settings × 1 slider per setting.
            await expect(popup.locator('input[type="range"]')).toHaveCount(4);

            // 12. Kazdy block ma checkbox enable toggle (linia 3622, 3671,
            //     3720, 3769). 4 checkboxów = 4 settings × 1 toggle.
            await expect(popup.locator('input[type="checkbox"].inventory__potion-checkbox')).toHaveCount(4);

            // 13. Kazdy block ma dropdown z lista potionów do uzycia
            //     (linia 3648-3658). `select.inventory__potion-dropdown`
            //     × 4 sloty.
            await expect(popup.locator('select.inventory__potion-dropdown')).toHaveCount(4);
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
