/**
 * Atomic E2E — solo skill ANIMATION renders on the dummy when player
 * taps their tier-1 skill in `/trainer` (BACKLOG 12.6 / 12.9).
 *
 * Spec (user explicit 2026-05-25): "chce miec pewnosc ze animacje skilli
 * pokazuja sie poprawnie i tak i w party i solo i sojusznikom i na moim
 * ekranie". This file covers the SOLO + own-screen leg of that
 * requirement; multi-context (party member sees ally's anim) lives in
 * `skills/multi-context/party-member-sees-ally-animation.spec.ts`.
 *
 * Why `/trainer` and not `/combat`:
 *   • Trainer is a sandbox — no MP cost, no per-skill MP gate, dummy is
 *     immortal so the fight doesn't end mid-cast. Skill cooldown is
 *     enforced (8s on Knight `shield_bash`), so one cast per skill per
 *     test is plenty.
 *   • Combat (hunting) requires `phase === 'fighting'` for `doUseSkill`
 *     to do anything, and starting a fight via `/combat` → tap monster
 *     `⚔️` button can resolve in <1s on Knight lvl 5 vs rat (lvl 1 HP=15)
 *     — the action bar may render but the player is already in `victory`
 *     phase before our `.tap()` lands.
 *   • Trainer's action bar always renders (after character hydrates),
 *     the `doManualSkill` call directly invokes `fx.triggerEnemySkillAnim`
 *     for damage-dealing skills, which appends `.skill-anim-overlay`
 *     onto the dummy's `.combat-ui__enemy` card (EnemyCard.tsx ~line
 *     239-257).
 *
 * What we assert (smoke contract):
 *   1. Action bar `.combat-ui__action-bar` renders with the per-class
 *      tier-1 skill button enabled (NOT `--disabled`).
 *   2. After `.tap()`, the dummy enemy card hosts a
 *      `.skill-anim-overlay` element with the expected category-cssClass
 *      (e.g. `.skill-anim--physical` for `shield_bash`,
 *      `.skill-anim--fire` for `fireball`).
 *   3. The overlay carries a `.skill-anim-emoji` glyph or image inside.
 *   4. The overlay self-removes after `animData.duration` (~600-900 ms
 *      per `skillAnimations.ts`) — we wait it out and re-assert
 *      `.skill-anim-overlay` count === 0 to prove the lifecycle works.
 *
 * What we do NOT assert (defer):
 *   • Damage delta on the dummy (Trainer dummy is invincible — HP bar
 *     stays at the slider %; not testable here).
 *   • XP / gold / drop side effects (none in trainer).
 *   • Cross-class skill cast on the SAME test (each class needs its
 *     own character).
 *
 * Parametrization: one test per class (7 total). Each test
 *   seeds a fresh character at unlockLevel (5) with the tier-1 spell
 *   slotted + unlocked, then runs the cast assertion.
 *
 * Per-class tier-1 spell + expected animation category (verified against
 * `src/data/skillAnimations.ts`):
 *   Knight       shield_bash    physical   🛡️
 *   Mage         fireball       fire       🔥
 *   Cleric       holy_strike    holy       ✨
 *   Archer       precise_shot   arrow      🎯
 *   Rogue        backstab       physical   🗡️
 *   Necromancer  life_drain     dark       💜
 *   Bard         battle_hymn    music      🎵   ← buff, no enemy target
 *
 * Bard caveat: `battle_hymn` has `damage: 0` + `party_attack_up` effect.
 * `doManualSkill` → `skillTargetsEnemy(effect)` returns false for pure
 * self/party buffs, so the animation lands on the PLAYER ally card
 * (`fx.triggerAllySkillAnim(mySlot, …)`) instead of the dummy. We
 * assert the overlay on `.combat-ui__ally` for Bard; on
 * `.combat-ui__enemy` for the other six.
 *
 * Cleanup: try/finally + `cleanupCharacterById`. Serial mode (one test
 * at a time on primary account) so we never hit the 7-char limit.
 */

import { test, expect, type Page } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName, type CharacterClass } from '../../fixtures/createCharacter';
import { seedGameSave, findUserIdByEmail } from '../../fixtures/seedGameSave';
import { cleanupCharacterById } from '../../fixtures/cleanup';

interface IClassSkillAnimCase {
    /** Character class. */
    cls: CharacterClass;
    /** Tier-1 skill id (unlockLevel=5). */
    skillId: string;
    /** Category class appended to overlay element (e.g. `skill-anim--fire`). */
    expectedCategoryClass: string;
    /**
     * Where the overlay lands: enemy card for damage / enemy-debuff skills,
     * ally card for pure self/party buffs (Bard `battle_hymn`).
     */
    target: 'enemy' | 'ally';
}

