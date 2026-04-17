import { BaseApi } from '../BaseApi';

export interface IShopItem {
    id: string;
    item_id: string;
    name_pl: string;
    name_en: string;
    price: number;
    rarity: 'common' | 'rare';
    type: string;
    quantity: number | null;
}

interface IBuyItemPayload {
    character_id: string;
    item_id: string;
}

class ShopApi extends BaseApi {
    getShopItems = async (): Promise<IShopItem[]> => {
        return this.get<IShopItem[]>({
            url: '/rest/v1/shop_items?select=*',
        });
    };

    buyItem = async (characterId: string, itemId: string): Promise<void> => {
        await this.post<IBuyItemPayload, void>({
            url: '/rest/v1/rpc/buy_item',
            data: { character_id: characterId, item_id: itemId },
        });
    };
}

export const shopApi = new ShopApi();
