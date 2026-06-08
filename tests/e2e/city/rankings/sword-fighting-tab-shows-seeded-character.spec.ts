/**
 * Atomic E2E — `/leaderboard` "Sword" tab pokazuje naszą seedowaną
 * postać z high `sword_fighting` weapon skill.
 *
 * Spec (BACKLOG 5.11): "Rankingi: każda kategoria". Rozszerzenie pokrycia
 * — Sword Fighting ranking (weapon_skill source).
 *
 * Tab definition (Leaderboard.tsx linia 136):
 *   { key: 'sword_fighting', label: 'Sword', icon: '⚔️',
 *     source: 'weapon_skill', skillName: 'sword_fighting',
 *     valueLabel: 'Sword' }
 *
 * **weapon_skill source path** (Leaderboard.tsx linia 315-348):
 *  1. GET `character_weapon_skills?skill_name=eq.sword_fighting
 *     &order=skill_level.desc,skill_xp.desc&limit=100`
 *  2. GET `characters?id=in.(...)` żeby zmatchować names+class
 *  3. Build entries: `{ id, name, class, value: skill_level,
 *     secondaryValue: skill_xp }`
 *  4. Display via formatValue fallback → `Sword 999`.
 *
 * Seed: `seedWeaponSkill({ skillName: 'sword_fighting', skillLevel: 999 })`
 * + matching `skills.skillLevels.sword_fighting=999` w game_save żeby
 * defensywnie przeżyć stray sync.
 *
 * Cleanup: try/finally + cleanupCharacterById. `character_weapon_skills`
 * jest w `CHARACTER_CHILD_TABLES` (cleanup.ts linia 84) → wipe razem
 * z postacią.
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

    test('Sword tab shows seeded character with sword_fighting=999', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            const created = await createCharacterViaApi({
                userEmail: testUsers.secondary.email,
                name: nick,
                class: 'Knight',
                overrides: { level: 1, highest_level: 1, hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            // Defensywnie seedujemy też `skills.skillLevels` w game_save —
            // gdyby stray `syncWeaponSkillsToSupabase` odpalił się po
            // wejściu na /leaderboard (np. przy character switch), DELETE+
            // INSERT przepisze tę samą wartość 999, nie blanknie 0.
            const userId = await findUserIdByEmail(testUsers.secondary.email);
            await seedGameSave({
                characterId: created.id,
                userId,
                skills: { skillLevels: { sword_fighting: 999 } },
            });

            // Insert weapon_skill row PO seedGameSave — to ta wartość którą
            // czyta Leaderboard. game_save seed służy tylko jako defense
            // w razie stray sync.
            await seedWeaponSkill({
                characterId: created.id,
                skillName: 'sword_fighting',
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

            await assertSeededRankingRow(page, {
                tabLabel: /^Sword$/,
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
