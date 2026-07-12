
import { test, expect, type Page } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { seedConsumables } from '../../fixtures/seedInventory';
import { seedGameSave, findUserIdByEmail } from '../../fixtures/seedGameSave';
import { getAdminClient } from '../../fixtures/adminClient';
import { loginViaUI } from '../../fixtures/login';

const r12dNick = (): string => `r12d_${generateTestCharacterName().slice(0, 10)}`;

const isBuyMarketListingRpcApplied = async (): Promise<boolean> => {
    const admin = getAdminClient();
    const { error } = await admin.rpc('buy_market_listing', {
        p_listing_id: '00000000-0000-0000-0000-000000000000',
        p_buyer_character_id: '00000000-0000-0000-0000-000000000000',
        p_quantity: 1,
    });
    if (!error) return true;
    const code = (error as { code?: string }).code;
    if (code === 'PGRST202') return false;
    throw new Error(`[probe] buy_market_listing RPC probe failed: ${code ?? 'noCode'} ${error.message}`);
};

const pickCharacter = async (page: Page, nick: string): Promise<void> => {
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

test.describe('City › Market', { tag: '@city' }, () => {
    test.describe.configure({ timeout: 90_000 });

    test('regression: same listing cannot be bought twice (RPC row-lock + delete)', async ({ page }) => {
        const rpcApplied = await isBuyMarketListingRpcApplied();
        if (!rpcApplied) {
            throw new Error(
                'buy_market_listing RPC not detected — was scripts/market_buy_rpc_migration.sql' +
                ' applied? Without RPC, this regression test (and prod market buy) are broken.',
            );
        }

        const primaryNick = r12dNick();
        const secondaryNick = r12dNick();

        let primaryCharId: string | null = null;
        let secondaryCharId: string | null = null;
        let listingId: string | null = null;
        const admin = getAdminClient();

        try {
            const primaryCreated = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: primaryNick,
                class: 'Knight',
                overrides: { level: 25, highest_level: 25, hp_regen: 0, mp_regen: 0 },
            });
            primaryCharId = primaryCreated.id;
            const primaryUserId = await findUserIdByEmail(testUsers.primary.email);
            await seedGameSave({ characterId: primaryCharId, userId: primaryUserId });
            await seedConsumables({
                characterId: primaryCharId,
                counts: { hp_potion_sm: 1 },
            });

            const { data: createdRow, error: insertErr } = await admin
                .from('market_listings')
                .insert({
                    seller_id: primaryCharId,
                    seller_name: primaryNick,
                    kind: 'potion',
                    item_id: 'hp_potion_sm',
                    item_name: 'Mały Eliksir HP',
                    item_level: 1,
                    rarity: 'common',
                    slot: '',
                    price: 50,
                    quantity: 1,
                    quantity_initial: 1,
                    bonuses: {},
                    upgrade_level: 0,
                })
                .select('id')
                .single();
            if (insertErr) throw new Error(`[setup] market_listings insert failed: ${insertErr.message}`);
            listingId = createdRow.id as string;

            const secondaryCreated = await createCharacterViaApi({
                userEmail: testUsers.secondary.email,
                name: secondaryNick,
                class: 'Knight',
                overrides: { level: 25, highest_level: 25, hp_regen: 0, mp_regen: 0 },
            });
            secondaryCharId = secondaryCreated.id;
            const secondaryUserId = await findUserIdByEmail(testUsers.secondary.email);
            await seedGameSave({ characterId: secondaryCharId, userId: secondaryUserId, gold: 5000 });

            await loginViaUI(page, testUsers.secondary);
            await pickCharacter(page, secondaryNick);

            const firstBuyResult = await page.evaluate(async ({ lId, charId }) => {
                const mod = await import('/src/api/v1/marketApi.ts');
                return mod.marketApi.buyListing(lId, charId, 1);
            }, { lId: listingId, charId: secondaryCharId }) as { ok: boolean; reason?: string };
            expect(firstBuyResult.ok).toBe(true);

            const { data: postFirstBuy } = await admin
                .from('market_listings')
                .select('id')
                .eq('id', listingId);
            expect(postFirstBuy ?? []).toHaveLength(0);

            const secondBuyResult = await page.evaluate(async ({ lId, charId }) => {
                const mod = await import('/src/api/v1/marketApi.ts');
                return mod.marketApi.buyListing(lId, charId, 1);
            }, { lId: listingId, charId: secondaryCharId }) as { ok: boolean; reason?: string };
            expect(secondBuyResult.ok).toBe(false);
            expect(secondBuyResult.reason).toBe('not_found');

            const { data: postSecondBuy } = await admin
                .from('market_listings')
                .select('id')
                .eq('id', listingId);
            expect(postSecondBuy ?? []).toHaveLength(0);
        } finally {
            if (listingId) {
                await admin.from('market_listings').delete().eq('id', listingId);
            }
            const idsToWipe = [primaryCharId, secondaryCharId].filter(
                (id): id is string => id !== null,
            );
            if (idsToWipe.length > 0) {
                await Promise.all(idsToWipe.map((id) => cleanupCharacterById(id)));
            }
        }
    });
});
