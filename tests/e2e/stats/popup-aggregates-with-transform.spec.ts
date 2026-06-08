/**
 * Atomic E2E — Stats popup pełna agregacja Max HP z TRANSFORM jako
 * dodatkowym źródłem (5/5 contributing sources: base + EQ + skill train
 * + elixir buff + transform flat + transform %).
 *
 * Spec (BACKLOG.md punkt 8.1): "Stats popup agreguje: EQ + transform +
 * upgrade + eliksir + skill train + buffs". Ten test rozszerza istniejący
 * 8.1 (`popup-aggregates-all-sources.spec.ts` — 4 źródła base/EQ/skill
 * train/eliksir) o aktywny transform (Knight tier 1).
 *
 * ## Co dotyczy "6 sources" w spec-u — dokumentacja decyzji
 *
 * `StatsPopupBody` (`src/views/Inventory/Inventory.tsx` linia 1574-1801)
 * faktycznie agreguje **5 distinct sources** w `hpLines` breakdown
 * (linia 1688-1695):
 *
 *   1. **Baza**       — `character.max_hp`         (class base)
 *   2. **Eq**         — `eqStats.hp`               (helmet/armor/etc.
 *                                                  WITH `upgradeLevel`
 *                                                  multiplier applied
 *                                                  via `getTotalEquipmentStats`
 *                                                  itemSystem.ts linia 668)
 *   3. **Trening**    — `tb.max_hp`                (`getTrainingBonuses`
 *                                                  skillSystem.ts linia 303)
 *   4. **Eliksir**    — `getElixirHpBonus()`       (combatElixirs.ts)
 *   5. **TF flat**    — `tBreakdown.flatHp`        (transform per-class
 *                                                  table x tier mult)
 *   5b. **TF %**      — `tBreakdown.hpPercent`     (transform per-class
 *                                                  table — wraps rawHp)
 *
 * **Upgrade NIE jest osobnym source — jest częścią Eq**: każdy equipped
 * item ma `upgradeLevel ∈ {0..30}`, `getTotalEquipmentStats` aplikuje
 * `getUpgradedBaseStat(bonus, upgradeLevel)` (np. round(20 × 1.15^3) = 30
 * dla helmet z hp=20 + upgrade=3). Stąd kontrybucja upgrade jest
 * wbudowana w wartość `eqStats.hp`. Pełne pokrycie upgrade path: test
 * 6.13 `inventory/upgrade/hp-upgrade-consistency-across-views.spec.ts`.
 *
 * **Party-buff NIE jest source w StatsPopupBody** — buffy class-based
 * (battle_cry party_attack_up:20:5000 etc.) są aplikowane TYLKO w combat
 * tick path przez `applySkillBuff` / `huntApplySkillEffectV2` na poziomie
 * combatEngine. StatsPopupBody czyta `getEffectiveChar` STAT POOL bez
 * combat-time multipliers. Test party-buff: combat-sim path, nie stats popup.
 *
 * **Konkluzja**: 8.1 oryginalna teza "6/6 sources" → w rzeczywistości
 * StatsPopupBody pokrywa 5/5 distinct sources (upgrade fold into Eq,
 * party-buff combat-only). Wszystkie 5 testowane:
 *   • partial 8.1a `popup-aggregates-equipped-item.spec.ts` — Eq source dla Atak
 *   • 8.1b `popup-aggregates-all-sources.spec.ts` — Max HP 4 sources jednocześnie
 *   • 8.1c (ten plik) — TEN SAM 4 sources + dodatkowo TRANSFORM (TF flat + TF %)
 *
 * ## Setup
 *
 * Knight, level 5, base max_hp=120.
 * Skill train max_hp=4 → `tb.max_hp = 20`.
 * Equipped helmet z `bonuses: { hp: 20 }`, upgradeLevel=0 → `eqStats.hp = 20`.
 * Active buff `hp_boost_500` → `getElixirHpBonus() = 500`.
 * Completed transform id=1 (Knight tier 1): `flatHp=420`, `hpPercent=4`.
 *
 * ## Expected math
 *
 * rawHp     = 120 + 20 + 20 + 500 + 420   = 1080
 * effMaxHp  = floor(1080 × (1 + 4/100))   = floor(1123.2) = 1123
 *
 * ## Breakdown lines (StatsPopupBody linia 1688-1695)
 *
 * `hpLines = buildLines(
 *    { label: 'Baza',     value: '120' },
 *    line('Eq',           20),    // +20
 *    line('Trening',      20),    // +20
 *    line('Eliksir',      500),   // +500
 *    line('TF flat',      420),   // +420
 *    tfHpPct > 0 ? { label: 'TF %', value: '+4% (43)' } : null  // +4% delta
 * )`
 *
 * → 6 lines pojawia się w UI: Baza/Eq/Trening/Eliksir/TF flat/TF %.
 *
 * ## CRITICAL — legacy migration bypass
 *
 * `characterScope.ts` linia 436-446 sprawdza
 * `localStorage['tibia_transform_migration_v1_<charId>']`. Brak markera
 * → wymusza `bakedBonusesApplied: true` + odpala migrację (MUTUJE
 * character stats!). Test używa `page.addInitScript` żeby ustawić marker
 * BEFORE pierwszej hydration, więc blok migracyjny jest pomijany i
 * `bakedBonusesApplied: false` z seeded blob-a zostaje aktywne →
 * `getLiveTransformBreakdown` zwraca `active: true`.
 *
 * Cleanup: try/finally → cleanupCharacterById.
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../fixtures/testUsers';
import { loginViaUI } from '../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../fixtures/createCharacter';
import { cleanupCharacterById } from '../fixtures/cleanup';
import { seedEquippedItem } from '../fixtures/seedInventory';
import { seedGameSave, findUserIdByEmail } from '../fixtures/seedGameSave';

test.describe('Stats › Popup', { tag: '@stats' }, () => {
    test.describe.configure({ timeout: 90_000 });

    test('Max HP aggregates base + Eq + skill train + elixir + transform (flat + %)', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            // 1. Seed Knight lvl 5 na SECONDARY (suite running on primary).
            const created = await createCharacterViaApi({
                userEmail: testUsers.secondary.email,
                name: nick,
                class: 'Knight',
                overrides: { level: 5, highest_level: 5, hp: 40, mp: 15, hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            // 2. Seed game_save z (a) skill train, (b) buff, (c) transforms slice.
            //    KOLEJNOŚĆ: seedGameSave PRZED seedEquippedItem (sgs.ts linia 242
            //    overwrites equipment defaults; seedEquippedItem merguje na
            //    istniejący state). Transforms slice musi mieć `bakedBonusesApplied:false`
            //    żeby `getLiveTransformBreakdown` zwracała active=true.
            const userId = await findUserIdByEmail(testUsers.secondary.email);
            await seedGameSave({
                characterId: created.id,
                userId,
                skills: {
                    skillLevels: { max_hp: 4 },
                },
                buffs: [
                    {
                        id: 'hp_boost_500',
                        name: '+500 Max HP',
                        icon: '🩸',
                        effect: 'hp_boost_500',
                    },
                ],
                transforms: {
                    completedTransforms: [1], // Knight tier 1
                    bakedBonusesApplied: false, // active=true gdy non-empty + false
                },
            });

            // 3. Equip helmet z bonus { hp: 20 } (upgradeLevel=0 → flat 20).
            await seedEquippedItem({
                characterId: created.id,
                slot: 'helmet',
                itemId: 'heavy_helmet_lvl5_common',
                rarity: 'common',
                bonuses: { hp: 20 },
                itemLevel: 5,
                upgradeLevel: 0,
            });

            // 4. **CRITICAL**: ustaw localStorage marker `tibia_transform_migration_v1_<charId>=1`
            //    PRZED pierwszą nawigacją, żeby `characterScope` linia 438 widziała
            //    `alreadyMigrated=true` i SKIP-nął forced `bakedBonusesApplied=true`
            //    + `migrateLegacyBakedBonuses`. Bez tego transform bonusy będą zbaked
            //    w `character.max_hp` i NIE pojawią się w breakdown (active=false).
            await page.addInitScript((charId) => {
                try {
                    localStorage.setItem(`tibia_transform_migration_v1_${charId}`, '1');
                } catch { /* private mode / quota */ }
            }, created.id);

            // 5. Login → wybierz → Town.
            await loginViaUI(page, testUsers.secondary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 10_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });

            // 6. /inventory → tap Statystyki.
            await page.goto('/inventory');
            await expect(page.locator('.inventory__paperdoll-actions')).toBeVisible({ timeout: 10_000 });
            await page.getByRole('button', { name: /^statystyki$/i }).tap();

            const statsPopup = page.locator('.inventory__popup--stats');
            await expect(statsPopup).toBeVisible({ timeout: 5_000 });

            // 7. Max HP StatBox value = 1123.
            //    rawHp = 120 + 20 + 20 + 500 + 420 = 1080
            //    effMaxHp = floor(1080 × 1.04) = floor(1123.2) = 1123
            const hpBox = statsPopup.locator('.inventory__stats-box', {
                has: page.locator('.inventory__stats-box-label', { hasText: /^Max HP$/ }),
            });
            // pl-PL toLocaleString dla 1123 = "1123" (poniżej threshold separatora
            // dla 4-digit; powyżej 9999 dostaje "10 000" itp.).
            await expect(hpBox.locator('.inventory__stats-box-value')).toHaveText('1123');

            // 8. Breakdown asercje — wszystkie 6 lines (5 sources + TF%).
            //    `buildLines` filtruje val===0 → wszystkie nasze entries
            //    są non-zero więc widoczne.
            await expect(hpBox).toContainText('Baza');
            await expect(hpBox).toContainText('120');
            await expect(hpBox).toContainText('Eq');
            await expect(hpBox).toContainText('+20');
            await expect(hpBox).toContainText('Trening');
            await expect(hpBox).toContainText('Eliksir');
            await expect(hpBox).toContainText('+500');
            await expect(hpBox).toContainText('TF flat');
            await expect(hpBox).toContainText('+420');
            // TF % line format (linia 1694): `+4% (43)` (effMaxHp - rawHp =
            // 1123 - 1080 = 43).
            await expect(hpBox).toContainText('TF %');
            await expect(hpBox).toContainText(/\+4%/);
            await expect(hpBox).toContainText(/\(43\)/);
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
