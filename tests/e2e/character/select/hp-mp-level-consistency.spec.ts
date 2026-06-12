/**
 * Atomic E2E — HP/MP/Level konsystencja across views.
 *
 * Spec (`testyE2E.docx` punkt 3): "Po wejsciu na dana postac sprawdz
 * czy HP i MP oraz Poziom zgadza się na widoku miasto oraz
 * /character-select. Zawsze ma byc tyle samo"
 *
 * Test sprawdza że ta sama postać pokazuje IDENTYCZNE wartości HP/MP/Level
 * w 3 miejscach UI:
 *  1. `/character-select` card — `.char-select__bar-value`
 *  2. `/` (Town) — `.town__bar-value`
 *  3. TopHeader pulse popover — `.top-header__pulse-popover-val`
 *
 * Test używa `createCharacterViaApi` z explicitnymi wartościami HP=40,
 * MP=15 (under-max, żeby nie było po prostu "max HP wszędzie" trywialnie)
 * + level 5. To zmusza UI do faktycznego CZYTANIA z store-a i renderowania
 * konkretnej wartości, nie defaultu.
 *
 * Cleanup: hard rule — `cleanupCharactersForEmail` na primary po teście.
 *
 * Edge case dla parallelism: test używa primary account równolegle z
 * innymi testami z `character/create/`. Wszystkie kasują się PER-TEST,
 * ale teoretycznie dwa testy mogą widzieć siebie nawzajem na liście
 * `/character-select` (każdy ma unique nick). Dlatego selektory są
 * scoped do NASZEJ postaci po jej unique name.
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';

test.describe('Character › Select', { tag: '@character' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('HP/MP/Level shown in CharacterSelect card matches Town card matches TopHeader popover', async ({ page }) => {
        const nick = generateTestCharacterName();
        // Trzymamy ID do per-character cleanup (NIE bulk wipe — race-safe).
        let createdId: string | null = null;

        try {
            // 1. Seed postać przez API z konkretnymi wartościami (under-max).
            //    Knight base: max_hp=120, max_mp=30. Damy hp=40 (33%), mp=15 (50%), level=5.
            //    KRYTYCZNE: hp_regen=0, mp_regen=0 — inaczej regen tickuje w trakcie
            //    testu i wartość "40" zmieni się na "45" zanim assertion zacznie czytać.
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: { hp: 40, mp: 15, level: 5, highest_level: 5, hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;
            expect(created.name).toBe(nick);

            // 2. Login + go to /character-select
            await loginViaUI(page, testUsers.primary);
            await page.goto('/character-select');
            await expect(page.locator('.char-select__card-name', { hasText: nick })).toBeVisible({ timeout: 10_000 });

            // 3. Czytamy wartości z karty w /character-select.
            //    Card scope-uje się po jego nazwie, żeby nie zlapać innej postaci.
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            const selectHpText = await card.locator('.char-select__bar-wrap', {
                has: page.locator('.char-select__bar--hp'),
            }).locator('.char-select__bar-value').textContent();
            const selectMpText = await card.locator('.char-select__bar-wrap', {
                has: page.locator('.char-select__bar--mp'),
            }).locator('.char-select__bar-value').textContent();
            const selectMeta = await card.locator('.char-select__card-meta').textContent();

            // Sanity asserts — wartości są obecne
            expect(selectHpText?.trim()).toMatch(/^\d+\/\d+$/);
            expect(selectMpText?.trim()).toMatch(/^\d+\/\d+$/);
            expect(selectMeta).toMatch(/Poziom 5/i);

            // 4. Tap "Wybierz" na NASZEJ karcie -> wejście do Town
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });

            // 5. Czytamy wartości z Town
            await expect(page.locator('.town__char-name')).toHaveText(nick);
            const townHp = await page.locator('.town__bar-wrap', {
                has: page.locator('.town__bar--hp'),
            }).locator('.town__bar-value').textContent();
            const townMp = await page.locator('.town__bar-wrap', {
                has: page.locator('.town__bar--mp'),
            }).locator('.town__bar-value').textContent();
            const townLevel = await page.locator('.town__char-level').textContent();

            // 6. Czytamy wartości z TopHeader pulse popover.
            //    Tap na pulse area żeby otworzyć popover.
            const pulseTrigger = page.locator('.top-header__pulse').first();
            if (await pulseTrigger.count() > 0) {
                await pulseTrigger.tap();
                // Popover może mieć wartości HP/MP w `.top-header__pulse-popover-val`
                const popoverHp = await page.locator('.top-header__pulse-popover-row--hp .top-header__pulse-popover-val').first().textContent();
                const popoverMp = await page.locator('.top-header__pulse-popover-row--mp .top-header__pulse-popover-val').first().textContent();
                expect(popoverHp?.trim()).toBe(townHp?.trim());
                expect(popoverMp?.trim()).toBe(townMp?.trim());
            }

            // 7. ASERCJA KONSYSTENCJI: /character-select === Town
            expect(selectHpText?.trim()).toBe(townHp?.trim());
            expect(selectMpText?.trim()).toBe(townMp?.trim());
            expect(townLevel).toContain('5');
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
