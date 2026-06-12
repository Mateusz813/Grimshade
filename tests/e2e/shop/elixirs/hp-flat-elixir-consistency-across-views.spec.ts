/**
 * Atomic E2E — HP konsystencja across 3 widoków przy aktywnym eliksirze
 * +500 Max HP (flat).
 *
 * Spec (BACKLOG.md punkt 3.6): "Eliksir +500 HP — to samo"
 *
 * Parallel test to `hp-pct-elixir-consistency-across-views.spec.ts` —
 * verifies the SAME 3-view consistency for the FLAT (not %-based)
 * elixir variant. Flat elixir adds bonus before % multipliers in the
 * formula:
 *   raw = base + equip + training + flatElixir + flatTransform
 *   eff = floor(raw × pctElixir × pctTransform)
 *
 * Bez aktywnego pct elixiru / transform-u, eff = raw, więc dla flat-only:
 *   raw = 120 (Knight base) + 0 + 0 + 500 + 0 = 620
 *   eff = floor(620 × 1.0 × 1.0) = 620
 *
 * Wszystkie 3 widoki muszą pokazać `40/620`. Dwie różne drogi w kodzie:
 *  - CharacterSelect -> `getEffectiveMaxStats` -> `getElixirMaxBonuses`
 *    czyta buffs z localStorage (`peekCharacterStore(charId, 'buffs')`)
 *    i dodaje 500 do `hpFlat` gdy znajduje `effect === 'hp_boost_500'`.
 *  - Town + TopHeader -> `engineGetEffectiveChar` -> `getElixirHpBonus()`
 *    czyta `useBuffStore.hasBuff('hp_boost_500')` runtime.
 *
 * Te 2 ścieżki czytają z różnych miejsc (localStorage vs in-memory store)
 * ale wartość musi być spójna. Bez tego testu można cicho odlecieć
 * (np. dodajemy nowy effect ale zapominamy zarejestrować w jednej z dróg).
 *
 * Setup notes:
 *  - Knight base max_hp = 120 (CLASS_BASE_STATS z createCharacter.ts).
 *  - Buff `hp_boost_500` (pausable, BUFF_CONFIG w Inventory.tsx ~2606):
 *    `effect: 'hp_boost_500'` -> +500 flat.
 *  - Pausable timer nie ticka out-of-combat -> buff stays active dla
 *    całego testu.
 *  - hp_regen / mp_regen = 0 — race-free assertions.
 *
 * ## Warm flow: Wybierz najpierw, potem assertion w CharacterSelect
 *
 * `getEffectiveMaxStats` w CharacterSelect.tsx czyta buffy z
 * `peekCharacterStore(charId, 'buffs')` które ZAGLĄDA do
 * `localStorage['dungeon_rpg_save_char_<id>']`. Świeży character (bez
 * prior switch) NIE ma tego klucza w localStorage; jest pisany dopiero
 * przez `forceSaveCharacterData` (uruchamiany przez `switchToCharacter`
 * przy tap-ie "Wybierz"). Dlatego test:
 *   1. Login -> /character-select.
 *   2. Tap "Wybierz" -> Town (warm localStorage przy okazji).
 *   3. Assert Town + TopHeader popover.
 *   4. goto /character-select -> assert (teraz localStorage ma świeży buff).
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

    test('hp_boost_500 buff -> CharacterSelect, Town, TopHeader popover show same effective max HP', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            // 1. Seed Knight z under-max HP + zero regen + buff hp_boost_500.
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: { hp: 40, mp: 15, level: 5, highest_level: 5, hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            const userId = await findUserIdByEmail(testUsers.primary.email);
            await seedGameSave({
                characterId: created.id,
                userId,
                buffs: [
                    {
                        // id matches BUFF_CONFIG[hp_boost_500_15m].id.
                        id: 'hp_boost_500',
                        name: '+500 Max HP',
                        icon: 'drop-of-blood',
                        effect: 'hp_boost_500',
                        // Defaults: pausable + 24h remainingMs (won't drain out of combat).
                    },
                ],
            });

            // 2. Login -> /character-select. Wymagany "warm" krok: pierwszy
            //    Wybierz triggera `switchToCharacter` -> `forceSaveCharacterData`
            //    który pisze buff slice do localStorage. Bez tego
            //    `peekCharacterStore('buffs')` w CharacterSelect zwraca null
            //    (świeży klucz `dungeon_rpg_save_char_<id>` jeszcze nie
            //    istnieje na disku) -> CharacterSelect pokazuje raw 120
            //    zamiast effective 620.
            await loginViaUI(page, testUsers.primary);
            await page.goto('/character-select');
            await expect(page.locator('.char-select__card-name', { hasText: nick })).toBeVisible({ timeout: 10_000 });

            // 3. Tap "Wybierz" -> Town (warm localStorage).
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });
            await expect(page.locator('.town__char-name')).toHaveText(nick);

            // 4. Read HP value from Town bar.
            //    Knight base max_hp=120 + 500 (hp_boost_500) = 620.
            //    HP starts at 40 -> expect `40/620`.
            const townHp = await page
                .locator('.town__bar-wrap', { has: page.locator('.town__bar--hp') })
                .locator('.town__bar-value')
                .textContent();
            expect(townHp?.trim()).toBe('40/620');

            // 5. Open TopHeader pulse popover, read HP from popover row.
            //    Format: `liveHp.toLocaleString('pl-PL') + '/' + maxHp.toLocaleString('pl-PL')`.
            //    pl-PL inserts non-breaking space at 1000+ thousands. 620 < 1000 ->
            //    no separator -> '40/620'.
            const pulseBtn = page.locator('.top-header__pulse').first();
            await expect(pulseBtn).toBeVisible({ timeout: 5_000 });
            await pulseBtn.tap();
            const popoverHp = await page
                .locator('.top-header__pulse-popover-row--hp .top-header__pulse-popover-val')
                .first()
                .textContent();
            expect(popoverHp?.trim()).toBe('40/620');

            // 6. Wróć do /character-select. Po warm-kroku (krok 3) localStorage
            //    ma świeży save z buffami. `getEffectiveMaxStats` w
            //    CharacterSelect.tsx czyta `peekCharacterStore(charId, 'buffs')`
            //    -> znajduje `hp_boost_500` -> `hpFlat = 500` -> effective max HP
            //    = floor((120 + 500) × 1.0) = 620.
            await page.goto('/character-select');
            await expect(page.locator('.char-select__card-name', { hasText: nick })).toBeVisible({ timeout: 10_000 });
            const reloadedCard = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            const selectHpText = await reloadedCard
                .locator('.char-select__bar-wrap', { has: page.locator('.char-select__bar--hp') })
                .locator('.char-select__bar-value')
                .textContent();
            expect(selectHpText?.trim()).toBe('40/620');

            // 7. KRYTYCZNA ASERCJA: wszystkie 3 widoki ten sam string.
            expect(townHp?.trim()).toBe(popoverHp?.trim());
            expect(popoverHp?.trim()).toBe(selectHpText?.trim());
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
