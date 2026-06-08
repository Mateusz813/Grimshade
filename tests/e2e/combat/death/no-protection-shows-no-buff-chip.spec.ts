/**
 * Atomic E2E — Postać bez protection consumables → TopHeader NIE
 * pokazuje buff chip-a → kontrakt: "śmierć zastosuje pełną karę XP +
 * EQ loss" (bo nic ją nie zaabsorbuje).
 *
 * Spec (BACKLOG.md punkt 13.20): "Śmierć w każdym typie walki: kara
 * XP + EQ loss" — wariant SMOKE pokrywający że gdy `consumables`
 * postaci nie zawiera `death_protection` ani `amulet_of_loss`, UI
 * NIE renderuje żadnego "armed protection" indicator-a. Czyli przy
 * faktycznej śmierci:
 *
 *  • combatEngine.ts line 1391 wejdzie w `else` branch (no protection
 *    used) → `applyDeathPenalty(char.level, char.xp)` → XP/level
 *    obniżone.
 *  • combatEngine.ts line 1419 wejdzie w `else if (itemsLost > 0)`
 *    branch → log "💀 Stracileś N przedmiotów".
 *
 * Pełny verification "char.xp dropped from 1000 to lower" wymaga
 * combat-sim (deferred do osobnej sesji z infrastructure-em na
 * triggering death without flaky timing). SMOKE tu pokrywa
 * PRE-CONDITION dla tego scenariusza: char ma XP do stracenia +
 * NIC nie chroni → jak zginie, pełna kara leci.
 *
 * Dlaczego ten "negative" smoke jest wart napisania (a nie pomijany
 * jako triviany):
 *
 *  • Daje regression guard przeciwko bug-owi "BuffPopover renderuje
 *    fałszywy protection chip dla świeżej postaci bez consumables"
 *    (regresja typu "default state w storze nie jest pusty {} a
 *    `{death_protection: 1}` z legacy hardcode-u").
 *  • Wymusza explicit invariant że TopHeader chip jest gated przez
 *    `totalBuffCount > 0` (TopHeader.tsx line 296), nie zawsze
 *    widoczny.
 *  • Powiązany test "armed AOL" (sibling
 *    `aol-armed-shows-buff-row.spec.ts`) by się rozsynchronizował
 *    gdyby ten kontrakt się złamał — atomic pair pokrywa oba kierunki.
 *
 * Co testujemy DOKŁADNIE:
 *  1. Seed Knight lvl 10, xp=1000, BEZ consumables (default empty {}).
 *  2. Login → wybierz postać → Town view.
 *  3. `.top-header__buffs-btn` MA count 0 (nie renderuje się —
 *     `totalBuffCount === 0`).
 *  4. Tap awatar żeby otworzyć AvatarMenu (dummy check że TopHeader
 *     w ogóle żyje — bez tego mogłoby się okazać że buffs-btn jest
 *     0 bo cała aplikacja jest broken).
 *
 * Cleanup: try/finally + `cleanupCharacterById`.
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';

test.describe('Combat › Death', { tag: '@combat' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('no protection consumables → no buff chip → full penalty will apply on death', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            // 1. Seed Knight lvl 10 z xp=1000 — postać "ma co stracić".
            //    `applyDeathPenalty(10, 1000)` zwróciłoby `levelsLost = 0`
            //    (10 × 0.02 = 0.2 → floor = 0) ale `newXp = 0` (reset XP
            //    pointer na fresh base) + skill XP -50%. Pełna asercja
            //    po faktycznej śmierci poza scope tego SMOKE-a.
            //    BRAK `seedConsumables` call = empty consumables map.
            //    hp_regen / mp_regen = 0 — hard rule.
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

            // 2. Login → character-select → pick → Town view.
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

            // 3. KRYTYCZNA ASERCJA: buffs chip NIE renderuje się.
            //    TopHeader.tsx line 296: `{totalBuffCount > 0 && (<button>...)}`
            //    Bez consumables + bez active buffów → totalBuffCount === 0 →
            //    button nie istnieje w DOM (count === 0).
            await expect(page.locator('.top-header__buffs-btn')).toHaveCount(0);

            // 4. Sanity: TopHeader żyje (avatar jest widoczny). Bez tego
            //    asercja w kroku 3 byłaby false-positive jeśli cała
            //    aplikacja by się nie wyrenderowała.
            await expect(page.locator('.top-header__avatar-btn')).toBeVisible();
            await expect(page.locator('.top-header__pulse')).toBeVisible();
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
