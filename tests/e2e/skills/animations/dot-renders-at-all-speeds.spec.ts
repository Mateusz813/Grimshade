/**
 * Atomic E2E — skill animation overlay renders on the dummy at every
 * combat speed (x1 / x2 / x4) in `/trainer` (BACKLOG 12.9).
 *
 * Spec (user explicit 2026-05-25): "chce miec pewnosc ze animacje skilli
 * pokazuja sie poprawnie ... różne prędkości" — the spell-anim overlay
 * has to render at every speed multiplier (not just x1), otherwise a
 * speed-up regression could leave players staring at a frozen action bar
 * during higher-tempo fights.
 *
 * This is the **DOT / buff / resurrect animations at all speeds** test:
 * pragmatic interpretation per the task brief — verify the animation div
 * RENDERS at all 3 speeds without crashing. We use Knight's
 * `shield_bash` (effect=stun:3000, category=physical 🛡️) as the
 * representative cast — the same overlay machinery (`fx.triggerEnemySkillAnim`
 * → `.skill-anim-overlay`) lives behind every category (DOT/buff/heal/
 * resurrect/damage). The skill-category-specific render path is already
 * covered per-class by `solo-trainer-per-class.spec.ts`; this test pins
 * the speed-dimension contract.
 *
 * Why `/trainer`:
 *   • Sandbox: no MP, dummy invincible, no fight end mid-cast.
 *   • Speed cycle works: `cycleSpeed` advances 1 → 2 → 4 → 1 in trainer
 *     (Trainer.tsx ~3285 `setSpeedMult` via the `⏩` chip).
 *   • Skill cooldown stays enforced (8s on shield_bash), but trainer's
 *     `noCooldowns` toggle bypasses it — we ENABLE it so we can cast
 *     3 times in quick succession (one per speed step).
 *
 * Per-speed contract assertions:
 *   1. After setting speed to X (1/2/4 — chip label flips to X1/X2/X4),
 *      tap `shield_bash` button.
 *   2. Within ~1500 ms (extra cushion for x4 wall-time), the dummy enemy
 *      card hosts a `.skill-anim-overlay.skill-anim--physical` element.
 *   3. The overlay carries a `.skill-anim-emoji` child (glyph slot
 *      proves the inner artwork mounted).
 *   4. Overlay self-removes within ~3500 ms (skill anim duration is
 *      600-1500ms × ms-wallclock for trainer; we allow generous CI
 *      headroom).
 *
 * Why these 4 steps × 3 speeds + not "DOT lifecycle":
 *   The task brief said "verify the animation div RENDERS at all 3
 *   speeds without crashing" — pragmatic contract. We do NOT verify
 *   that the DOT TICK numbers float at faster cadence at x4 (that would
 *   need per-tick monster HP tracking + RNG control). We DO verify that
 *   the SAME render path that handles DOT / buff / resurrect spell-cast
 *   triggers fires the overlay regardless of the speed setting.
 *
 * Cleanup: try/finally + `cleanupCharacterById`. Primary account (we
 * pick a uniquely r11d_-prefixed char name so we don't collide with other
 * agents running parallel).
 */

import { test, expect, type Page } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { seedGameSave, findUserIdByEmail } from '../../fixtures/seedGameSave';
import { cleanupCharacterById } from '../../fixtures/cleanup';

const SKILL_ID = 'shield_bash';
const EXPECTED_CATEGORY_CLASS = 'skill-anim--physical';

/** Pick the player's seeded character on /character-select → land in Town. */
const pickCharacter = async (page: Page, nick: string): Promise<void> => {
    await page.goto('/character-select');
    const card = page.locator('.char-select__card', {
        has: page.locator('.char-select__card-name', { hasText: nick }),
    });
    await expect(card).toBeVisible({ timeout: 10_000 });
    await card.getByRole('button', { name: /Wybierz/i }).tap();
    await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
    await expect(page.locator('.top-header')).toBeVisible({ timeout: 10_000 });
};

