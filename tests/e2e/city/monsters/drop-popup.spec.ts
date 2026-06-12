/**
 * Atomic E2E — Drop info modal opens after tap on monster card's :package: button.
 *
 * Spec (BACKLOG.md punkt 5.2): "Drop popup pokazuje poprawnie".
 *
 * Co testujemy:
 *  - W `/monsters` każda karta ma przycisk `:package:` (`combat__mcard-action--info`).
 *  - Tap na ten przycisk dla ODBLOKOWANEGO potwora otwiera modal
 *    `.combat__drop-modal` z dropami / wariantami / mastery progress.
 *  - Modal pokazuje nazwę potwora w nagłówku + warianty rzadkości
 *    (Normal/Strong/Epic/Legendary/Boss).
 *
 * Seed: postać Knight lvl 1 — wystarczy żeby pierwszy potwór (Szczur
 * lvl 1) był UNLOCKED. Wszystkie wyższe są zablokowane przez mastery
 * gate, ale to nie przeszkadza — testujemy popup pierwszego unlocked.
 *
 * Selektor: `.combat__mcard:not(.combat__mcard--locked)` — pierwsza nie-locked
 * karta. Jej button :package: jest enabled (locked button ma disabled=true co blokuje
 * tap).
 *
 * Cleanup: try/finally + cleanupCharacterById.
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';

test.describe('City › Monsters', { tag: '@city' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('tapping :package: info button opens drop modal for unlocked monster', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            // 1. Seed Knight lvl 1 — Szczur (lvl 1, idx 0 w sorted list) jest UNLOCKED.
            //    Pozostałe potwory mają mastery prereq na poprzedniego (0/1 mastery
            //    na świeżej postaci -> locked), więc :package: button na nich jest disabled.
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
            });
            createdId = created.id;

            // 2. Login + select character + go to /monsters
            await loginViaUI(page, testUsers.primary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 10_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });
            await page.goto('/monsters');

            // 3. Czekamy aż grid się załaduje
            await expect(page.locator('.combat__mcard').first()).toBeVisible({ timeout: 10_000 });

            // 4. Znajdź pierwszą nie-locked kartę i tap :package: (info button).
            //    Locked cards mają class `combat__mcard--locked` i ich button
            //    `combat__mcard-action--info` jest disabled. Selektor :not()
            //    daje nam tylko enabled cards.
            const unlockedCard = page.locator('.combat__mcard:not(.combat__mcard--locked)').first();
            await expect(unlockedCard).toBeVisible({ timeout: 5_000 });

            const infoBtn = unlockedCard.locator('.combat__mcard-action--info');
            await expect(infoBtn).toBeEnabled();
            await infoBtn.tap();

            // 5. Modal powinien się otworzyć. Selektor `combat__drop-modal`
            //    + role="dialog" + nagłówek z nazwą potwora + sekcja wariantów.
            const modal = page.locator('.combat__drop-modal');
            await expect(modal).toBeVisible({ timeout: 5_000 });

            // 6. Sanity: modal pokazuje warianty rzadkości (Normal,
            //    Strong, Epic, Legendary, Boss — 5 wariantów w COMBAT_VARIANTS
            //    w MonsterList.tsx). Każdy = `.combat__variant`.
            const variants = modal.locator('.combat__variant');
            await expect(variants.first()).toBeVisible();
            const variantCount = await variants.count();
            expect(variantCount).toBeGreaterThanOrEqual(5);

            // 7. Sanity: modal ma nazwę potwora w nagłówku
            const modalName = modal.locator('.combat__drop-modal-name');
            await expect(modalName).toBeVisible();
            const nameText = (await modalName.textContent())?.trim();
            expect(nameText && nameText.length > 0).toBeTruthy();

            // 8. Sanity: close button works — modal znika po tap x
            await modal.locator('.combat__drop-modal-close').tap();
            await expect(modal).toHaveCount(0, { timeout: 5_000 });
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
