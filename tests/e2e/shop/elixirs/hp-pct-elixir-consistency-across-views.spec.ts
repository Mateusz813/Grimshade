/**
 * Atomic E2E — HP konsystencja across 3 widoków przy aktywnym eliksirze
 * +25% Max HP.
 *
 * Spec (BACKLOG.md punkt 3.5): "Eliksir +25% HP -> HP identyczne na: Town
 * + TopHeader + CharacterSelect + każda walka (polowanie/raid/dungeon/
 * boss/arena/trainer/loch/transform) + party + gildia"
 *
 * Pragmatic scoping (per session brief 2026-05-25):
 * Sprawdzamy 3 reprezentatywne widoki które renderują efektywne max HP:
 *   1. Town `/` -> `.town__bar-value`
 *      (helper `engineGetEffectiveChar` -> `useBuffStore.hasBuff`)
 *   2. TopHeader pulse popover -> `.top-header__pulse-popover-row--hp`
 *      (helper `getEffectiveChar` — same engine as Town)
 *   3. `/character-select` card -> `.char-select__bar-value`
 *      (helper `getEffectiveMaxStats` — czyta buffs przez
 *      `peekCharacterStore(charId, 'buffs')` z localStorage)
 *
 * Każdy z tych helperów ma OSOBNĄ ścieżkę czytania buffów (one z
 * localStorage przez `peekCharacterStore`, drugie z runtime `useBuffStore`).
 * Test guard przeciw regresji typu "Town dostał nowy multiplier ale
 * CharacterSelect go nie ma" (lub odwrotnie).
 *
 * Pozostałe widoki w spec-u (combat / party / gildia) wymagają flow
 * combat / multi-context -> osobne testy w kolejnych sesjach.
 *
 * ## Setup
 *
 * - Knight, level 5, hp=40, mp=15 (under-max — żeby UI musiał czytać
 *   konkretne wartości, nie pokazywało tylko `max/max`).
 * - **hp_regen=0, mp_regen=0** — KRYTYCZNE per CLAUDE.md TESTING; bez tego
 *   regen tickuje co sekundę -> wartość `40` zmieni się na `41/42/...` zanim
 *   wszystkie 3 widoki zostaną sprawdzone -> race condition na asercji.
 * - Buff `hp_pct_25` (pausable, BUFF_CONFIG w Inventory.tsx linia 2595):
 *   `effect: 'hp_pct_25'` -> mnoży effective max HP × 1.25.
 * - Pausable buff nie tickuje out-of-combat — test cały siedzi w
 *   Town/CharacterSelect, więc buff jest stale active przez cały run.
 *
 * ## Visit order: Town FIRST, then back to CharacterSelect
 *
 * CharacterSelect's `getEffectiveMaxStats` czyta buffs/equipment z
 * `peekCharacterStore(charId, 'buffs')` ktore zaglada do
 * `localStorage['dungeon_rpg_save_char_<id>']`. Ten klucz jest pisany
 * dopiero przez `forceSaveCharacterData` (uruchamiany przez
 * `switchToCharacter` przy Wybierz). Brand-new character na świeżej
 * sesji NIE ma jeszcze tego klucza w localStorage -> buffs default puste
 * -> CharacterSelect pokazuje raw `120` zamiast effective `150`.
 *
 * Dlatego flow testu jest:
 *   /character-select -> Wybierz (warm localStorage przez switchToCharacter)
 *                     -> / (Town - sprawdź Town + TopHeader popover)
 *                     -> goto /character-select (re-renderuje karty z
 *                       warm localStorage -> effective max HP)
 *
 * Bez "warmup" testowanie konsystencji jest niemożliwe bez modyfikacji
 * `getEffectiveMaxStats` żeby fetchowało buffs z innego źródła — co
 * wykracza poza scope tego testu (potencjalny TODO w spec-u).
 *
 * ## Expected math
 *
 * Knight base max_hp = 120 (z `CLASS_BASE_STATS` w createCharacter.ts).
 *   raw = 120 + 0 (no equip) + 0 (no training) + 0 (no flat elixir) + 0 (no transform)
 *       = 120
 *   eff = floor(120 × 1.25) = 150
 *
 * Wszystkie 3 widoki muszą pokazać `40/150` (HP under-max × max effective).
 *
 * Note on TopHeader popover formatting: TopHeader używa
 * `toLocaleString('pl-PL')` (linia 282-289). Dla wartości <1000
 * (40 i 150 są) format jest identyczny z Town (`40/150`); thousand
 * separator pojawia się dopiero przy 1000+. Nasze wartości pozostają
 * poniżej tego progu, więc string-comparison jest bezpieczne.
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

    test('hp_pct_25 buff -> CharacterSelect, Town, TopHeader popover show same effective max HP', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            // 1. Seed Knight z under-max HP + zero regen + buff hp_pct_25.
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
                        // id matches BUFF_CONFIG[hp_pct_25_15m].id (Inventory.tsx ~2595).
                        // Name/icon copy mirrors BUFF_CONFIG so any future BuffPopover
                        // assertion sees authentic data — but this test doesn't open
                        // the buff popover, only the HP/MP pulse popover.
                        id: 'hp_pct_25',
                        name: 'Max HP +25%',
                        icon: 'heart-on-fire',
                        effect: 'hp_pct_25',
                        // Defaults fill timerMode='pausable' + remainingMs=24h.
                    },
                ],
            });

            // 2. Login -> /character-select.
            await loginViaUI(page, testUsers.primary);
            await page.goto('/character-select');
            await expect(page.locator('.char-select__card-name', { hasText: nick })).toBeVisible({ timeout: 10_000 });

            // 3. Tap "Wybierz" -> Town. This call triggers `switchToCharacter`
            //    -> `applyBlobToStores` (loads buff slice into runtime
            //    `useBuffStore`) -> `forceSaveCharacterData` (writes blob
            //    do localStorage `dungeon_rpg_save_char_<id>`). Ten warm
            //    krok jest WYMAGANY żeby kolejny `goto('/character-select')`
            //    poniżej widział buffs w `peekCharacterStore` (czyta
            //    localStorage).
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });
            await expect(page.locator('.town__char-name')).toHaveText(nick);

            // 4. Read HP value from Town bar.
            //    Knight base max_hp=120, ×1.25 (hp_pct_25 multiplier) = 150.
            //    HP starts at 40 -> expect `40/150`.
            const townHp = await page
                .locator('.town__bar-wrap', { has: page.locator('.town__bar--hp') })
                .locator('.town__bar-value')
                .textContent();
            expect(townHp?.trim()).toBe('40/150');

            // 5. Open TopHeader pulse popover, read HP from popover row.
            //    `.top-header__pulse` is the button (line 263). Tap opens
            //    popover (`.top-header__pulse-popover`). HP value lives in
            //    `.top-header__pulse-popover-row--hp .top-header__pulse-popover-val`.
            //    Format: `liveHp.toLocaleString('pl-PL') + '/' + maxHp.toLocaleString('pl-PL')`.
            //    Under 1000, pl-PL toLocaleString does NOT insert separator -> '40/150'.
            const pulseBtn = page.locator('.top-header__pulse').first();
            await expect(pulseBtn).toBeVisible({ timeout: 5_000 });
            await pulseBtn.tap();
            const popoverHp = await page
                .locator('.top-header__pulse-popover-row--hp .top-header__pulse-popover-val')
                .first()
                .textContent();
            expect(popoverHp?.trim()).toBe('40/150');

            // 6. Wróć do /character-select. Po warm-kroku (krok 3) localStorage
            //    ma świeży save z buffami. `getEffectiveMaxStats` w
            //    CharacterSelect.tsx czyta `peekCharacterStore(charId, 'buffs')`
            //    -> znajduje `hp_pct_25` -> `hpPctMul = 1.25` -> effective max HP
            //    = floor(120 × 1.25) = 150.
            await page.goto('/character-select');
            await expect(page.locator('.char-select__card-name', { hasText: nick })).toBeVisible({ timeout: 10_000 });
            const reloadedCard = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            const selectHpText = await reloadedCard
                .locator('.char-select__bar-wrap', { has: page.locator('.char-select__bar--hp') })
                .locator('.char-select__bar-value')
                .textContent();
            expect(selectHpText?.trim()).toBe('40/150');

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
