
import { test, expect } from '@playwright/test';
import { testUsers } from '../fixtures/testUsers';
import { loginViaUI } from '../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName, type CharacterClass } from '../fixtures/createCharacter';
import { seedGameSave, findUserIdByEmail } from '../fixtures/seedGameSave';
import { cleanupCharacterById } from '../fixtures/cleanup';

interface IClassSkillUnderTest {
    cls: CharacterClass;
    skillId: string;
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
    test.describe.configure({ timeout: 60_000, mode: 'serial' });

    for (const { cls, skillId, skillNamePl } of CLASS_TIER1_SKILLS) {
        test(`${cls}: tier-1 skill "${skillNamePl}" renders in Active Skills popup`, async ({ page }) => {
            const nick = generateTestCharacterName();
            let createdId: string | null = null;

            try {
                const created = await createCharacterViaApi({
                    userEmail: testUsers.primary.email,
                    name: nick,
                    class: cls,
                    overrides: { level: 5, hp_regen: 0, mp_regen: 0 },
                });
                createdId = created.id;

                const userId = await findUserIdByEmail(testUsers.primary.email);
                await seedGameSave({
                    characterId: created.id,
                    userId,
                    skills: {
                        activeSkillSlots: [skillId, null, null, null],
                        unlockedSkills: { [skillId]: true },
                    },
                });

                await loginViaUI(page, testUsers.primary);
                await page.goto('/character-select');
                const card = page.locator('.char-select__card', {
                    has: page.locator('.char-select__card-name', { hasText: nick }),
                });
                await expect(card).toBeVisible({ timeout: 10_000 });
                await card.getByRole('button', { name: /Wybierz/i }).tap();
                await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });

                await page.goto('/inventory');
                await expect(page.locator('.inventory__paperdoll-actions'))
                    .toBeVisible({ timeout: 10_000 });
                await page.getByRole('button', { name: /^aktywne skille$/i }).tap();

                const popup = page.locator('.inventory__popup--skills');
                await expect(popup).toBeVisible({ timeout: 5_000 });

                await expect(popup.getByText('Aktywne Skille')).toBeVisible();

                const body = popup.locator('.inventory__skills-popup-body');
                await expect(body).toBeVisible();

                const slots = body.locator('.inventory__skills-slot');
                await expect(slots).toHaveCount(4);
                const firstSlot = slots.nth(0);
                await expect(firstSlot).toHaveClass(/inventory__skills-slot--filled/);
                await expect(firstSlot.locator('.inventory__skills-slot-name'))
                    .toHaveText(skillNamePl);

                const list = body.locator('.inventory__skills-list');
                await expect(list).toBeVisible();
                const cards = list.locator('.inventory__skills-card');
                const cardCount = await cards.count();
                expect(cardCount).toBeGreaterThanOrEqual(1);

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
