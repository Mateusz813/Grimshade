import { BaseApi } from '../BaseApi';

export interface IInventoryItem {
    id: string;
    character_id: string;
    item_id: string;
    rarity: string;
    bonuses: Record<string, number>;
    item_level: number;
    quantity: number;
    slot_index: number;
    created_at: string;
}

type TInventoryItemCreate = Omit<IInventoryItem, 'id' | 'created_at'>;

const SUPABASE_RETURN_HEADERS = { headers: { 'Prefer': 'return=representation' } };

class InventoryApi extends BaseApi {
    getInventory = async (characterId: string): Promise<IInventoryItem[]> => {
        return this.get<IInventoryItem[]>({
            url: `/rest/v1/inventory?character_id=eq.${characterId}&select=*&order=slot_index.asc`,
        });
    };

    addItem = async (characterId: string, item: TInventoryItemCreate): Promise<IInventoryItem> => {
        const data = await this.post<TInventoryItemCreate & { character_id: string }, IInventoryItem[]>({
            url: '/rest/v1/inventory',
            data: { ...item, character_id: characterId },
            config: SUPABASE_RETURN_HEADERS,
        });
        return data[0];
    };

    removeItem = async (itemId: string): Promise<void> => {
        await this.delete({
            url: `/rest/v1/inventory?id=eq.${itemId}`,
        });
    };

    updateItem = async (itemId: string, payload: Partial<IInventoryItem>): Promise<IInventoryItem> => {
        const data = await this.patch<Partial<IInventoryItem>, IInventoryItem[]>({
            url: `/rest/v1/inventory?id=eq.${itemId}`,
            data: payload,
            config: SUPABASE_RETURN_HEADERS,
        });
        return data[0];
    };
}

export const inventoryApi = new InventoryApi();