test.describe('Skills › Animations', { tag: '@skills' }, () => {
    test.describe.configure({ timeout: 120_000 });

    test('shield_bash animation overlay renders at every speed (x1 / x2 / x4) in /trainer', async ({ page }) => {
        // r11d_ prefix prevents collision with parallel test agents per
        // task brief.
        const nick = `r11d_${generateTestCharacterName().slice(0, 10)}`;
        let createdId: string | null = null;

        try {
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: { level: 5, hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            const userId = await findUserIdByEmail(testUsers.primary.email);
            await seedGameSave({
                characterId: created.id,
                userId,
                skills: {
                    activeSkillSlots: [SKILL_ID, null, null, null],
                    unlockedSkills: { [SKILL_ID]: true },
                },
            });

            await loginViaUI(page, testUsers.primary);
            await pickCharacter(page, nick);

            await page.goto('/trainer');
            await expect(page).toHaveURL(/\/trainer$/, { timeout: 10_000 });
            await expect(page.locator('.trainer')).toBeVisible({ timeout: 15_000 });

            const actionBar = page.locator('.combat-ui__action-bar');
            await expect(actionBar).toBeVisible({ timeout: 10_000 });

            // CRITICAL — turn OFF auto-skill so the trainer-tick auto-cast
            // doesn't consume our cooldown right before our tap. Same
            // rationale as solo-trainer-per-class.spec.ts step 5b.
            const autoSkillChip = page.locator('.combat-ui__chip[title="Auto skille"]');
            await expect(autoSkillChip).toBeVisible({ timeout: 5_000 });
            const wasAutoSkillOn = (await autoSkillChip.textContent())?.includes('ON');
            if (wasAutoSkillOn) {
                await autoSkillChip.tap();
                await expect(autoSkillChip).toContainText('OFF', { timeout: 3_000 });
            }

            // Also flip auto-fight off — basic attacks bump dummy-hit
            // pulses + ally floats that could compete for DOM space.
            const autoFightChip = page.locator('.combat-ui__chip[title="Auto walka"]');
            if (await autoFightChip.count() > 0) {
                const wasAutoFightOn = (await autoFightChip.textContent())?.includes('ON');
                if (wasAutoFightOn) await autoFightChip.tap();
            }

            // ENABLE the trainer-only "no cooldowns" toggle so we can cast
            // 3 times back-to-back (one per speed step). Without it the
            // 8s shield_bash CD blocks us mid-suite.
            // The chip title text from Trainer.tsx line 3319 is
            // 'Wyłącz cooldowny skilli (sandbox)' (the ⏱️ chip).
            const noCooldownChip = page.locator('.combat-ui__chip[title*="cooldowny"]');
            if (await noCooldownChip.count() > 0) {
                const wasOn = (await noCooldownChip.textContent())?.includes('ON');
                if (!wasOn) await noCooldownChip.tap();
            }

            // Speed chip cycles X1 → X2 → X4 → X1 on tap.
            const speedChip = page.locator('.combat-ui__chip[title="Prędkość walki"]');
            await expect(speedChip).toBeVisible({ timeout: 5_000 });

            // The skill button — aria-label = skillId (CombatActionBar.tsx
            // line 22). Trainer mounts a single skill slot per `activeSkillSlots`.
            const skillBtn = actionBar.locator(`button[aria-label="${SKILL_ID}"]`);
            await expect(skillBtn).toBeVisible({ timeout: 10_000 });

            // Enemy-card overlay locator (shield_bash is a damage/debuff
            // skill targeting an enemy, per solo-trainer-per-class.spec.ts
            // target='enemy' mapping for Knight). The overlay carries the
            // category CSS class.
            const overlayLocator = page.locator(`.combat-ui__enemy .${EXPECTED_CATEGORY_CLASS}`);

            // Iterate through the 3 speed settings. Speed chip starts at
            // X1, then cycles X1→X2→X4 on subsequent taps.
            const SPEEDS_TO_TEST: ReadonlyArray<'X1' | 'X2' | 'X4'> = ['X1', 'X2', 'X4'];

            for (const targetLabel of SPEEDS_TO_TEST) {
                // Cycle speed chip until label matches target (max 4 cycles
                // — defensive in case the chip starts mid-cycle from a
                // prior leftover state).
                for (let i = 0; i < 5; i++) {
                    const txt = (await speedChip.textContent())?.trim() ?? '';
                    if (txt.includes(targetLabel)) break;
                    await speedChip.tap();
                    // Brief wait for React state propagation.
                    await page.waitForTimeout(150);
                }
                await expect(speedChip).toContainText(targetLabel, { timeout: 3_000 });

                // Drain any leftover overlays before this cast. At higher
                // speeds the prior overlay may still be visible from the
                // previous iteration (it auto-removes in ~600-1500 ms).
                await expect.poll(
                    async () => await overlayLocator.count(),
                    { timeout: 3_000, intervals: [100, 250, 500] },
                ).toBe(0);

                // Wait for the skill button to be enabled (after speed
                // cycle the previous cast's cooldown may briefly linger
                // unless noCooldowns is on).
                await expect(skillBtn).toBeEnabled({ timeout: 5_000 });
                await skillBtn.tap();

                // Within 2500 ms, overlay appears with expected category
                // class. Bumped from 1500ms (solo-trainer per-class) →
                // 2500ms because at x4 the trainer tick interval drops
                // to ~125 ms which can produce a brief "blink"
                // unmount/remount cycle.
                await expect(overlayLocator.first()).toBeVisible({
                    timeout: 2_500,
                });

                // Overlay carries the emoji glyph slot.
                const overlayEmoji = overlayLocator.first().locator('.skill-anim-emoji');
                await expect(overlayEmoji).toBeVisible({ timeout: 1_500 });

                // Overlay self-removes within reasonable budget.
                // setTimeout in `useCombatFx.triggerEnemySkillAnim` clears
                // `fx.enemySkill[slot]` after `animData.duration`. We give
                // 4000 ms cushion (animData.duration is 600-1500 ms but
                // x4 speed means real wall time / 4 = 150-375 ms before
                // the clear runs, but React commit cycles + idle callbacks
                // can stretch it).
                await expect(overlayLocator.first()).toBeHidden({ timeout: 4_000 });
            }
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
