/**
 * Atomic E2E — `/leaderboard` "MLVL" tab pokazuje naszą seedowaną
 * postać z high `magic_level` weapon skill.
 *
 * Spec (BACKLOG 5.11): "Rankingi: każda kategoria". Rozszerzenie pokrycia
 * — Magic Level ranking (weapon_skill source).
 *
 * Tab definition (Leaderboard.tsx linia 135):
 *   { key: 'magic_level', label: 'MLVL', icon: '🔮',
 *     source: 'weapon_skill', skillName: 'magic_level',
 *     valueLabel: 'MLvl' }
 *
 * Cross-class check vs `sword_fighting`: tu używamy **Mage**, nie Knight,
 * żeby pokryć alternative class avatar in row + alternative weapon-skill
 * key in `character_weapon_skills` insert. Mage base magic_level = 5
 * (CLASS_BASE_STATS w createCharacter.ts) — domyślny seed 999 przebija
 * każdy realny postępy w fazie projektu.
 *
 * Cleanup: try/finally + cleanupCharacterById.
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { seedWeaponSkill } from '../../fixtures/seedWeaponSkill';
import { seedGameSave, findUserIdByEmail } from '../../fixtures/seedGameSave';
import { waitForAppReady } from '../../fixtures/appReady';
import { assertSeededRankingRow } from '../../fixtures/rankings';

test.describe('City › Rankings', { tag: '@city' }, () => {
    test.describe.configure({ timeout: 120_000 });

    test('MLVL tab shows seeded Mage character with magic_level=999', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            const created = await createCharacterViaApi({
                userEmail: testUsers.secondary.email,
                name: nick,
                class: 'Mage',
                overrides: { level: 1, highest_level: 1, hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            const userId = await findUserIdByEmail(testUsers.secondary.email);
            await seedGameSave({
                characterId: created.id,
                userId,
                skills: { skillLevels: { magic_level: 999 } },
            });

            await seedWeaponSkill({
                characterId: created.id,
                skillName: 'magic_level',
                skillLevel: 999,
                skillXp: 0,
            });

            await loginViaUI(page, testUsers.secondary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 10_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });

            await page.goto('/leaderboard');
            await waitForAppReady(page);

            // valueLabel='MLvl' + value=999 → "MLvl 999"
            await assertSeededRankingRow(page, {
                tabLabel: /^MLVL$/,
                nick,
                value: /\b999\b/,
            });
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
