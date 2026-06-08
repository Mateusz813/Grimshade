/**
 * Atomic E2E — Death Protection elixir armed → TopHeader buff chip +
 * BuffPopover row render with `×N` count.
 *
 * Spec (BACKLOG.md punkt 13.21 sibling): companion test do
 * `aol-armed-shows-buff-row.spec.ts`. Pokrywa drugi protection
 * consumable — `death_protection` ("Eliksir Ochrony przed Śmiercią"
 * z shopStore.ts line 110) który chroni przed utratą poziomu/statystyk
 * (XP penalty) zamiast EQ loss.
 *
 * Two consumables, two effects, dwa testy:
 *   • amulet_of_loss     → chroni przedmioty (bag + equipment loss)
 *     → BuffPopover row "Amulet of Loss" + suffix `×N`
 *   • death_protection   → chroni poziom + skill XP
 *     → BuffPopover row "Eliksir ochrony" + suffix `×N`
 *
 * Oba używają tej samej combat-engine hook (combatEngine.ts line
 * 1381-1382): `useConsumable('death_protection')` + `useConsumable
 * ('amulet_of_loss')`. Render-side też identyczny — BuffPopover.tsx
 * line 106-123 ma dwa branch-e:
 *   • `if (deathProtCount > 0)` → row "Eliksir ochrony"
 *   • `if (aolCount > 0)`       → row "Amulet of Loss"
 *
 * Test sprawdza że death_protection branch renderuje się analogicznie
 * do AOL — żeby nie dać regresji typu "skopiowałem AOL branch i
 * pomyliłem `aolCount > 0` w if-ie death_protection".
 *
 * Co testujemy DOKŁADNIE:
 *  1. Seed Knight + 2× `death_protection` w `consumables`.
 *  2. Login → wybierz postać → Town view.
 *  3. `.top-header__buffs-btn` widoczny + count "1" (2× DP = jeden
 *     chip; `totalBuffCount` w TopHeader.tsx line 214 liczy
 *     `deathProtCount > 0 ? 1 : 0`, nie sumę).
 *  4. Tap chip → `.buff-popover` widoczny.
 *  5. `.buff-popover__row--protection` z "Eliksir ochrony" + `×2`
 *     widoczny.
 *
 * Combined render z obu test-ów (DP + AOL razem) jest covered przez
 * `BuffPopover.test.tsx` linia 131-140 (vitest unit-level). Tutaj
 * skupiamy się na E2E sanity że oba consumable id-y poprawnie
 * propagują z DB blob-a do UI.
 *
 * Cleanup: try/finally + `cleanupCharacterById`.
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { seedConsumables } from '../../fixtures/seedInventory';

test.describe('Combat › Death', { tag: '@combat' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('Death Protection elixir in consumables → BuffPopover protection row', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            // 1. Seed Knight lvl 10 z XP=1000 (matching task spec, choć UI
            //    nie sprawdza tej wartości — kontext "char ma sporo XP do
            //    stracenia, ale DP go uchroni").
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

            // 2. Seed 2× Death Protection. Counts > 0 = DP armed.
            //    Niezależnie od count → 1 chip w nagłówku, popover
            //    pokazuje pełny `×2`.
            await seedConsumables({
                characterId: created.id,
                counts: { death_protection: 2 },
            });

            // 3. Login → character-select → pick → Town view.
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

            // 4. TopHeader buff chip: count "1" (DP samo, bez AOL ani
            //    aktywnych buffów).
            const buffsBtn = page.locator('.top-header__buffs-btn');
            await expect(buffsBtn).toBeVisible({ timeout: 10_000 });
            await expect(buffsBtn.locator('.top-header__buffs-count')).toHaveText('1');

            // 5. Tap chip → BuffPopover otwiera się.
            await buffsBtn.tap();
            const popover = page.locator('.buff-popover');
            await expect(popover).toBeVisible({ timeout: 5_000 });

            // 6. Protection row: "Eliksir ochrony" + `×2`.
            //    BuffPopover.tsx line 106-113.
            const dpRow = popover.locator('.buff-popover__row--protection', {
                hasText: 'Eliksir ochrony',
            });
            await expect(dpRow).toBeVisible();
            await expect(dpRow.locator('.buff-popover__row-name')).toHaveText('Eliksir ochrony');
            await expect(dpRow.locator('.buff-popover__row-time')).toHaveText('×2');

            // 7. AOL row NIE powinien się renderować (aolCount = 0).
            //    Sanity check przeciwko regresji "fancy CSS pomylonego
            //    selectora pokazuje oba branche zawsze".
            const aolRow = popover.locator('.buff-popover__row--protection', {
                hasText: 'Amulet of Loss',
            });
            await expect(aolRow).toHaveCount(0);
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
