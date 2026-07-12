
import { test, expect, type Page } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { seedGameSave, findUserIdByEmail } from '../../fixtures/seedGameSave';
import { seedConsumables } from '../../fixtures/seedInventory';
import { openMultiContext } from '../../fixtures/multiContext';
import { getAdminClient } from '../../fixtures/adminClient';

const r11dNick = (): string => `r11d_${generateTestCharacterName().slice(0, 10)}`;

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
    throw new Error(`[probe] buy_market_listing RPC probe failed unexpectedly: ${code ?? 'noCode'} ${error.message}`);
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

const navToMarket = async (page: Page): Promise<void> => {
    await page.goto('/market');
    await expect(page.locator('.market')).toBeVisible({ timeout: 15_000 });
};

test.describe('City › Market', { tag: '@city' }, () => {
    test.describe.configure({ timeout: 120_000 });

    test('multi-context: primary lists hp_potion_sm -> secondary buys -> DB row removed + seller listing gone', async ({ browser }) => {
        const rpcApplied = await isBuyMarketListingRpcApplied();
        if (!rpcApplied) {
            throw new Error(
                'buy_market_listing RPC not detected — was scripts/market_buy_rpc_migration.sql' +
                ' applied? Without RPC, this market buy test (and prod buy) are broken.',
            );
        }

        const primaryNick = r11dNick();
        const secondaryNick = r11dNick();
        const LISTING_PRICE = 100;

        let primaryCharId: string | null = null;
        let secondaryCharId: string | null = null;
        let handles: Awaited<ReturnType<typeof openMultiContext>> | null = null;

        try {
            const primaryCreated = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: primaryNick,
                class: 'Knight',
                overrides: { level: 25, highest_level: 25, hp_regen: 0, mp_regen: 0 },
            });
            primaryCharId = primaryCreated.id;

            const secondaryCreated = await createCharacterViaApi({
                userEmail: testUsers.secondary.email,
                name: secondaryNick,
                class: 'Knight',
                overrides: { level: 25, highest_level: 25, hp_regen: 0, mp_regen: 0 },
            });
            secondaryCharId = secondaryCreated.id;

            const primaryUserId = await findUserIdByEmail(testUsers.primary.email);
            const secondaryUserId = await findUserIdByEmail(testUsers.secondary.email);

            await seedGameSave({ characterId: primaryCharId, userId: primaryUserId });
            await seedGameSave({ characterId: secondaryCharId, userId: secondaryUserId, gold: 5000 });

            await seedConsumables({
                characterId: primaryCharId,
                counts: { hp_potion_sm: 5 },
            });

            handles = await openMultiContext(browser);
            const { primaryPage, secondaryPage } = handles;

            await Promise.all([
                pickCharacter(primaryPage, primaryNick),
                pickCharacter(secondaryPage, secondaryNick),
            ]);
            await Promise.all([
                navToMarket(primaryPage),
                navToMarket(secondaryPage),
            ]);

            const sellTab = primaryPage.locator('.market__tab', { hasText: /^Sprzedawaj$/i });
            await expect(sellTab).toBeVisible({ timeout: 5_000 });
            await sellTab.tap();
            await expect(sellTab).toHaveClass(/market__tab--active/);

            const sellTile = primaryPage.locator('.market__sell-tile', {
                has: primaryPage.locator('.market__sell-tile-name', { hasText: 'Mały Eliksir HP' }),
            });
            await expect(sellTile).toBeVisible({ timeout: 10_000 });
            await sellTile.tap();

            const sellModal = primaryPage.locator('.market__modal').last();
            await expect(sellModal).toBeVisible({ timeout: 5_000 });

            const priceInput = sellModal.locator('input[type="number"]').last();
            await priceInput.fill(String(LISTING_PRICE));

            const sellSubmit = sellModal.locator('.market__modal-btn--confirm');
            await expect(sellSubmit).toBeEnabled({ timeout: 3_000 });
            await sellSubmit.tap();

            await expect(sellModal).toBeHidden({ timeout: 8_000 });
            await expect(primaryPage.locator('.market__toast'))
                .toContainText(/Wystawiono.*Mały Eliksir HP.*×1/i, { timeout: 5_000 });

            const admin = getAdminClient();
            const { data: createdListing, error: selErr } = await admin
                .from('market_listings')
                .select('id, price, quantity, kind, item_id, seller_id')
                .eq('seller_id', primaryCharId)
                .eq('item_id', 'hp_potion_sm')
                .single();
            if (selErr) throw new Error(`[5.7 setup] market_listings post-list select failed: ${selErr.message}`);
            expect(createdListing.price).toBe(LISTING_PRICE);
            expect(createdListing.quantity).toBe(1);
            expect(createdListing.kind).toBe('potion');

            const browseTab = secondaryPage.locator('.market__tab', { hasText: /Przeglądaj/i });
            await expect(browseTab).toBeVisible({ timeout: 5_000 });
            await browseTab.tap();
            await expect(browseTab).toHaveClass(/market__tab--active/);

            const buyRow = secondaryPage.locator('.market__row', {
                has: secondaryPage.locator('.market__row-name', { hasText: 'Mały Eliksir HP' }),
            });
            try {
                await expect(buyRow.first()).toBeVisible({ timeout: 10_000 });
            } catch {
                await secondaryPage.goto('/market');
                await expect(secondaryPage.locator('.market')).toBeVisible({ timeout: 10_000 });
                const browseAgain = secondaryPage.locator('.market__tab', { hasText: /Przeglądaj/i });
                await expect(browseAgain).toHaveClass(/market__tab--active/, { timeout: 5_000 });
                await expect(buyRow.first()).toBeVisible({ timeout: 15_000 });
            }

            await buyRow.first().tap();
            const buyModal = secondaryPage.locator('.market__modal').last();
            await expect(buyModal).toBeVisible({ timeout: 5_000 });

            const buySubmit = buyModal.locator('.market__modal-btn--confirm');
            await expect(buySubmit).toBeEnabled({ timeout: 5_000 });
            await expect(buySubmit).toContainText(/Zatwierdź/i);
            await buySubmit.tap();

            await expect(buyModal).toBeHidden({ timeout: 10_000 });
            await expect(secondaryPage.locator('.market__toast'))
                .toContainText(/Kupiono.*Mały Eliksir HP.*×1/i, { timeout: 8_000 });

            const consumablesAfter = await secondaryPage.evaluate(async () => {
                const mod = await import('/src/stores/inventoryStore.ts');
                return mod.useInventoryStore.getState().consumables;
            }) as Record<string, number>;
            expect(consumablesAfter['hp_potion_sm'] ?? 0).toBeGreaterThanOrEqual(1);

            const createdListingId = createdListing.id;
            const postBuyState = await (async () => {
                const { data } = await admin
                    .from('market_listings')
                    .select('id, quantity')
                    .eq('id', createdListingId);
                if (!data || data.length === 0) return 'gone';
                if (data[0].quantity === 0) return 'decremented-to-zero';
                return `still-exists-qty-${data[0].quantity}`;
            })();
            expect(postBuyState).toBe('gone');
        } finally {
            if (handles) {
                await handles.cleanup({ primaryCharId, secondaryCharId });
            } else {
                const { cleanupCharacterById } = await import('../../fixtures/cleanup');
                const idsToWipe = [primaryCharId, secondaryCharId].filter(
                    (id): id is string => id !== null,
                );
                if (idsToWipe.length > 0) {
                    await Promise.all(idsToWipe.map((id) => cleanupCharacterById(id)));
                }
            }
        }
    });
});