const CASES: ReadonlyArray<IClassSkillAnimCase> = [
    { cls: 'Knight',      skillId: 'shield_bash',  expectedCategoryClass: 'skill-anim--physical', target: 'enemy' },
    { cls: 'Mage',        skillId: 'fireball',     expectedCategoryClass: 'skill-anim--fire',     target: 'enemy' },
    { cls: 'Cleric',      skillId: 'holy_strike',  expectedCategoryClass: 'skill-anim--holy',     target: 'enemy' },
    { cls: 'Archer',      skillId: 'precise_shot', expectedCategoryClass: 'skill-anim--arrow',    target: 'enemy' },
    { cls: 'Rogue',       skillId: 'backstab',     expectedCategoryClass: 'skill-anim--physical', target: 'enemy' },
    { cls: 'Necromancer', skillId: 'life_drain',   expectedCategoryClass: 'skill-anim--dark',     target: 'enemy' },
    // Bard's battle_hymn is a pure buff (damage:0, party_attack_up effect)
    // → animation lands on player's own ally card, not the dummy.
    { cls: 'Bard',        skillId: 'battle_hymn',  expectedCategoryClass: 'skill-anim--music',    target: 'ally'  },
];

/** Pick the player's seeded character on /character-select → land in Town. */
const pickCharacter = async (page: Page, nick: string): Promise<void> => {
    await page.goto('/character-select');
    const card = page.locator('.char-select__card', {
        has: page.locator('.char-select__card-name', { hasText: nick }),
    });
    await expect(card).toBeVisible({ timeout: 10_000 });
    await card.getByRole('button', { name: /Wybierz/i }).tap();
    await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
    // Wait dla TopHeader żeby characterStore.character zostal
    // zhydratowany przed direct-nav na /trainer (CombatGuard chce
    // character != null).
    await expect(page.locator('.top-header')).toBeVisible({ timeout: 10_000 });
};

