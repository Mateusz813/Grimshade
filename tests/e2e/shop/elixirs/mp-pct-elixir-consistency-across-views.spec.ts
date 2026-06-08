/**
 * Atomic E2E — MP konsystencja across 3 widoków przy aktywnym eliksirze
 * +25% Max MP.
 *
 * Spec (BACKLOG.md punkt 3.10): "MP — wszystkie powyższe wzorce dla HP
 * (3.5-3.9) zaaplikowane dla MP". Ten test to MP analogue do 3.5
 * (`hp-pct-elixir-consistency-across-views.spec.ts`).
 *
 * Pragmatic scoping (per session brief 2026-05-25):
 * Sprawdzamy 3 reprezentatywne widoki które renderują efektywne max MP:
 *   1. Town `/` → MP `.town__bar-value` (Town.tsx linia 334)
 *      (helper `engineGetEffectiveChar` → `useBuffStore.hasBuff('mp_pct_25')`
 *      via `getElixirMpMul` w combatElixirs.ts linia 46)
 *   2. TopHeader pulse popover → `.top-header__pulse-popover-row--mp`
 *      (helper `getEffectiveChar` — same engine as Town)
 *   3. `/character-select` card → MP `.char-select__bar-value`
 *      (helper `getEffectiveMaxStats` → `getElixirMaxBonuses` czyta buffs
 *      z `peekCharacterStore(charId, 'buffs')` z localStorage)
 *
 * Każdy z tych helperów ma OSOBNĄ ścieżkę czytania buffów:
 *   • Town/TopHeader: runtime `useBuffStore.hasBuff('mp_pct_25')` → ×1.25
 *   • CharacterSelect: localStorage `peekCharacterStore` → iteruje
 *     `allBuffs`, gdy `effect === 'mp_pct_25'` → `mpPctMul *= 1.25`
 *
 * Test guard przeciw regresji typu "Town dostał nowy multiplier ale
 * CharacterSelect go nie ma" (analogicznie do 3.5).
 *
 * ## Setup
 *
 * - **Mage**, level 5, mp=80 (under-max, żeby UI musiał czytać konkretne
 *   wartości — nie `max/max` które by zamaskowało błąd renderowania).
 *   Mage base max_mp = 200 (CLASS_BASE_STATS w createCharacter.ts), więc
 *   z 25% buff effective = floor(200 × 1.25) = 250.
 * - **hp_regen=0, mp_regen=0** — KRYTYCZNE per CLAUDE.md TESTING; bez tego
 *   regen tickuje co sekundę → wartość `80` zmieni się na `81/82/...` zanim
 *   wszystkie 3 widoki zostaną sprawdzone → race condition na asercji.
 * - Buff `mp_pct_25` (pausable, BUFF_CONFIG w Inventory.tsx linia 2596):
 *   `effect: 'mp_pct_25'` → mnoży effective max MP × 1.25.
 * - Pausable buff nie tickuje out-of-combat — test cały siedzi w
 *   Town/CharacterSelect, więc buff jest stale active przez cały run.
 *
 * ## Visit order: Town FIRST, then back to CharacterSelect
 *
 * CharacterSelect's `getEffectiveMaxStats` czyta buffs/equipment z
 * `peekCharacterStore(charId, 'buffs')` ktore zaglada do
 * `localStorage['dungeon_rpg_save_char_<id>']`. Ten klucz jest pisany
 * dopiero przez `forceSaveCharacterData` (uruchamiany przez
 * `switchToCharacter` przy Wybierz). Bez warm-flow CharacterSelect
 * pokazuje raw `200` zamiast effective `250`. Dlatego flow:
 *   /character-select → Wybierz (warm localStorage przez switchToCharacter)
 *                     → / (Town - sprawdź Town + TopHeader popover)
 *                     → goto /character-select (re-renderuje karty z
 *                       warm localStorage → effective max MP)
 *
 * ## Expected math
 *
 * Mage base max_mp = 200 (z `CLASS_BASE_STATS` w createCharacter.ts).
 *   raw = 200 + 0 (no equip) + 0 (no training) + 0 (no flat elixir) + 0 (no transform)
 *       = 200
 *   eff = floor(200 × 1.25) = 250
 *
 * Wszystkie 3 widoki muszą pokazać `80/250` (MP under-max × max effective).
 *
 * Note on TopHeader popover formatting: TopHeader używa
 * `toLocaleString('pl-PL')` (linia 289). Dla wartości <1000 (80 i 250 są)
 * format jest identyczny z Town (`80/250`); thousand separator pojawia się
 * dopiero przy 1000+. Nasze wartości pozostają poniżej tego progu, więc
 * string-comparison jest bezpieczne.
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

    test('mp_pct_25 buff → CharacterSelect, Town, TopHeader popover show same effective max MP', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            // 1. Seed Mage z under-max MP + zero regen + buff mp_pct_25.
            //    Mage base max_mp=200 — wystarczająco duża baseline żeby
            //    25% multiplier dał jasną deltę (200 → 250).
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
                        // id matches BUFF_CONFIG[mp_pct_25_15m].id (Inventory.tsx linia 2596).
                        // Name/icon copy mirrors BUFF_CONFIG so any future BuffPopover
                        // assertion sees authentic data — but this test doesn't open
                        // the buff popover, only the HP/MP pulse popover.
                        id: 'mp_pct_25',
                        name: 'Max MP +25%',
                        icon: '💠',
                        effect: 'mp_pct_25',
                        // Defaults fill timerMode='pausable' + remainingMs=24h.
                    },
                ],
            });

            // 2. Login → /character-select.
            await loginViaUI(page, testUsers.primary);
            await page.goto('/character-select');
            await expect(page.locator('.char-select__card-name', { hasText: nick })).toBeVisible({ timeout: 10_000 });

            // 3. Tap "Wybierz" → Town. This call triggers `switchToCharacter`
            //    → `applyBlobToStores` (loads buff slice into runtime
            //    `useBuffStore`) → `forceSaveCharacterData` (writes blob
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

            // 4. Read MP value from Town bar (`.town__bar--mp`).
            //    Mage base max_mp=200, ×1.25 (mp_pct_25 multiplier) = 250.
            //    MP starts at 80 → expect `80/250`.
            const townMp = await page
                .locator('.town__bar-wrap', { has: page.locator('.town__bar--mp') })
                .locator('.town__bar-value')
                .textContent();
            expect(townMp?.trim()).toBe('80/250');

            // 5. Open TopHeader pulse popover, read MP from popover row.
            //    `.top-header__pulse` is the button (linia 263). Tap opens
            //    popover (`.top-header__pulse-popover`). MP value lives in
            //    `.top-header__pulse-popover-row--mp .top-header__pulse-popover-val`.
            //    Format: `liveMp.toLocaleString('pl-PL') + '/' + maxMp.toLocaleString('pl-PL')`.
            //    Under 1000, pl-PL toLocaleString does NOT insert separator → '80/250'.
            const pulseBtn = page.locator('.top-header__pulse').first();
            await expect(pulseBtn).toBeVisible({ timeout: 5_000 });
            await pulseBtn.tap();
            const popoverMp = await page
                .locator('.top-header__pulse-popover-row--mp .top-header__pulse-popover-val')
                .first()
                .textContent();
            expect(popoverMp?.trim()).toBe('80/250');

            // 6. Wróć do /character-select. Po warm-kroku (krok 3) localStorage
            //    ma świeży save z buffami. `getEffectiveMaxStats` w
            //    CharacterSelect.tsx czyta `peekCharacterStore(charId, 'buffs')`
            //    → znajduje `mp_pct_25` → `mpPctMul = 1.25` → effective max MP
            //    = floor(200 × 1.25) = 250.
            await page.goto('/character-select');
            await expect(page.locator('.char-select__card-name', { hasText: nick })).toBeVisible({ timeout: 10_000 });
            const reloadedCard = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            const selectMpText = await reloadedCard
                .locator('.char-select__bar-wrap', { has: page.locator('.char-select__bar--mp') })
                .locator('.char-select__bar-value')
                .textContent();
            expect(selectMpText?.trim()).toBe('80/250');

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
