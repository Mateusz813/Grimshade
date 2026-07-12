
import { getAdminClient, withSupabaseRetry } from './adminClient';

type Rarity = 'common' | 'rare' | 'epic' | 'legendary' | 'mythic' | 'heroic';

interface ISeededInventoryItem {
    uuid: string;
    itemId: string;
    rarity: Rarity;
    bonuses: Record<string, number>;
    itemLevel: number;
    upgradeLevel: number;
}

export interface ISeedInventoryArgs {
    characterId: string;
    itemId: string;
    rarity?: Rarity;
    bonuses?: Record<string, number>;
    itemLevel?: number;
    upgradeLevel?: number;
}

export interface ISeededItemRef {
    uuid: string;
    itemId: string;
}


const generateItemUuid = (itemId: string): string => {
    const rand = Math.random().toString(36).slice(2, 7);
    return `${itemId}_${Date.now()}_${rand}`;
};

const findUserIdForCharacter = async (
    admin: SupabaseClient,
    characterId: string,
): Promise<string> => {
    const { data, error } = await withSupabaseRetry(
        () => admin
            .from('characters')
            .select('user_id')
            .eq('id', characterId)
            .single(),
    );
    if (error) {
        throw new Error(`[seedInventory] character lookup failed: ${error.message ?? JSON.stringify(error)}`);
    }
    if (!data) {
        throw new Error(`[seedInventory] character not found: ${characterId}`);
    }
    return data.user_id as string;
};

const buildEmptyEquipment = (): Record<string, null> => ({
    helmet: null,
    armor: null,
    pants: null,
    gloves: null,
    shoulders: null,
    boots: null,
    mainHand: null,
    offHand: null,
    ring1: null,
    ring2: null,
    earrings: null,
    necklace: null,
});

export const seedInventoryItem = async (
    args: ISeedInventoryArgs,
): Promise<ISeededItemRef> => {
    const admin = getAdminClient();
    const userId = await findUserIdForCharacter(admin, args.characterId);

    const item: ISeededInventoryItem = {
        uuid: generateItemUuid(args.itemId),
        itemId: args.itemId,
        rarity: args.rarity ?? 'common',
        bonuses: args.bonuses ?? {},
        itemLevel: args.itemLevel ?? 1,
        upgradeLevel: args.upgradeLevel ?? 0,
    };

    const { data: existing, error: selectErr } = await withSupabaseRetry(
        () => admin
            .from('game_saves')
            .select('state')
            .eq('character_id', args.characterId)
            .maybeSingle(),
    );

    if (selectErr) {
        throw new Error(`[seedInventory] select game_saves failed: ${selectErr.message ?? JSON.stringify(selectErr)}`);
    }

    const baseState: Record<string, unknown> = (existing?.state as Record<string, unknown>) ?? {};

    const inventoryRaw = baseState.inventory as Record<string, unknown> | undefined;
    const existingBag: ISeededInventoryItem[] = Array.isArray(inventoryRaw?.bag)
        ? (inventoryRaw.bag as ISeededInventoryItem[])
        : [];
    const existingEquipment = (inventoryRaw?.equipment as Record<string, ISeededInventoryItem | null> | undefined)
        ?? buildEmptyEquipment();
    const existingDeposit = (inventoryRaw?.deposit as ISeededInventoryItem[] | undefined) ?? [];
    const existingGold = typeof inventoryRaw?.gold === 'number' ? inventoryRaw.gold : 0;
    const existingConsumables = (inventoryRaw?.consumables as Record<string, number> | undefined) ?? {};
    const existingStones = (inventoryRaw?.stones as Record<string, number> | undefined) ?? {};

    const nextInventory = {
        bag: [...existingBag, item],
        equipment: existingEquipment,
        deposit: existingDeposit,
        gold: existingGold,
        consumables: existingConsumables,
        stones: existingStones,
        _entryOwner: args.characterId,
    };

    const nextState = {
        ...baseState,
        inventory: nextInventory,
        _ownerCharacterId: args.characterId,
    };

    const payload = {
        character_id: args.characterId,
        user_id: userId,
        state: nextState,
        updated_at: new Date().toISOString(),
    };

    const { error: upsertErr } = await withSupabaseRetry(
        () => admin
            .from('game_saves')
            .upsert(payload, { onConflict: 'character_id' }),
    );

    if (upsertErr) {
        throw new Error(`[seedInventory] upsert (bag) failed: ${upsertErr.message ?? JSON.stringify(upsertErr)}`);
    }

    return { uuid: item.uuid, itemId: item.itemId };
};

