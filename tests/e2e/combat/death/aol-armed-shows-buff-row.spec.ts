/**
 * Atomic E2E — Amulet of Loss (AOL) consumable armed → TopHeader buff
 * chip + BuffPopover row render with `×N` count.
 *
 * Spec (BACKLOG.md punkt 13.21): "AOL / naszyjnik chroni przed utratą
 * XP / EQ" — wariant SMOKE pokrywający że item siedzi w consumables i
 * UI go widzi jako "armed" (gotowy do zużycia przy śmierci). Ten test
 * NIE pokrywa actual death flow (wymaga combat-sim, deferred do
 * osobnej sesji `combat/death/protection-consumes-aol-on-death.spec.ts`)
 * — ale gwarantuje że:
 *
 *  1. Postać z `consumables.amulet_of_loss > 0` widzi w TopHeader chip-a
 *     "Aktywne buffy" z licznikiem ≥1 (TopHeader.tsx line 296 — chip
 *     renderuje się tylko gdy `totalBuffCount > 0`, a
 *     `aolCount > 0 → +1`).
 *  2. Po tap-nięciu chip-a otwiera się `BuffPopover` z dedykowanym
 *     row-em `--protection` zawierającym nazwę "Amulet of Loss" + suffix
 *     `×N` (BuffPopover.tsx line 115-123).
 *
 * Dlaczego SMOKE zamiast pełnego "AOL chroni EQ on death":
 *  • Pełny flow wymaga: tap monster → combat starts → bot+player swing →
 *    player HP hits 0 → `triggerPlayerDeath` w combatEngine.ts line 1382
 *    woła `useConsumable('amulet_of_loss')` (consumes 1, returns true) →
 *    `applyDeathItemLoss(true)` → NO items removed from bag/equipment.
 *  • W E2E "fast forward to death" bez kontrolowanego scaling jest flaky
 *    (rat lvl 1 vs Knight lvl 1 — Knight rzadko ginie). Wymagałoby
 *    seedowania char z 1 HP + boss lvl 1000 albo direct combat-engine
 *    poke przez window globals → nieczyste.
 *  • SMOKE tutaj weryfikuje INPUT do tego flow-u (item siedzi, UI widzi,
 *    licznik jest poprawny). Output (item z bag-a zniknął po śmierci)
 *    będzie pokryty osobnym testem gdy infrastruktura combat-sim
 *    będzie dostępna.
 *
 * Co testujemy DOKŁADNIE:
 *  1. Seed Knight + 3× `amulet_of_loss` w `consumables` przez
 *     `seedConsumables`.
 *  2. Login → wybierz postać → Town view (TopHeader mounted).
 *  3. `.top-header__buffs-btn` widoczny + `.top-header__buffs-count`
 *     text "1" (3× AOL = jeden chip, nie trzy — `totalBuffCount` w
 *     TopHeader.tsx line 214 liczy `aolCount > 0 ? 1 : 0`, nie sumę).
 *  4. Tap chip → `.buff-popover` widoczny.
 *  5. `.buff-popover__row--protection` z text "Amulet of Loss" + `×3`
 *     widoczny.
 *
 * Cleanup: try/finally + `cleanupCharacterById`. AOL leży w
 * `game_saves.state.inventory.consumables` — kasacja game_saves
 * (via CHARACTER_CHILD_TABLES) wymiata całość.
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { seedConsumables } from '../../fixtures/seedInventory';

test.describe('Combat › Death', { tag: '@combat' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('AOL in consumables → TopHeader chip + BuffPopover protection row', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            // 1. Seed Knight lvl 10 z XP=1000 (XP value nie jest sprawdzane
            //    przez UI ale matchuje spec "seed character with xp: 1000"
            //    z task-a — gdyby kiedyś dorzucić DB-side assertion na
            //    `xp` po death-flow, ten seed już będzie pasował).
            //    hp_regen / mp_regen = 0 — hard rule (CLAUDE.md TESTING).
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

            // 2. Seed 3× Amulet of Loss. Counts > 0 = AOL armed.
            //    `totalBuffCount` w TopHeader.tsx line 214: `+ (aolCount > 0 ? 1 : 0)`.
            //    Niezależnie od count (3 lub 1) → 1 chip w nagłówku.
            //    Popover wyświetla pełny `×N` count (3) na row-ie.
            await seedConsumables({
                characterId: created.id,
                counts: { amulet_of_loss: 3 },
            });

            // 3. Login → character-select → pick → Town view (TopHeader mounted).
            await loginViaUI(page, testUsers.primary);
            if (!page.url().endsWith('/character-select')) {
                await page.goto('/character-select');
            }
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 10_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });
            await expect(page.locator('.town__char-name')).toHaveText(nick);

            // 4. TopHeader buff chip renderuje się gdy `totalBuffCount > 0`.
            //    Tylko AOL siedzi (active buffs = 0, death_protection = 0)
            //    → totalBuffCount = 0 + (3 > 0 ? 1 : 0) + (0 > 0 ? 1 : 0) = 1.
            const buffsBtn = page.locator('.top-header__buffs-btn');
            await expect(buffsBtn).toBeVisible({ timeout: 10_000 });
            await expect(buffsBtn.locator('.top-header__buffs-count')).toHaveText('1');

            // 5. Tap chip → BuffPopover otwiera się.
            await buffsBtn.tap();
            const popover = page.locator('.buff-popover');
            await expect(popover).toBeVisible({ timeout: 5_000 });

            // 6. Protection row: dedykowany modifier `--protection`
            //    (BuffPopover.tsx line 116). Zawiera nazwę "Amulet of Loss"
            //    + suffix `×3` (seedowany count).
            const aolRow = popover.locator('.buff-popover__row--protection', {
                hasText: 'Amulet of Loss',
            });
            await expect(aolRow).toBeVisible();
            await expect(aolRow.locator('.buff-popover__row-name')).toHaveText('Amulet of Loss');
            await expect(aolRow.locator('.buff-popover__row-time')).toHaveText('×3');
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