test.describe('Skills › Animations', { tag: '@skills' }, () => {
    // Serial mode: 7 tests per profile, każdy uzywa primary account.
    // Workers=1 w playwright.config też to wymusza, ale `mode: 'serial'`
    // jest jawnym sygnalem intencji + chroni gdyby ktoś bumpnął workers.
    test.describe.configure({ timeout: 60_000, mode: 'serial' });

    for (const { cls, skillId, expectedCategoryClass, target } of CASES) {
        test(`solo: ${cls} → ${skillId} (${expectedCategoryClass}) animation renders on ${target} card in /trainer`, async ({ page }) => {
            const nick = generateTestCharacterName();
            let createdId: string | null = null;

            try {
                // 1. Seed postać na lvl 5 (= unlockLevel tier-1 spell-a wszystkich
                //    klas per skills.json). hp_regen/mp_regen=0 zeby HP/MP nie
                //    tickowal w trakcie testu — trainer mirroruje sandboxHp do
                //    characterStore.hp + co setSandboxHp wpada w mirror effect.
                const created = await createCharacterViaApi({
                    userEmail: testUsers.primary.email,
                    name: nick,
                    class: cls,
                    overrides: { level: 5, hp_regen: 0, mp_regen: 0 },
                });
                createdId = created.id;

                // 2. Seed game_save → slot 0 z tier-1 spell-em + flag unlock-u.
                //    Bez `unlockedSkills[skillId]=true` skill istnieje w slot-cie
                //    ale `unlockedSkills.get(id)` w `doManualSkill`-equivalent
                //    nadal go traktuje jako "not purchased" — w trainer-ze
                //    wystarczy slot != null + unlockLevel <= character.level.
                //    Damy oba flagi żeby dopasować się do hunting-flow patterns.
                const userId = await findUserIdByEmail(testUsers.primary.email);
                await seedGameSave({
                    characterId: created.id,
                    userId,
                    skills: {
                        activeSkillSlots: [skillId, null, null, null],
                        unlockedSkills: { [skillId]: true },
                    },
                });

                // 3. Login → wybierz postać → Town
                await loginViaUI(page, testUsers.primary);
                await pickCharacter(page, nick);

                // 4. Direct nav na /trainer. CombatGuard pozwala bo
                //    combatStore.phase = 'idle' po świeżej hydratacji.
                await page.goto('/trainer');
                await expect(page).toHaveURL(/\/trainer$/, { timeout: 10_000 });

                // 5. Root `.trainer` + action bar widoczne — proxy że pełna
                //    render-pipeline odpaliła (po-hooks early-return guard
                //    fixed 2026-05-25 per BACKLOG 13.5 trainer entry).
                await expect(page.locator('.trainer')).toBeVisible({ timeout: 15_000 });
                const actionBar = page.locator('.combat-ui__action-bar');
                await expect(actionBar).toBeVisible({ timeout: 10_000 });

                // 5b. CRITICAL — turn OFF auto-skill BEFORE assertions.
                //     Trainer.tsx line 94 sets `autoSkill` to TRUE by
                //     default, which fires `doManualSkill`-equivalent
                //     every tick (250ms) for every skill off cooldown.
                //     On mobile-chrome the trainer tick has fired ≥1
                //     before we tap, so the skill is already on cooldown
                //     and the button shows `--disabled --cooldown`. Pre-fix
                //     this caused the test to fail on Cleric (~33s into
                //     the suite, after Knight + Mage warm-up). The chip
                //     has title="Auto skille" and renders ✨ ON / OFF.
                //     Turn it off + give one tick (500ms ≥ trainer's
                //     250ms tick) so the next `cooldownsRef` check passes
                //     for whatever auto-cast just landed.
                const autoSkillChip = page.locator('.combat-ui__chip[title="Auto skille"]');
                await expect(autoSkillChip).toBeVisible({ timeout: 5_000 });
                const wasAutoSkillOn = (await autoSkillChip.textContent())?.includes('ON');
                if (wasAutoSkillOn) {
                    await autoSkillChip.tap();
                    await expect(autoSkillChip).toContainText('OFF', { timeout: 3_000 });
                }
                // Also flip auto-fight off — basic attacks don't trip the
                // skill cooldown but they bump dummy-hit-pulses + ally
                // floats that could compete for the same DOM space and
                // confuse the assertion if a `tap()` slips through during
                // a flash.
                const autoFightChip = page.locator('.combat-ui__chip[title="Auto walka"]');
                if (await autoFightChip.count() > 0) {
                    const wasAutoFightOn = (await autoFightChip.textContent())?.includes('ON');
                    if (wasAutoFightOn) await autoFightChip.tap();
                }

                // 6. Skill button visible + enabled. `aria-label = skillId`
                //    (CombatActionBar.tsx linia 22; Trainer.tsx linia 3251
                //    sets name = slotId). NOT `--disabled` (trainer ignores
                //    MP, cooldown is 0 on fresh entry — assuming we
                //    successfully disabled autoSkill above).
                //    Bumped from 10s → 20s because Cleric's holy_strike has
                //    6s CD; if auto-skill snuck a cast before our toggle,
                //    we need to wait for the per-skill cooldown to drain.
                const skillBtn = actionBar.locator(`button[aria-label="${skillId}"]`);
                await expect(skillBtn).toBeVisible({ timeout: 10_000 });
                await expect(skillBtn).toBeEnabled({ timeout: 20_000 });
                await expect(skillBtn).not.toHaveClass(/combat-ui__action-btn--disabled/);

                // 7. Snapshot: drain any leftover auto-fired animations.
                //    A skill animation lives 600-1500ms (per
                //    `skillAnimations.ts` durations). If auto-skill cast
                //    just before our toggle landed, an overlay may still be
                //    on the card. Wait for the count to hit 0 (up to 2.5s)
                //    so the assertion below starts from a clean state.
                const targetCardsBefore = page.locator(`.combat-ui__${target} .skill-anim-overlay`);
                await expect.poll(
                    async () => await targetCardsBefore.count(),
                    { timeout: 2_500, intervals: [100, 250, 500] },
                ).toBe(0);

                // 8. Tap the skill. doManualSkill → effectsCastSkill → on the
                //    next tick the fx.triggerEnemy/AllySkillAnim populates
                //    fx.enemySkill[i] / fx.allySkill[0], which feeds the
                //    `skillAnim` prop on EnemyCard / AllyCard → overlay
                //    renders.
                await skillBtn.tap();

                // 9. Within ~500ms, overlay appears with the expected category
                //    class. Use a Locator.first() match to keep the assertion
                //    stable when multiple cards exist (Trainer has 1 dummy by
                //    default + 1 player ally — they don't collide because we
                //    scoped to the right side).
                const overlay = page.locator(`.combat-ui__${target} .${expectedCategoryClass}`);
                await expect(overlay.first()).toBeVisible({ timeout: 3_000 });

                // 10. Overlay carries a `.skill-anim-emoji` (or `--img` variant
                //     when per-class spell PNG is registered). Either flavour
                //     proves the inner glyph slot exists (i.e. category class
                //     isn't just an empty halo without artwork). We use
                //     `.skill-anim-emoji` as the canonical selector — the
                //     image variant `--img` is also matched by `.skill-anim-emoji`
                //     because CombatUI / EnemyCard.tsx sets both classes on
                //     the <img> when the icon resolves to a URL.
                const overlayEmoji = overlay.first().locator('.skill-anim-emoji');
                await expect(overlayEmoji).toBeVisible({ timeout: 1_500 });

                // 11. Wait for the overlay to self-remove. `getSkillAnimation`
                //     durations are ~600-1500ms; we wait up to 3500ms to give
                //     CI headroom. setTimeout in `useCombatFx.triggerXSkillAnim`
                //     clears `fx.enemySkill[slot]` / `fx.allySkill[slot]` after
                //     `animData.duration`, which un-renders the overlay on
                //     the next React render tick.
                await expect(overlay.first()).toBeHidden({ timeout: 3_500 });
            } finally {
                if (createdId) {
                    await cleanupCharacterById(createdId);
                }
            }
        });
    }
});