export interface ISeedEquippedArgs {
    characterId: string;
    slot: 'helmet' | 'armor' | 'pants' | 'gloves' | 'shoulders' | 'boots'
        | 'mainHand' | 'offHand' | 'ring1' | 'ring2' | 'earrings' | 'necklace';
    itemId: string;
    rarity?: Rarity;
    bonuses?: Record<string, number>;
    itemLevel?: number;
    upgradeLevel?: number;
}

export const seedEquippedItem = async (
    args: ISeedEquippedArgs,
): Promise<ISeededItemRef> => {
    const admin = getAdminClient();
    const userId = await findUserIdForCharacter(admin, args.characterId);

    const item: ISeededInventoryItem = {
        uuid: generateItemUuid(args.itemId),
        itemId: args.itemId,
        rarity: args.rarity ?? 'common',
        bonuses: args.bonuses ?? {},
        itemLevel: args.itemLevel ?? 1,
        upgradeLevel: args.upgradeLevel ?? 0,
    };

    const { data: existing, error: selectErr } = await withSupabaseRetry(
        () => admin
            .from('game_saves')
            .select('state')
            .eq('character_id', args.characterId)
            .maybeSingle(),
    );

    if (selectErr) {
        throw new Error(`[seedInventory] select game_saves failed: ${selectErr.message ?? JSON.stringify(selectErr)}`);
    }

    const baseState: Record<string, unknown> = (existing?.state as Record<string, unknown>) ?? {};
    const inventoryRaw = baseState.inventory as Record<string, unknown> | undefined;

    const existingBag: ISeededInventoryItem[] = Array.isArray(inventoryRaw?.bag)
        ? (inventoryRaw.bag as ISeededInventoryItem[])
        : [];
    const existingEquipment = (inventoryRaw?.equipment as Record<string, ISeededInventoryItem | null> | undefined)
        ?? buildEmptyEquipment();
    const existingDeposit = (inventoryRaw?.deposit as ISeededInventoryItem[] | undefined) ?? [];
    const existingGold = typeof inventoryRaw?.gold === 'number' ? inventoryRaw.gold : 0;
    const existingConsumables = (inventoryRaw?.consumables as Record<string, number> | undefined) ?? {};
    const existingStones = (inventoryRaw?.stones as Record<string, number> | undefined) ?? {};

    const nextInventory = {
        bag: existingBag,
        equipment: {
            ...existingEquipment,
            [args.slot]: item,
        },
        deposit: existingDeposit,
        gold: existingGold,
        consumables: existingConsumables,
        stones: existingStones,
        _entryOwner: args.characterId,
    };

    const nextState = {
        ...baseState,
        inventory: nextInventory,
        _ownerCharacterId: args.characterId,
    };

    const payload = {
        character_id: args.characterId,
        user_id: userId,
        state: nextState,
        updated_at: new Date().toISOString(),
    };

    const { error: upsertErr } = await withSupabaseRetry(
        () => admin
            .from('game_saves')
            .upsert(payload, { onConflict: 'character_id' }),
    );

    if (upsertErr) {
        throw new Error(`[seedInventory] upsert (equip) failed: ${upsertErr.message ?? JSON.stringify(upsertErr)}`);
    }

    return { uuid: item.uuid, itemId: item.itemId };
};

export interface ISeedConsumablesArgs {
    characterId: string;
    counts: Record<string, number>;
}

