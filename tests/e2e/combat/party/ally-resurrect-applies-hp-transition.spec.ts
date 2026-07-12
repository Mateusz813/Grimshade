
import { test, expect, type Page } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { openMultiContext } from '../../fixtures/multiContext';
import { cleanupCharacterById } from '../../fixtures/cleanup';

const pickCharacterAndEnterTown = async (page: Page, nick: string): Promise<void> => {
    if (!page.url().endsWith('/character-select')) {
        await page.goto('/character-select');
    }
    await expect(page.locator('.char-select__card-name', { hasText: nick }))
        .toBeVisible({ timeout: 15_000 });
    const card = page.locator('.char-select__card', {
        has: page.locator('.char-select__card-name', { hasText: nick }),
    });
    await card.getByRole('button', { name: /Wybierz/i }).tap();
    await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
    await expect(page.locator('.town__char-name')).toHaveText(nick);
};

const getCharacterHpSnapshot = async (page: Page): Promise<{ hp: number; max_hp: number } | null> => {
    return await page.evaluate(async () => {
        const mod = await import('/src/stores/characterStore.ts');
        const c = (mod as {
            useCharacterStore: { getState: () => { character: { hp: number; max_hp: number } | null } };
        }).useCharacterStore.getState().character;
        if (!c) return null;
        return { hp: c.hp, max_hp: c.max_hp };
    });
};

const setHpDirectly = async (page: Page, hp: number): Promise<void> => {
    await page.evaluate(async (newHp) => {
        const mod = await import('/src/stores/characterStore.ts');
        const store = (mod as {
            useCharacterStore: { getState: () => { updateCharacter: (p: { hp: number }) => void } };
        }).useCharacterStore;
        store.getState().updateCharacter({ hp: newHp });
    }, hp);
};

const invokeFullHealEffective = async (page: Page): Promise<void> => {
    await page.evaluate(async () => {
        const mod = await import('/src/stores/characterStore.ts');
        const store = (mod as {
            useCharacterStore: { getState: () => { fullHealEffective: () => void } };
        }).useCharacterStore;
        store.getState().fullHealEffective();
    });
};

test.describe('Combat › Party', { tag: '@combat' }, () => {
    test.describe.configure({ timeout: 180_000 });

    test('Cleric resurrection_aura HP transition: primary at HP=0 -> fullHealEffective applies -> HP=max, secondary unaffected', async ({ browser }) => {
        const primaryNick = generateTestCharacterName();
        const secondaryNick = generateTestCharacterName();

        let primaryCharId: string | null = null;
        let secondaryCharId: string | null = null;
        let handles: Awaited<ReturnType<typeof openMultiContext>> | null = null;

        try {
            const primaryCreated = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: primaryNick,
                class: 'Knight',
                overrides: { level: 50, highest_level: 50, hp_regen: 0, mp_regen: 0 },
            });
            primaryCharId = primaryCreated.id;
            const secondaryCreated = await createCharacterViaApi({
                userEmail: testUsers.secondary.email,
                name: secondaryNick,
                class: 'Cleric',
                overrides: { level: 50, highest_level: 50, hp_regen: 0, mp_regen: 0 },
            });
            secondaryCharId = secondaryCreated.id;

            handles = await openMultiContext(browser);
            const { primaryPage, secondaryPage } = handles;

            await Promise.all([
                pickCharacterAndEnterTown(primaryPage, primaryNick),
                pickCharacterAndEnterTown(secondaryPage, secondaryNick),
            ]);

            const beforeDeath = await getCharacterHpSnapshot(primaryPage);
            expect(beforeDeath).not.toBeNull();
            expect(beforeDeath!.max_hp).toBe(742);
            expect(beforeDeath!.hp).toBe(742);

            const secondaryBefore = await getCharacterHpSnapshot(secondaryPage);
            expect(secondaryBefore).not.toBeNull();
            expect(secondaryBefore!.max_hp).toBe(450);
            expect(secondaryBefore!.hp).toBe(450);

            await setHpDirectly(primaryPage, 0);

            const downed = await getCharacterHpSnapshot(primaryPage);
            expect(downed).not.toBeNull();
            expect(downed!.hp).toBe(0);
            expect(downed!.max_hp).toBe(742);

            await invokeFullHealEffective(primaryPage);

            const revived = await getCharacterHpSnapshot(primaryPage);
            expect(revived).not.toBeNull();
            expect(revived!.hp).toBe(742);
            expect(revived!.hp).toBe(revived!.max_hp);

            const secondaryAfter = await getCharacterHpSnapshot(secondaryPage);
            expect(secondaryAfter).not.toBeNull();
            expect(secondaryAfter!.hp).toBe(450);
            expect(secondaryAfter!.max_hp).toBe(450);
        } finally {
            if (handles) {
                await handles.cleanup({ primaryCharId, secondaryCharId });
            } else {
                const idsToWipe = [primaryCharId, secondaryCharId].filter(
                    (id): id is string => id !== null,
                );
                await Promise.all(idsToWipe.map((id) => cleanupCharacterById(id)));
            }
        }
    });
});
