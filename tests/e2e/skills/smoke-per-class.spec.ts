/**
 * Atomic E2E — Skills popup renders class-specific active skill cards
 * for each of the 7 classes (parametrized smoke).
 *
 * Spec (BACKLOG.md punkt 12.5 — E×7): "Per-class skill smoke E2E
 * (1 skill per class w jednym combat type)". Adapted: instead of going
 * through full combat, we open the Active Skills popup on `/inventory`
 * and assert the class's tier-1 spell is slotted + visible. This proves:
 *   • `src/data/skills.json` has a non-empty `activeSkills[<class>]` list
 *     for that class (catches "class X has zero skills" regressions).
 *   • Seeding the `skills` slice in `game_saves.state` rehydrates
 *     `useSkillStore.activeSkillSlots` + `unlockedSkills` correctly.
 *   • The popup body filters skills by lowercase class key
 *     (`character.class.toLowerCase()`) and renders the per-class list.
 *
 * **Why popup, not combat**: full combat sim is brittle (rat HP vs lvl-5
 * character → fight may end in <1s before the action bar renders) and
 * timing-sensitive. The Skills popup hits the same data path (skills.json
 * → ACTIVE_SKILLS_BY_CLASS_INV → render cards) without the combat state
 * machine. Combat-flow skill tests live in TODO 12.6 / 12.8.
 *
 * Per-class tier-1 spell (unlockLevel=5 for all classes per skills.json):
 *   • Knight      → shield_bash       (Uderzenie Tarczą)
 *   • Mage        → fireball          (Kula Ognia)
 *   • Cleric      → holy_strike       (Uderzenie Święte)
 *   • Archer      → precise_shot      (Precyzyjny Strzał)
 *   • Rogue       → backstab          (Cios w Plecy)
 *   • Necromancer → life_drain        (Pochłonięcie Życia)
 *   • Bard        → battle_hymn       (Hymn Bitewny)
 *
 * Setup per test:
 *   1. createCharacterViaApi with `level: 5` (== unlockLevel of tier-1
 *      spell so `purgeLockedSkillSlots` on App mount leaves slot intact).
 *      hp_regen/mp_regen=0 to keep HP/MP stable (no test noise from
 *      ticking regen).
 *   2. seedGameSave with `skills.activeSkillSlots = [tier1, null, null, null]`
 *      + `skills.unlockedSkills = { [tier1]: true }`. Without the unlock
 *      flag the slot would render but the card would show `--needs-purchase`
 *      ("🗝️ Odblokuj") instead of `Aktywny`. Without slotting, slot 1
 *      stays `—` and the test couldn't assert the per-class skill is
 *      properly equipped.
 *
 * Actions:
 *   1. Login → /character-select → tap our card → Town (`/`).
 *   2. /inventory → tap "Skille" button (aria-label "Aktywne skille").
 *
 * Outcome (smoke — UI render, NOT functional cast):
 *   - Popup `.inventory__popup--skills` visible with title "Aktywne Skille".
 *   - `.inventory__skills-popup-body` rendered.
 *   - `.inventory__skills-slots` shows 4 slots; first slot is `--filled`
 *     with the class's tier-1 skill polish name visible.
 *   - `.inventory__skills-list` rendered with ≥ 1 card.
 *   - Tier-1 skill card is present + marked `--equipped` (since we slotted
 *     it) + shows "Aktywny" badge (since unlockedSkills flag = true).
 *
 * Co NIE testujemy (defer):
 *   - Actual cast in combat — TODO `skills/<class>/cast-in-combat.spec.ts`
 *     (12.6 multi-context or 12.8 cadence test).
 *   - Skill effect math (damage, DOT, AOE) — covered by 12.1 unit tests.
 *   - Skill upgrade / unlock UI flow — separate spec.
 *
 * Serial mode: 7 tests run kolejno na primary account (workers=1 anyway
 * per playwright.config.ts linia 78, ale eksplicit `mode: 'serial'` chroni
 * future-self gdyby ktoś bumpnął workers=2). Each test creates exactly
 * 1 postać + cleanup w finally → never more than 1 postać na koncie
 * w danym momencie → no risk of hitting 7-char-per-user limit.
 *
 * Cleanup: try/finally per-test → cleanupCharacterById. Idempotent
 * defensive guard chroni przed sierotami gdy assertion crashuje przed
 * teardown-em.
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../fixtures/testUsers';
import { loginViaUI } from '../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName, type CharacterClass } from '../fixtures/createCharacter';
import { seedGameSave, findUserIdByEmail } from '../fixtures/seedGameSave';
import { cleanupCharacterById } from '../fixtures/cleanup';

interface IClassSkillUnderTest {
    /** characters.class enum value (same as createCharacterViaApi input). */
    cls: CharacterClass;
    /** Tier-1 active skill id from src/data/skills.json (all unlockLevel=5). */
    skillId: string;
    /** Polish display name shown in popup (skill.name_pl from skills.json). */
    skillNamePl: string;
}

