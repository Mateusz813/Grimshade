/**
 * Atomic E2E — HP konsystencja across 3 widoków po rozdaniu stat_points
 * na atrybut HP (efektywnie +50 do max_hp).
 *
 * Spec (BACKLOG.md punkt 3.9): "Atrybuty +HP — to samo" (analogicznie do
 * 3.5/3.6/6.12/6.13 — sprawdzenie czy efektywne max HP renderuje się
 * spójnie na wszystkich widokach po zmianie atrybutów postaci).
 *
 * **Skąd +50 HP**: każdy `stat_points` rozdany na `max_hp` w app dodaje
 * +5 do max_hp (patrz `STAT_POINT_BONUSES.max_hp = 5` w
 * `src/stores/characterStore.ts` linia 84). 10 punktów × 5 = +50.
 *
 * **Adaptation vs spec**: spec opisuje "atrybuty +HP" jako klikanie w
 * Postać tab tile `❤️ +5 HP` (Inventory.tsx ~3424). Ten test SYMULUJE
 * post-spend state przez override `max_hp` w `characters` row (przez
 * `createCharacterViaApi.overrides.max_hp`) zamiast realnego flow klikania.
 * Powod: spend logic jest unit-testowalna (`spendStatPoint`/`spendAllStatPoints`
 * w characterStore.ts) — E2E sens to weryfikacja że
 * `characters.max_hp` po-spend propaguje spójnie do każdego renderera.
 * Realne UI flow click → spend testowane będzie w osobnym pliku
 * `inventory/stats/spend-stat-point-on-hp.spec.ts` (TODO, wymaga
 * widoczności tile-i tylko gdy stat_points > 0).
 *
 * Pragmatic scoping (mirrors 6.12 pattern):
 * Sprawdzamy 3 reprezentatywne widoki które renderują efektywne max HP:
 *   1. Town `/` → `.town__bar-value`
 *      (helper `engineGetEffectiveChar` → czyta `character.max_hp` z
 *      characterStore + ewentualne bonusy z equip/training/elixir/transform)
 *   2. TopHeader pulse popover → `.top-header__pulse-popover-row--hp`
 *      (helper `getEffectiveChar` — same engine as Town)
 *   3. `/character-select` card → `.char-select__bar-value`
 *      (helper `getEffectiveMaxStats` — czyta `char.max_hp` z `characters`
 *      row + bonusy z `peekCharacterStore`)
 *
 * Każdy helper bierze `character.max_hp` jako BASE i dorzuca bonusy.
 * Bez equip/elixir/transform raw = max_hp = effective. Test gwarantuje
 * że gdy app refaktoruje którąkolwiek z tych ścieżek czytania `max_hp`
 * (np. ktoś dodaje cache layer w CharacterSelect ale zapomina o Town),
 * regresja jest złapana.
 *
 * ## Setup
 *
 * - Knight, level 11, hp=40 (under-max), mp=15, hp_regen=0, mp_regen=0.
 * - **max_hp=170** (Knight base 120 + 50 z rozdanych 10 punktów na HP).
 * - **stat_points=0** (już rozdane — żeby UI Postać tab nie pokazywał
 *   tile-ów do rozdania, co mogłoby zaciemnić co testujemy).
 * - Brak equip / brak buffów / brak transformu → bonusy = 0, więc
 *   effective max HP = raw max_hp = 170.
 *
 * Level 11 zamiast 1 bo na lvl 1 character ma 0 stat_points możliwych do
 * rozdania historycznie (system daje punkty per level), więc spent state
 * z max_hp=170 mógłby wyglądać dziwnie. Lvl 11 sugeruje "był poziom-up,
 * stat-points spent, teraz mamy rezultat".
 *
 * ## Expected math
 *
 * Knight `characters.max_hp = 170` (z override).
 *   eqHp = 0 (no equip)
 *   trainingHp = 0 (no skill train)
 *   elixirFlat = 0 (no flat elixir)
 *   transformFlat = 0 (no transform)
 *   elixirPctMul = 1.0 (no % elixir)
 *   transformPctMul = 1.0 (no transform mult)
 *
 *   raw = 170 + 0 + 0 + 0 + 0 = 170
 *   eff = floor(170 × 1.0 × 1.0) = 170
 *
 * Wszystkie 3 widoki muszą pokazać `40/170`.
 *
 * ## Warm flow
 *
 * Jak w testach 3.5/3.6/6.12/6.13: CharacterSelect.tsx `getEffectiveMaxStats`
 * czyta `char.max_hp` ze świeżego DB fetch (`characterApi.getCharacters`)
 * + peeked stores z localStorage. Brak warm-up nie jest potrzebny dla
 * SAMEGO `max_hp` (idzie direct z DB), ale dla SPÓJNOŚCI test-flow z
 * pozostałymi consistency tests używamy tego samego pattern-u: Wybierz →
 * Town (warm) → /character-select.
 *
 * Cleanup: try/finally + `cleanupCharacterById(createdId)`.
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';

test.describe('Inventory › Stats', { tag: '@inventory' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('HP attribute (max_hp 170 from spent stat points) → Town, TopHeader popover, CharacterSelect all show same effective max HP', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            // 1. Seed Knight z max_hp=170 (Knight base 120 + 50 z rozdanych
            //    10 punktów stat_points × +5 HP per point). HP under-max
            //    (40) + zero regen + już rozdane stat_points (0).
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: {
                    level: 11,
                    highest_level: 11,
                    hp: 40,
                    mp: 15,
                    max_hp: 170,
                    stat_points: 0,
                    hp_regen: 0,
                    mp_regen: 0,
                },
            });
            createdId = created.id;

            // 2. Login → /character-select.
            await loginViaUI(page, testUsers.primary);
            await page.goto('/character-select');
            await expect(page.locator('.char-select__card-name', { hasText: nick })).toBeVisible({ timeout: 10_000 });

            // 3. Tap "Wybierz" → Town (warm-flow per 6.12 pattern, choć dla
            //    samego max_hp z DB nie jest wymagany).
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });
            await expect(page.locator('.town__char-name')).toHaveText(nick);

            // 4. Read HP value from Town bar.
            //    Knight max_hp=170 (override) + 0 bonusy = effective 170.
            //    HP starts at 40 → expect `40/170`.
            const townHp = await page
                .locator('.town__bar-wrap', { has: page.locator('.town__bar--hp') })
                .locator('.town__bar-value')
                .textContent();
            expect(townHp?.trim()).toBe('40/170');

            // 5. Open TopHeader pulse popover, read HP from popover row.
            const pulseBtn = page.locator('.top-header__pulse').first();
            await expect(pulseBtn).toBeVisible({ timeout: 5_000 });
            await pulseBtn.tap();
            const popoverHp = await page
                .locator('.top-header__pulse-popover-row--hp .top-header__pulse-popover-val')
                .first()
                .textContent();
            expect(popoverHp?.trim()).toBe('40/170');

            // 6. Wróć do /character-select. `getEffectiveMaxStats` czyta
            //    świeży `char.max_hp` z DB (`characterApi.getCharacters` na
            //    mount). Bonusy z localStorage = 0 (brak equip/buff/transform),
            //    więc effective = max_hp = 170.
            await page.goto('/character-select');
            await expect(page.locator('.char-select__card-name', { hasText: nick })).toBeVisible({ timeout: 10_000 });
            const reloadedCard = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            const selectHpText = await reloadedCard
                .locator('.char-select__bar-wrap', { has: page.locator('.char-select__bar--hp') })
                .locator('.char-select__bar-value')
                .textContent();
            expect(selectHpText?.trim()).toBe('40/170');

            // 7. KRYTYCZNA ASERCJA: wszystkie 3 widoki ten sam string.
            //    Gwarantuje że post-spend `characters.max_hp` propaguje spójnie
            //    do każdej ścieżki renderowania efektywnego max HP.
            expect(townHp?.trim()).toBe(popoverHp?.trim());
            expect(popoverHp?.trim()).toBe(selectHpText?.trim());
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
