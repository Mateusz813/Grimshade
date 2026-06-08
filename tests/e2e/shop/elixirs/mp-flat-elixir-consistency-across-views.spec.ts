/**
 * Atomic E2E — MP konsystencja across 3 widoków przy aktywnym eliksirze
 * +500 Max MP (flat).
 *
 * Spec (BACKLOG.md punkt 3.10): "MP — wszystkie powyższe wzorce dla HP".
 * Ten test to MP analogue do 3.6
 * (`hp-flat-elixir-consistency-across-views.spec.ts`).
 *
 * Parallel test to `mp-pct-elixir-consistency-across-views.spec.ts` —
 * verifies the SAME 3-view consistency for the FLAT (not %-based) MP
 * elixir variant. Flat elixir adds bonus before % multipliers in the
 * formula:
 *   raw = base + equip + training + flatElixir + flatTransform
 *   eff = floor(raw × pctElixir × pctTransform)
 *
 * Bez aktywnego pct elixiru / transform-u, eff = raw, więc dla flat-only:
 *   raw = 200 (Mage base) + 0 + 0 + 500 + 0 = 700
 *   eff = floor(700 × 1.0 × 1.0) = 700
 *
 * Wszystkie 3 widoki muszą pokazać `80/700`. Dwie różne drogi w kodzie:
 *  • CharacterSelect → `getEffectiveMaxStats` → `getElixirMaxBonuses`
 *    czyta buffs z localStorage (`peekCharacterStore(charId, 'buffs')`)
 *    i dodaje 500 do `mpFlat` gdy znajduje `effect === 'mp_boost_500'`.
 *  • Town + TopHeader → `engineGetEffectiveChar` → `getElixirMpBonus()`
 *    czyta `useBuffStore.hasBuff('mp_boost_500')` runtime.
 *
 * Te 2 ścieżki czytają z różnych miejsc (localStorage vs in-memory store)
 * ale wartość musi być spójna. Bez tego testu można cicho odlecieć
 * (np. dodajemy nowy effect ale zapominamy zarejestrować w jednej z dróg).
 *
 * Setup notes:
 *  • Mage base max_mp = 200 (CLASS_BASE_STATS z createCharacter.ts).
 *  • Buff `mp_boost_500` (pausable, BUFF_CONFIG w Inventory.tsx linia 2607):
 *    `effect: 'mp_boost_500'` → +500 flat.
 *  • Pausable timer nie ticka out-of-combat → buff stays active dla
 *    całego testu.
 *  • hp_regen / mp_regen = 0 — race-free assertions.
 *
 * ## Warm flow: Wybierz najpierw, potem assertion w CharacterSelect
 *
 * `getEffectiveMaxStats` w CharacterSelect.tsx czyta buffy z
 * `peekCharacterStore(charId, 'buffs')` które ZAGLĄDA do
 * `localStorage['dungeon_rpg_save_char_<id>']`. Świeży character (bez
 * prior switch) NIE ma tego klucza w localStorage; jest pisany dopiero
 * przez `forceSaveCharacterData` (uruchamiany przez `switchToCharacter`
 * przy tap-ie "Wybierz"). Dlatego test:
 *   1. Login → /character-select.
 *   2. Tap "Wybierz" → Town (warm localStorage przy okazji).
 *   3. Assert Town + TopHeader popover.
 *   4. goto /character-select → assert (teraz localStorage ma świeży buff).
 *
 * Cleanup: try/finally + `cleanupCharacterById(createdId)`.
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { seedGameSave, findUserIdByEmail } from '../../fixtures/seedGameSave';

test.describe('Shop › Elixirs', { tag: '@shop' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('mp_boost_500 buff → CharacterSelect, Town, TopHeader popover show same effective max MP', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            // 1. Seed Mage z under-max MP + zero regen + buff mp_boost_500.
            //    Mage base max_mp=200 — wystarczająco duża baseline + flat +500
            //    daje deltę widoczną w prostym diff (200 → 700).
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Mage',
                overrides: { hp: 50, mp: 80, level: 5, highest_level: 5, hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            const userId = await findUserIdByEmail(testUsers.primary.email);
            await seedGameSave({
                characterId: created.id,
                userId,
                buffs: [
                    {
                        // id matches BUFF_CONFIG[mp_boost_500_15m].id.
                        id: 'mp_boost_500',
                        name: '+500 Max MP',
                        icon: '🔷',
                        effect: 'mp_boost_500',
                        // Defaults: pausable + 24h remainingMs (won't drain out of combat).
                    },
                ],
            });

            // 2. Login → /character-select. Wymagany "warm" krok: pierwszy
            //    Wybierz triggera `switchToCharacter` → `forceSaveCharacterData`
            //    który pisze buff slice do localStorage. Bez tego
            //    `peekCharacterStore('buffs')` w CharacterSelect zwraca null
            //    (świeży klucz `dungeon_rpg_save_char_<id>` jeszcze nie
            //    istnieje na disku) → CharacterSelect pokazuje raw 200
            //    zamiast effective 700.
            await loginViaUI(page, testUsers.primary);
            await page.goto('/character-select');
            await expect(page.locator('.char-select__card-name', { hasText: nick })).toBeVisible({ timeout: 10_000 });

            // 3. Tap "Wybierz" → Town (warm localStorage).
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });
            await expect(page.locator('.town__char-name')).toHaveText(nick);

            // 4. Read MP value from Town bar.
            //    Mage base max_mp=200 + 500 (mp_boost_500) = 700.
            //    MP starts at 80 → expect `80/700`.
            const townMp = await page
                .locator('.town__bar-wrap', { has: page.locator('.town__bar--mp') })
                .locator('.town__bar-value')
                .textContent();
            expect(townMp?.trim()).toBe('80/700');

            // 5. Open TopHeader pulse popover, read MP from popover row.
            //    Format: `liveMp.toLocaleString('pl-PL') + '/' + maxMp.toLocaleString('pl-PL')`.
            //    pl-PL inserts non-breaking space at 1000+ thousands. 700 < 1000 →
            //    no separator → '80/700'.
            const pulseBtn = page.locator('.top-header__pulse').first();
            await expect(pulseBtn).toBeVisible({ timeout: 5_000 });
            await pulseBtn.tap();
            const popoverMp = await page
                .locator('.top-header__pulse-popover-row--mp .top-header__pulse-popover-val')
                .first()
                .textContent();
            expect(popoverMp?.trim()).toBe('80/700');

            // 6. Wróć do /character-select. Po warm-kroku (krok 3) localStorage
            //    ma świeży save z buffami. `getEffectiveMaxStats` w
            //    CharacterSelect.tsx czyta `peekCharacterStore(charId, 'buffs')`
            //    → znajduje `mp_boost_500` → `mpFlat = 500` → effective max MP
            //    = floor((200 + 500) × 1.0) = 700.
            await page.goto('/character-select');
            await expect(page.locator('.char-select__card-name', { hasText: nick })).toBeVisible({ timeout: 10_000 });
            const reloadedCard = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            const selectMpText = await reloadedCard
                .locator('.char-select__bar-wrap', { has: page.locator('.char-select__bar--mp') })
                .locator('.char-select__bar-value')
                .textContent();
            expect(selectMpText?.trim()).toBe('80/700');

            // 7. KRYTYCZNA ASERCJA: wszystkie 3 widoki ten sam string.
            expect(townMp?.trim()).toBe(popoverMp?.trim());
            expect(popoverMp?.trim()).toBe(selectMpText?.trim());
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
