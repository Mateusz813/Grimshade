/**
 * Atomic E2E — toggle języka (PL <-> EN) w AvatarMenu zmienia stan
 * `useSettingsStore.language` + active class na odpowiednim
 * przycisku.
 *
 * Spec (BACKLOG 15.5): "Theme/language switch (PL <-> EN) — AvatarMenu
 * has language toggle. Switch + verify UI text changes (...) if no EN
 * translations, just verify state changes".
 *
 * AvatarMenu.tsx linie 175-194 — dwa przyciski PL/EN, klasa
 * `avatar-menu__lang-btn--active` flagi aktualnie wybranego.
 * `setLanguage('en')` -> `useSettingsStore.setState({ language: 'en' })`
 * + równolegle `i18n.changeLanguage('en')` (settingsStore.ts linia 180).
 *
 * STAN APP (2026-05-25): w `src/components/**.tsx` NIE MA użyć
 * `useTranslation` — translation JSON (pl.json + en.json) istnieją,
 * ale UI nadal hard-coduje polskie napisy. Czyli "Wyloguj" zostaje
 * "Wyloguj" niezależnie od language toggle. To NIE jest bug który
 * test powinien łapać — test pokrywa SAM toggle (state + active class),
 * nie weryfikuje UI re-render po zmianie. Gdy kiedyś app dostanie
 * `useTranslation` integration, dorzucimy text assertion w osobnym
 * teście (np. `chrome/avatar-menu/language-switch-rerenders-ui.spec.ts`).
 *
 * Setup:
 *   1. Seed character przez API — TopHeader renderuje się TYLKO gdy
 *      `character !== null` (TopHeader.tsx linia 188: `if (!character)
 *      return null`). Bez postaci nie ma avatar button-a -> nie ma jak
 *      otworzyć AvatarMenu.
 *   2. Login UI + wybór seedowanej postaci -> Town (`/`).
 *   3. Open AvatarMenu (tap avatar button `aria-label="Menu postaci"`).
 *
 * Actions + outcomes (atomic — dwa kroki bo PL -> EN -> PL pokazuje że
 * toggle jest bidirectional, nie sticky-to-EN):
 *   A. Domyślnie active = PL (settingsStore default). Asercja initial state.
 *   B. Tap EN -> EN button dostaje class `--active`, PL ją traci.
 *   C. Tap PL -> odwrotnie, wracamy do initial state.
 *
 * Cleanup: `cleanupCharacterById(createdId)` w finally per CLAUDE.md
 * TESTING hard rule.
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';

test.describe('Chrome › Language', { tag: '@chrome' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('language toggle in AvatarMenu switches active state PL <-> EN', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            // 1. Seed postaci żeby TopHeader się wyrenderował.
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: { hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            // 2. Login + wybór NASZEJ postaci -> Town.
            await loginViaUI(page, testUsers.primary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 10_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });

            // 3. Open AvatarMenu — avatar button w TopHeader.
            //    `aria-label="Menu postaci"` (TopHeader.tsx linia 235).
            const avatarBtn = page.getByRole('button', { name: /menu postaci/i });
            await expect(avatarBtn).toBeVisible({ timeout: 10_000 });
            await avatarBtn.tap();

            // 4. Język toggle — exact text "PL" / "EN" w `.avatar-menu__lang-btn`.
            //    Filter po tekście dokładnym (`{ exact: true }` w hasText) bo
            //    "EN" mogłoby przypadkiem matchować "ENG" lub fragment innych
            //    napisów; tutaj to nie ryzyko ale konwencja safe-by-default.
            //    Pierwszy `.avatar-menu__lang-toggle` w DOM = język (porządek
            //    w AvatarMenu.tsx: język toggle PRZED tryb gry toggle).
            const languageToggle = page.locator('.avatar-menu__lang-toggle').first();
            const plBtn = languageToggle.locator('.avatar-menu__lang-btn', { hasText: /^PL$/ });
            const enBtn = languageToggle.locator('.avatar-menu__lang-btn', { hasText: /^EN$/ });
            await expect(plBtn).toBeVisible({ timeout: 5_000 });
            await expect(enBtn).toBeVisible();

            // 5A. Initial state — settingsStore default `language: 'pl'` ->
            //     PL button ma `--active`, EN nie.
            await expect(plBtn).toHaveClass(/avatar-menu__lang-btn--active/);
            await expect(enBtn).not.toHaveClass(/avatar-menu__lang-btn--active/);

            // 5B. Tap EN — active flippa się na EN, znika z PL.
            await enBtn.tap();
            await expect(enBtn).toHaveClass(/avatar-menu__lang-btn--active/);
            await expect(plBtn).not.toHaveClass(/avatar-menu__lang-btn--active/);

            // 5C. Tap PL — z powrotem do initial state (toggle jest
            //     bidirectional, nie sticky-to-EN).
            await plBtn.tap();
            await expect(plBtn).toHaveClass(/avatar-menu__lang-btn--active/);
            await expect(enBtn).not.toHaveClass(/avatar-menu__lang-btn--active/);
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
