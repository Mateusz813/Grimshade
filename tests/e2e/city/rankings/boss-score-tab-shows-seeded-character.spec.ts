/**
 * Atomic E2E — `/leaderboard` "Boss" tab pokazuje naszą seedowaną
 * postać z high `boss_score` pseudo-skill.
 *
 * Spec (BACKLOG 5.11): "Rankingi: każda kategoria". Rozszerzenie pokrycia
 * — Boss Score ranking.
 *
 * Tab definition (Leaderboard.tsx linia 150):
 *   { key: 'boss_score', label: 'Boss', icon: '👹',
 *     source: 'weapon_skill', skillName: 'boss_score',
 *     valueLabel: 'Boss' }
 *
 * **boss_score jest PSEUDO-skillem**: nie ma osobnej tabeli, używa
 * `character_weapon_skills` z `skill_name='boss_score'` (`characterScope.ts`
 * linia 1049-1056). `skill_level` to total boss score, `skill_xp` to
 * boss kill count. Leaderboard używa weapon_skill branch identical
 * jak Sword / MLVL.
 *
 * Seed: direct INSERT do `character_weapon_skills` z skill_name='boss_score'.
 * Live `bossScoreStore` ZE STATE 0 → stray `syncWeaponSkillsToSupabase`
 * przepisałby boss_score na 0 (linia 1051: `skill_level: bossScoreState.totalScore`).
 * Read-only nav nie triggera sync, więc seedujemy JUST PRZED `page.goto('/leaderboard')`.
 *
 * Cleanup: try/finally + cleanupCharacterById (character_weapon_skills
 * w CHARACTER_CHILD_TABLES).
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { seedWeaponSkill } from '../../fixtures/seedWeaponSkill';
import { waitForAppReady } from '../../fixtures/appReady';
import { assertSeededRankingRow } from '../../fixtures/rankings';

test.describe('City › Rankings', { tag: '@city' }, () => {
    test.describe.configure({ timeout: 120_000 });

    test('Boss tab shows seeded character with boss_score=9999', async ({ page }) => {
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

            await loginViaUI(page, testUsers.secondary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 10_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });

            // Seed boss_score row JUST PRZED nav na /leaderboard — żeby
            // character switch sync (jeśli wystrzeli) nie nadpisał na 0.
            // bossScoreStore live state ZE STATE = 0 → bezpieczne TYLKO
            // po wszystkich sync-ach wynikających z character switch.
            await seedWeaponSkill({
                characterId: created.id,
                skillName: 'boss_score',
                skillLevel: 9999,
                skillXp: 100,
            });

            await page.goto('/leaderboard');
            await waitForAppReady(page);

            // valueLabel='Boss' + value=9999 → "Boss 9999" (pl-PL).
            // 9999 toLocaleString('pl-PL') daje "9999" (poniżej threshold
            // formatowania separatorem dla pl-PL przy 4-cyfrowych liczbach).
            await assertSeededRankingRow(page, {
                tabLabel: /^Boss$/,
                nick,
                value: /9.?999/,
            });
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
