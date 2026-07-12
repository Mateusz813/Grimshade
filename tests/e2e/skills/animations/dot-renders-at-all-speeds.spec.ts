
import { test, expect, type Page } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { seedGameSave, findUserIdByEmail } from '../../fixtures/seedGameSave';
import { cleanupCharacterById } from '../../fixtures/cleanup';

const SKILL_ID = 'shield_bash';
const EXPECTED_CATEGORY_CLASS = 'skill-anim--physical';

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

            const autoSkillChip = page.locator('.combat-ui__chip[title="Auto skille"]');
            await expect(autoSkillChip).toBeVisible({ timeout: 5_000 });
            const wasAutoSkillOn = (await autoSkillChip.textContent())?.includes('ON');
            if (wasAutoSkillOn) {
                await autoSkillChip.tap();
                await expect(autoSkillChip).toContainText('OFF', { timeout: 3_000 });
            }

            const autoFightChip = page.locator('.combat-ui__chip[title="Auto walka"]');
            if (await autoFightChip.count() > 0) {
                const wasAutoFightOn = (await autoFightChip.textContent())?.includes('ON');
                if (wasAutoFightOn) await autoFightChip.tap();
            }

            const noCooldownChip = page.locator('.combat-ui__chip[title*="cooldowny"]');
            if (await noCooldownChip.count() > 0) {
                const wasOn = (await noCooldownChip.textContent())?.includes('ON');
                if (!wasOn) await noCooldownChip.tap();
            }

            const speedChip = page.locator('.combat-ui__chip[title="Prędkość walki"]');
            await expect(speedChip).toBeVisible({ timeout: 5_000 });

            const skillBtn = actionBar.locator(`button[aria-label="${SKILL_ID}"]`);
            await expect(skillBtn).toBeVisible({ timeout: 10_000 });

            const overlayLocator = page.locator(`.combat-ui__enemy .${EXPECTED_CATEGORY_CLASS}`);

            const SPEEDS_TO_TEST: ReadonlyArray<'X1' | 'X2' | 'X4'> = ['X1', 'X2', 'X4'];

            for (const targetLabel of SPEEDS_TO_TEST) {
                for (let i = 0; i < 5; i++) {
                    const txt = (await speedChip.textContent())?.trim() ?? '';
                    if (txt.includes(targetLabel)) break;
                    await speedChip.tap();
                    await page.waitForTimeout(150);
                }
                await expect(speedChip).toContainText(targetLabel, { timeout: 3_000 });

                await expect.poll(
                    async () => await overlayLocator.count(),
                    { timeout: 3_000, intervals: [100, 250, 500] },
                ).toBe(0);

                await expect(skillBtn).toBeEnabled({ timeout: 5_000 });
                await skillBtn.tap();

                await expect(overlayLocator.first()).toBeVisible({
                    timeout: 2_500,
                });

                const overlayEmoji = overlayLocator.first().locator('.skill-anim-emoji');
                await expect(overlayEmoji).toBeVisible({ timeout: 1_500 });

                await expect(overlayLocator.first()).toBeHidden({ timeout: 4_000 });
            }
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
