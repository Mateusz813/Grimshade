/**
 * Atomic E2E — Stats popup agreguje WSZYSTKIE źródła Max HP w jednym
 * widoku: base + equipped item + skill train + active buff (elixir).
 *
 * Spec (BACKLOG.md punkt 8.1 — full): "Stats popup agreguje: EQ + transform
 * + upgrade + eliksir + skill train + buffs". Ten test rozszerza istniejący
 * 8.1 partial (`popup-aggregates-equipped-item.spec.ts` — pokrywa SAM EQ
 * source dla `Atak`) o agregację 4 źródeł Max HP jednocześnie.
 *
 * **Z 6 źródeł w spec-u pokrywamy 4** (base + EQ + skill train + buff/elixir).
 * Pozostałe 2 (transform + upgrade) wymagają osobnych setupów:
 *  • Transform — wymagałby `seedTransformProgress` helper-a + `completedTransforms`
 *    slice (nie ma jeszcze w fixtures). Transform bonusy mają osobny path
 *    przez `getLiveTransformBreakdown` → odsetkowy multiplier (np. tier 1
 *    Knight = +5% HP). Bez seedu transformu wartość jest 0 → łatwa do
 *    odfiltrowania jako "0 contribution → skip" w `buildLines`.
 *  • Upgrade — wymagałby seed item z upgradeLevel + base stat key dla slot-u.
 *    Już pokryte przez 6.13 (`hp-upgrade-consistency-across-views`) który
 *    weryfikuje upgrade multiplier path w `getTotalEquipmentStats` (linia 668
 *    itemSystem.ts). Tutaj świadomie używamy `upgradeLevel: 0` żeby
 *    EQ contribution był flat (łatwiejszy do asercji).
 *
 * **Sens tego testu**: zapobiega regresji typu "ktoś usunął `getElixirHpBonus()`
 * z linii 1603 StatsPopupBody bo "i tak rzadko używany", lub złamał
 * `getTrainingBonuses(skillLevels)` path". W partial test 8.1 dotykamy
 * tylko EQ source — jeśli się rozwali Eliksir albo Trening, partial test
 * przejdzie. Tutaj WYMAGAMY że wszystkie 4 contribution lines się pojawią
 * w `atakBox` (gwarantujemy że buildLines NIE wyfiltrował naszych źródeł).
 *
 * ## Setup
 *
 * - Knight, level 5 (lvl-gate dla iron_sword/heavy_helmet generated items
 *   nie wpływa bo `seedEquippedItem` omija UI canEquip check).
 *   Knight base max_hp = 120 (CLASS_BASE_STATS w createCharacter.ts).
 * - Equipped helmet `heavy_helmet_lvl5_common` z `bonuses: { hp: 20 }`,
 *   upgradeLevel=0 → EQ source +20 HP.
 * - Skill `max_hp` level 4 (seedGameSave.skills.skillLevels) →
 *   `tb.max_hp = 4 × 5 = 20` HP (`skillSystem.ts` linia 303).
 * - Active buff `hp_boost_500` (seedGameSave.buffs) → `getElixirHpBonus`
 *   returns 500 (combatElixirs.ts linia 31).
 *
 * ## Expected math (StatsPopupBody linia 1603-1606)
 *
 * `rawHp = character.max_hp + eqStats.hp + tb.max_hp + getElixirHpBonus() + tfFlatHp`
 *        = 120 + 20 + 20 + 500 + 0
 *        = 660
 * `effMaxHp = floor(rawHp × (1 + tfHpPct/100))` = floor(660 × 1.0) = 660
 *
 * Bez transform → effMaxHp = rawHp.
 *
 * ## Breakdown lines (linia 1687-1695)
 *
 * `hpLines = buildLines(
 *    { label: 'Baza', value: '120' },
 *    line('Eq', 20),         // → +20
 *    line('Trening', 20),    // → +20
 *    line('Eliksir', 500),   // → +500
 *    line('TF flat', 0),     // → null (val === 0 → skipped)
 *    tfHpPct > 0 ? ... : null, // → null (no transform)
 * )`
 *
 * Po filtracji null-i — 4 lines: Baza, Eq, Trening, Eliksir.
 *
 * ## Asercje
 *
 * 1. Max HP StatBox value = '660'.
 * 2. Breakdown zawiera: "Baza" + "120" + "Eq" + "+20" + "Trening" + "+20"
 *    + "Eliksir" + "+500".
 *
 * Cleanup: try/finally → cleanupCharacterById.
 *
 * Sanity baseline (popup-shows-base-stats.spec.ts):
 *   Knight bez wszystkich źródeł → Max HP = 120 (raw base). Różnica
 *   120 → 660 = pełna agregacja 4 źródeł. Gdyby JAKAKOLWIEK ścieżka
 *   się rozwaliła, value byłoby <660 i test poległby.
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../fixtures/testUsers';
import { loginViaUI } from '../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../fixtures/createCharacter';
import { cleanupCharacterById } from '../fixtures/cleanup';
import { seedEquippedItem } from '../fixtures/seedInventory';
import { seedGameSave, findUserIdByEmail } from '../fixtures/seedGameSave';

test.describe('Stats › Popup', { tag: '@stats' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('Max HP aggregates base + equipped item + skill train + active elixir buff', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            // 1. Seed Knight lvl 5 (item level matchy + skill-trainable level).
            //    Base attack Knight = 10, base max_hp = 120 (CLASS_BASE_STATS).
            //    hp/mp = under-max + zero regen żeby UI nie tickować.
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: { level: 5, highest_level: 5, hp: 40, mp: 15, hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            // 2. Seed game_save z (a) skill train `max_hp` level 4 (+20 HP)
            //    + (b) active buff hp_boost_500 (+500 HP).
            //    **WAŻNA KOLEJNOŚĆ**: seedGameSave MUSI iść PRZED
            //    seedEquippedItem, bo seedGameSave zawsze startuje z
            //    `equipment: { helmet: null, ... }` defaults (sgs.ts linia 242)
            //    i przepisuje wszystko co tam było. seedEquippedItem czyta
            //    istniejący state.inventory i merguje swój item nad nim.
            //    Każde źródło osobno: skill train tickuje przez `getTrainingBonuses`,
            //    buff przez `getElixirHpBonus` → osobne paths w StatsPopupBody.
            const userId = await findUserIdByEmail(testUsers.primary.email);
            await seedGameSave({
                characterId: created.id,
                userId,
                skills: {
                    // Pozostałe skill keys nieobecne → default 0. Tylko max_hp =4
                    // żeby `tb.max_hp = 4 × 5 = 20`.
                    skillLevels: { max_hp: 4 },
                },
                buffs: [
                    {
                        id: 'hp_boost_500',
                        name: '+500 Max HP',
                        icon: '🩸',
                        effect: 'hp_boost_500',
                        // Defaults: pausable + 24h remainingMs (won't drain out of combat).
                    },
                ],
            });

            // 3. Equip helmet z +20 HP bonusem. Generated item path —
            //    `bonuses: { hp: 20 }` jest sumowany w `getTotalEquipmentStats`
            //    (eqStats.hp = 20). upgradeLevel=0 → flat 20 (bez scaling).
            //    seedEquippedItem czyta istniejący state z poprzedniego
            //    seedGameSave i tylko mutuje equipment.helmet — pozostałe
            //    sliceł (skills + buffs) zostają nietknięte.
            await seedEquippedItem({
                characterId: created.id,
                slot: 'helmet',
                itemId: 'heavy_helmet_lvl5_common',
                rarity: 'common',
                bonuses: { hp: 20 },
                itemLevel: 5,
                upgradeLevel: 0,
            });

            // 4. Login → wybierz → Town. switchToCharacter rehydratuje
            //    wszystkie stores (inventory.equipment + skills.skillLevels +
            //    buffs.allBuffs) z game_saves blob.
            await loginViaUI(page, testUsers.primary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 10_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });

            // 5. /inventory → tap Statystyki → otwarcie StatsPopupBody.
            await page.goto('/inventory');
            await expect(page.locator('.inventory__paperdoll-actions')).toBeVisible({ timeout: 10_000 });
            await page.getByRole('button', { name: /^statystyki$/i }).tap();

            const statsPopup = page.locator('.inventory__popup--stats');
            await expect(statsPopup).toBeVisible({ timeout: 5_000 });

            // 6. KRYTYCZNA ASERCJA — Max HP StatBox value = '660'.
            //    Selektor: stats-box z labelem "Max HP" → value content === "660".
            //    Per StatsPopupBody linia 1735: `<StatBox label="Max HP" value={effMaxHp} ...>`
            //    Bez transform: effMaxHp = rawHp = 120 + 20 + 20 + 500 = 660.
            const hpBox = statsPopup.locator('.inventory__stats-box', {
                has: page.locator('.inventory__stats-box-label', { hasText: /^Max HP$/ }),
            });
            await expect(hpBox.locator('.inventory__stats-box-value')).toHaveText('660');

            // 7. Breakdown asercje — buildLines (StatsPopupBody linia 1688-1695)
            //    powinien wygenerować 4 lines: Baza/Eq/Trening/Eliksir.
            //    Wszystkie 4 muszą być widoczne w `hpBox` (StatBox renderuje
            //    contribution list w `.inventory__stats-box-breakdown`).
            await expect(hpBox).toContainText('Baza');
            await expect(hpBox).toContainText('120');
            await expect(hpBox).toContainText('Eq');
            await expect(hpBox).toContainText('+20');
            await expect(hpBox).toContainText('Trening');
            // Trening też ma +20 (`+20` matchuje obie linie, ale to OK).
            await expect(hpBox).toContainText('Eliksir');
            await expect(hpBox).toContainText('+500');
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
