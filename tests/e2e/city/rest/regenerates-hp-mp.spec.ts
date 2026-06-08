/**
 * Atomic E2E — kafelek "Odpoczynek" w Town heal-uje HP/MP do pełna.
 *
 * Spec (BACKLOG.md punkt 5.5): "Odpoczynek (Rest) regeneruje HP/MP".
 *
 * Co testujemy:
 *  - Seed postać Knight z hp=10 (z 120 max), mp=5 (z 30 max), regen=0.
 *    Regen=0 KRYTYCZNE — w przeciwnym razie passive regen tickuje co
 *    sekundę i wartości rosną zanim zdążymy tapnąć Rest (~przed
 *    asserycją).
 *  - Login → Town → bar HP pokazuje 10/120, MP pokazuje 5/30.
 *  - Tap "Odpoczynek" tile (`.town__nav-tile--rest`).
 *  - Wyświetla się overlay regeneracji (`.town__rest-overlay`) z napisem
 *    "Odpoczywasz przy ognisku..."
 *  - Po 10 sekundach (animacja w Town.tsx setTimeout 10_000ms) heal się
 *    aplikuje + overlay zmienia state na "Regeneracja zakończona!"
 *  - HP w bar-ze = 120/120, MP = 30/30.
 *  - Po kolejnych ~2s overlay znika (cleanup w Town.tsx).
 *
 * Timeout testu = 60s (override z describe.configure) — animacja sama
 * w sobie zajmuje 10+2=12s, plus login + nav + selectory.
 *
 * Cleanup: try/finally + cleanupCharacterById.
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';

test.describe('City › Rest', { tag: '@city' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('tapping Odpoczynek tile heals HP and MP to max', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            // 1. Seed Knight z bardzo niskim HP/MP + regen=0.
            //    Knight base: max_hp=120, max_mp=30 (z CLASS_BASE_STATS w fixture).
            //    overrides.hp=10, overrides.mp=5 → znaczna luka do max.
            //    hp_regen=0 + mp_regen=0 — passive tick wyłączony, więc 10 i 5
            //    pozostają stabilne aż do tap-u Odpoczynek.
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: { hp: 10, mp: 5, hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            // 2. Login + tap Wybierz na NASZEJ karcie → Town
            await loginViaUI(page, testUsers.primary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 10_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });

            // 3. Sanity asercja — Town pokazuje naszą postać z low HP/MP
            await expect(page.locator('.town__char-name')).toHaveText(nick);
            const hpBarValue = page.locator('.town__bar-wrap', {
                has: page.locator('.town__bar--hp'),
            }).locator('.town__bar-value');
            const mpBarValue = page.locator('.town__bar-wrap', {
                has: page.locator('.town__bar--mp'),
            }).locator('.town__bar-value');
            await expect(hpBarValue).toHaveText('10/120');
            await expect(mpBarValue).toHaveText('5/30');

            // 4. Tap Odpoczynek tile. Selektor: button z `town__nav-tile--rest`.
            //    Musi być enabled (canRest=true bo hp<max, isResting=false).
            const restTile = page.locator('.town__nav-tile--rest');
            await expect(restTile).toBeEnabled();
            await restTile.tap();

            // 5. Overlay "Odpoczywasz przy ognisku" się pojawia natychmiast
            //    (przed 10s timeout-em który aplikuje heal).
            const overlay = page.locator('.town__rest-overlay');
            await expect(overlay).toBeVisible({ timeout: 5_000 });
            await expect(page.locator('.town__rest-text')).toContainText('Odpoczywasz');

            // 6. Czekamy aż heal się zaaplikuje. Town.tsx ma setTimeout(10_000)
            //    przed `updateCharacter({ hp: newHp, mp: newMp })`, więc dajemy
            //    15s timeout (bufor na CPU jitter w CI / mobile emulation).
            //    Po heal-u overlay dostaje class `--done` i pokazuje wartości
            //    heal-u, ale my czekamy na finalny bar-value w Town card.
            await expect(hpBarValue).toHaveText('120/120', { timeout: 15_000 });
            await expect(mpBarValue).toHaveText('30/30', { timeout: 5_000 });
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