export const seedConsumables = async (args: ISeedConsumablesArgs): Promise<void> => {
    const admin = getAdminClient();
    const userId = await findUserIdForCharacter(admin, args.characterId);

    const { data: existing, error: selectErr } = await withSupabaseRetry(
        () => admin
            .from('game_saves')
            .select('state')
            .eq('character_id', args.characterId)
            .maybeSingle(),
    );

    if (selectErr) {
        throw new Error(`[seedInventory] select game_saves failed: ${selectErr.message ?? JSON.stringify(selectErr)}`);
    }

    const baseState: Record<string, unknown> = (existing?.state as Record<string, unknown>) ?? {};
    const inventoryRaw = baseState.inventory as Record<string, unknown> | undefined;

    const existingBag = Array.isArray(inventoryRaw?.bag) ? (inventoryRaw.bag as ISeededInventoryItem[]) : [];
    const existingEquipment = (inventoryRaw?.equipment as Record<string, ISeededInventoryItem | null> | undefined)
        ?? buildEmptyEquipment();
    const existingDeposit = (inventoryRaw?.deposit as ISeededInventoryItem[] | undefined) ?? [];
    const existingGold = typeof inventoryRaw?.gold === 'number' ? inventoryRaw.gold : 0;
    const existingConsumables = (inventoryRaw?.consumables as Record<string, number> | undefined) ?? {};
    const existingStones = (inventoryRaw?.stones as Record<string, number> | undefined) ?? {};

    const mergedConsumables = { ...existingConsumables, ...args.counts };

    const nextInventory = {
        bag: existingBag,
        equipment: existingEquipment,
        deposit: existingDeposit,
        gold: existingGold,
        consumables: mergedConsumables,
        stones: existingStones,
        _entryOwner: args.characterId,
    };

    const nextState = {
        ...baseState,
        inventory: nextInventory,
        _ownerCharacterId: args.characterId,
    };

    const payload = {
        character_id: args.characterId,
        user_id: userId,
        state: nextState,
        updated_at: new Date().toISOString(),
    };

    const { error: upsertErr } = await withSupabaseRetry(
        () => admin
            .from('game_saves')
            .upsert(payload, { onConflict: 'character_id' }),
    );

    if (upsertErr) {
        throw new Error(`[seedInventory] upsert (consumables) failed: ${upsertErr.message ?? JSON.stringify(upsertErr)}`);
    }
};

export interface ISeedInventoryResourcesArgs {
    characterId: string;
    gold?: number;
    stones?: Record<string, number>;
}

export const seedInventoryResources = async (
    args: ISeedInventoryResourcesArgs,
): Promise<void> => {
    const admin = getAdminClient();
    const userId = await findUserIdForCharacter(admin, args.characterId);

    const { data: existing, error: selectErr } = await withSupabaseRetry(
        () => admin
            .from('game_saves')
            .select('state')
            .eq('character_id', args.characterId)
            .maybeSingle(),
    );

    if (selectErr) {
        throw new Error(`[seedInventory] select game_saves failed: ${selectErr.message ?? JSON.stringify(selectErr)}`);
    }

    const baseState: Record<string, unknown> = (existing?.state as Record<string, unknown>) ?? {};
    const inventoryRaw = baseState.inventory as Record<string, unknown> | undefined;

    const existingBag: ISeededInventoryItem[] = Array.isArray(inventoryRaw?.bag)
        ? (inventoryRaw.bag as ISeededInventoryItem[])
        : [];
    const existingEquipment = (inventoryRaw?.equipment as Record<string, ISeededInventoryItem | null> | undefined)
        ?? buildEmptyEquipment();
    const existingDeposit = (inventoryRaw?.deposit as ISeededInventoryItem[] | undefined) ?? [];
    const existingGold = typeof inventoryRaw?.gold === 'number' ? inventoryRaw.gold : 0;
    const existingConsumables = (inventoryRaw?.consumables as Record<string, number> | undefined) ?? {};
    const existingStones = (inventoryRaw?.stones as Record<string, number> | undefined) ?? {};

    const nextInventory = {
        bag: existingBag,
        equipment: existingEquipment,
        deposit: existingDeposit,
        gold: args.gold ?? existingGold,
        consumables: existingConsumables,
        stones: args.stones ?? existingStones,
        _entryOwner: args.characterId,
    };

    const nextState = {
        ...baseState,
        inventory: nextInventory,
        _ownerCharacterId: args.characterId,
    };

    const payload = {
        character_id: args.characterId,
        user_id: userId,
        state: nextState,
        updated_at: new Date().toISOString(),
    };

    const { error: upsertErr } = await withSupabaseRetry(
        () => admin
            .from('game_saves')
            .upsert(payload, { onConflict: 'character_id' }),
    );

    if (upsertErr) {
        throw new Error(`[seedInventory] upsert (resources) failed: ${upsertErr.message ?? JSON.stringify(upsertErr)}`);
    }
};