const CLASS_TIER1_SKILLS: ReadonlyArray<IClassSkillUnderTest> = [
    { cls: 'Knight',      skillId: 'shield_bash',  skillNamePl: 'Uderzenie Tarczą' },
    { cls: 'Mage',        skillId: 'fireball',     skillNamePl: 'Kula Ognia' },
    { cls: 'Cleric',      skillId: 'holy_strike',  skillNamePl: 'Uderzenie Święte' },
    { cls: 'Archer',      skillId: 'precise_shot', skillNamePl: 'Precyzyjny Strzał' },
    { cls: 'Rogue',       skillId: 'backstab',     skillNamePl: 'Cios w Plecy' },
    { cls: 'Necromancer', skillId: 'life_drain',   skillNamePl: 'Pochłonięcie Życia' },
    { cls: 'Bard',        skillId: 'battle_hymn',  skillNamePl: 'Hymn Bitewny' },
];

test.describe('Skills › Per-Class Smoke', { tag: '@skills' }, () => {
    // Serial: 7 tests per profile, każdy uzywa primary account. Workers=1
    // w config też to wymusza, ale `mode: 'serial'` jest jawnym sygnalem
    // intencji (future-proof gdyby ktoś bumpnął workers).
    test.describe.configure({ timeout: 60_000, mode: 'serial' });

    for (const { cls, skillId, skillNamePl } of CLASS_TIER1_SKILLS) {
        test(`${cls}: tier-1 skill "${skillNamePl}" renders in Active Skills popup`, async ({ page }) => {
            const nick = generateTestCharacterName();
            let createdId: string | null = null;

            try {
                // 1. Seed postać na lvl 5 (== unlockLevel tier-1 spell-a kazdej
                //    klasy per skills.json). Bez tego `purgeLockedSkillSlots`
                //    przy App mount-cie wyczysci slot 0 (linia 65 App.tsx) bo
                //    character.level < skill.unlockLevel.
                const created = await createCharacterViaApi({
                    userEmail: testUsers.primary.email,
                    name: nick,
                    class: cls,
                    overrides: { level: 5, hp_regen: 0, mp_regen: 0 },
                });
                createdId = created.id;

                // 2. Seed game_save → wstawia skill w slot 0 + flag unlock-u.
                //    Bez `unlockedSkills[skillId]=true` karta renderuje sie
                //    jako --needs-purchase z "🗝️ Odblokuj" zamiast "Aktywny".
                const userId = await findUserIdByEmail(testUsers.primary.email);
                await seedGameSave({
                    characterId: created.id,
                    userId,
                    skills: {
                        activeSkillSlots: [skillId, null, null, null],
                        unlockedSkills: { [skillId]: true },
                    },
                });

                // 3. Login → /character-select → wybierz postać → Town
                await loginViaUI(page, testUsers.primary);
                await page.goto('/character-select');
                const card = page.locator('.char-select__card', {
                    has: page.locator('.char-select__card-name', { hasText: nick }),
                });
                await expect(card).toBeVisible({ timeout: 10_000 });
                await card.getByRole('button', { name: /Wybierz/i }).tap();
                await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });

                // 4. /inventory → tap "Skille" button (aria-label "Aktywne skille"
                //    per Inventory.tsx linia 3473).
                await page.goto('/inventory');
                await expect(page.locator('.inventory__paperdoll-actions'))
                    .toBeVisible({ timeout: 10_000 });
                await page.getByRole('button', { name: /^aktywne skille$/i }).tap();

                // 5. Popup `.inventory__popup--skills` widoczny (linia 3976).
                const popup = page.locator('.inventory__popup--skills');
                await expect(popup).toBeVisible({ timeout: 5_000 });

                // 6. Header title "✨ Aktywne Skille" (linia 3984).
                await expect(popup.getByText('Aktywne Skille')).toBeVisible();

                // 7. Body widoczny (linia 2217 `.inventory__skills-popup-body`).
                const body = popup.locator('.inventory__skills-popup-body');
                await expect(body).toBeVisible();

                // 8. Slot overview — 4 sloty, pierwszy --filled z naszym skillem
                //    (linia 2219-2235). `slots__slot--filled` modifier appears
                //    only when `skill` lookup matches slotId.
                const slots = body.locator('.inventory__skills-slot');
                await expect(slots).toHaveCount(4);
                const firstSlot = slots.nth(0);
                await expect(firstSlot).toHaveClass(/inventory__skills-slot--filled/);
                await expect(firstSlot.locator('.inventory__skills-slot-name'))
                    .toHaveText(skillNamePl);

                // 9. Skill list (linia 2242 `.inventory__skills-list`). Liczba
                //    kart = liczba aktywnych skili dla danej klasy (15 per
                //    skills.json). Asercja >= 1 daje buffer gdyby dataset
                //    sie zmienial.
                const list = body.locator('.inventory__skills-list');
                await expect(list).toBeVisible();
                const cards = list.locator('.inventory__skills-card');
                const cardCount = await cards.count();
                expect(cardCount).toBeGreaterThanOrEqual(1);

                // 10. Tier-1 skill card present z polish name + "Aktywny" badge
                //     (linia 2296 — renderuje sie tylko gdy activeSkillSlots
                //     zawiera ten skillId → potwierdza ze seed dotarl do
                //     skillStore).
                const tier1Card = list.locator('.inventory__skills-card', {
                    has: page.locator('.inventory__skills-card-name', { hasText: skillNamePl }),
                });
                await expect(tier1Card).toBeVisible();
                await expect(tier1Card).toHaveClass(/inventory__skills-card--equipped/);
                await expect(tier1Card.locator('.inventory__skills-card-active'))
                    .toHaveText('Aktywny');
            } finally {
                if (createdId) {
                    await cleanupCharacterById(createdId);
                }
            }
        });
    }
});
