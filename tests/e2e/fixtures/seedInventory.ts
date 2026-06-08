/**
 * Direct-API inventory seeder via `game_saves` JSONB blob.
 *
 * Tworzy item w plecaku / w slocie eq danej postaci ZANIM test odpali
 * browser. Bez UI flow (kupowanie w sklepie, drop z walki) — szybki,
 * deterministyczny setup state pod testy Inventory / Sell / Equip.
 *
 * ## Krytyczne tło architektoniczne (do przeczytania PRZED edycją)
 *
 * App-owa warstwa storage NIE używa tabeli `inventory` ani
 * `inventoryApi.addItem`. To są legacy szczątki — bag + equipment +
 * gold + consumables + stones są serializowane do `game_saves.state`
 * jako jeden JSONB blob per-postać (patrz `src/stores/characterScope.ts`
 * → `STORE_ENTRIES['inventory']`).
 *
 * Konsekwencje:
 *  • Insert do `inventory` table = item POJAWI się w bazie ale NIE w UI.
 *    Test by się wywalił bo `.inventory__bag-tile` count = 0.
 *  • Musimy upsertować do `game_saves(character_id, user_id, state)` —
 *    state to JSONB z kluczem `inventory.bag` (array of IInventoryItem).
 *  • App przy hydration robi `applyBlobToStores` (characterScope linia 387),
 *    który WYMAGA `_ownerCharacterId === expectedCharId` — inaczej blob
 *    jest odrzucany i stores wracają do defaults (pusty bag).
 *  • Każdy entry w blob (np. `blob.inventory`) ma per-entry stamp
 *    `_entryOwner === expectedCharId` — też wymagane (linia 410).
 *
 * ## Format IInventoryItem
 *
 * Source of truth: `src/systems/itemSystem.ts` linia 216:
 *   interface IInventoryItem {
 *     uuid: string;                       // unikalny runtime ID (NIE DB id)
 *     itemId: string;                     // 'wooden_mace', 'iron_mace', etc.
 *     rarity: Rarity;                     // common | rare | epic | legendary | mythic | heroic
 *     bonuses: Record<string, number>;    // { dmg_min: 5, dmg_max: 8, hp: 20 }
 *     itemLevel: number;                  // 1..N — level skalowania
 *     upgradeLevel?: number;              // 0 = nie ulepszony, do +30
 *   }
 *
 * Common item IDs (z `src/data/items.json`):
 *  • wooden_mace, iron_mace, holy_mace, blessed_mace (mace) — Cleric
 *  • short_bow, hunting_bow, composite_bow, war_bow (bow) — Archer
 *  • wooden_sword, iron_sword, steel_sword (sword) — Knight
 *  • apprentice_staff, fire_staff, crystal_staff (staff) — Mage/Necro
 *  • rusty_dagger, steel_dagger, viper_dagger (dagger) — Rogue
 *  • lute, wooden_harp, silver_harp (harp) — Bard
 *  • wooden_shield, iron_shield (shield) — Knight off-hand
 *  • magic_book, arcane_tome — Mage off-hand
 *  • leather_cap, iron_helmet, witch_hat — helmet
 *  • leather_armor, stone_armor — armor
 *
 * Domyślny rarity: 'common'. Domyślne `bonuses: {}` (item bez bonusów),
 * `itemLevel: 1`. UUID jest generowany lokalnie — match z format z
 * `buildItem()` w itemSystem.ts (`{itemId}_{ts}_{rand5}`).
 *
 * ## Cleanup
 *
 * Inventory items giną z postacią — `game_saves` (key `character_id`)
 * jest w `CHARACTER_CHILD_TABLES` list w `cleanup.ts` (linia 77), więc
 * `cleanupCharacterById(characterId)` wyniesie cały save (z bag + eq).
 * Brak osobnego cleanup helpera dla pojedynczych itemów.
 *
 * ## Lazy admin client
 *
 * Tak jak inne fixtures — budujemy go dopiero przy pierwszym wywołaniu.
 * Import helpera bez używania go nie odpala walidacji env.
 */

// Shared admin client (cached) — patrz adminClient.ts.
import { getAdminClient, withSupabaseRetry } from './adminClient';

type Rarity = 'common' | 'rare' | 'epic' | 'legendary' | 'mythic' | 'heroic';

/**
 * Wewnętrzny interface który matchuje
 * `src/systems/itemSystem.ts` IInventoryItem. Skopiowany żeby fixture
 * nie miał deps na src/ (cyclic import risk przy budowaniu testów).
 * Jeśli IInventoryItem się zmieni w src/, ten interface też trzeba ruszyć.
 */
interface ISeededInventoryItem {
    uuid: string;
    itemId: string;
    rarity: Rarity;
    bonuses: Record<string, number>;
    itemLevel: number;
    upgradeLevel: number;
}

export interface ISeedInventoryArgs {
    /** Character ID zwrócony przez `createCharacterViaApi`. */
    characterId: string;
    /** Item ID z `src/data/items.json` (np. 'wooden_mace', 'iron_mace'). */
    itemId: string;
    /** Default 'common'. */
    rarity?: Rarity;
    /** Bonuses object: np. { dmg_min: 5, dmg_max: 8, hp: 20 }. Default {}. */
    bonuses?: Record<string, number>;
    /** Skalowanie poziomu itemu — default 1. */
    itemLevel?: number;
    /** Default 0 (no upgrade). */
    upgradeLevel?: number;
}

export interface ISeededItemRef {
    /** UUID itemu — match z `bag[i].uuid` w store po hydration. */
    uuid: string;
    /** Item ID jaki został wpisany (echo z args). */
    itemId: string;
}

// getAdminClient lives in shared `adminClient.ts` — used by all fixtures
// to share one Supabase admin SDK instance per Playwright worker process.

/** Generator UUID zgodny z formatem `buildItem()` w itemSystem.ts. */
const generateItemUuid = (itemId: string): string => {
    const rand = Math.random().toString(36).slice(2, 7);
    return `${itemId}_${Date.now()}_${rand}`;
};

/**
 * Znajduje user_id po character_id (potrzebne do upsert-u
 * `game_saves` — kolumna `user_id` jest NOT NULL).
 */
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

/**
 * Domyślny pusty equipment (12 slotów) — match z
 * `EMPTY_EQUIPMENT` w `src/systems/itemSystem.ts`.
 */
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

/**
 * Dorzuca pojedynczy item do `inventory.bag` w `game_saves` blob-ie.
 *
 * Jeśli `game_saves` row dla tej postaci jeszcze nie istnieje (świeża
 * postać bez save-u) — tworzy nowy blob z defaults dla wszystkich
 * stores + nasz item. Jeśli już istnieje — wczytuje state, push-uje
 * item do `inventory.bag` i upsert-uje z powrotem.
 *
 * Zwraca `{ uuid, itemId }` — uuid pozwala testowi referencować item
 * po hydration (np. żeby kliknąć konkretny tile).
 *
 * @example
 * const item = await seedInventoryItem({
 *   characterId: created.id,
 *   itemId: 'iron_mace',
 *   rarity: 'common',
 *   bonuses: { dmg_min: 12, dmg_max: 14 },
 * });
 * // ... test loguje się, otwiera /inventory, kliknie tile o uuid item.uuid
 */
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

    // Pobierz istniejący save (jeśli istnieje) — tylko `state`.
    // characterScope dotyka 17 store-ów; nie chcemy zmieniać innych
    // wartości jeśli były już zapisane (settings, skills, etc.).
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

    // Bazowy state — albo z istniejącego row-a, albo świeży minimal
    // blob (tylko inventory + owner stamps). Pozostałe store-y na
    // defaults sa wystarczające bo `applyBlobToStores` robi
    // `resetStoresToDefaults` PRZED apply.
    const baseState: Record<string, unknown> = (existing?.state as Record<string, unknown>) ?? {};

    // Wyciągnij istniejący inventory slice albo pusty defaults.
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

    // Nowy inventory slice z dorzuconym item-em.
    // `_entryOwner` MUSI = characterId żeby `applyBlobToStores` nie
    // odrzucił sliceu (linia 411 characterScope.ts).
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
        // `_ownerCharacterId` MUSI = characterId żeby cały blob nie
        // został odrzucony przez `applyBlobToStores` (linia 394).
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

/**
 * Wkłada item bezpośrednio w slot equipment (z pominięciem bag-a).
 * Użyteczne dla testów typu "equip display" gdzie chcemy żeby przedmiot
 * od razu był w slocie + paperdoll go pokazał.
 *
 * UWAGA: equip nie robi delta HP/MP od bonusów — to robi runtime gdy
 * gracz klika `Załóż`. Jeśli test asertuje na HP delta od founda
 * `bonuses.hp`, musisz albo:
 *  (a) seedować item do bag i przejść przez equip flow w UI, albo
 *  (b) ręcznie ustawić `characters.max_hp` na docelową wartość.
 *
 * Cele zwykłego użycia tego helpera: weryfikacja że paperdoll JSX
 * renderuje ikonę w `inventory__doll-slot--<slot>--filled`.
 */
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

/**
 * Dorzuca consumables (potiony, eliksiry, spell chests, kamienie) do
 * `inventory.consumables` w `game_saves` blob-ie.
 *
 * Consumables to flat `Record<string, number>` (id → count). UI czyta
 * z `consumables[id]` żeby pokazać licznik w plecaku / w popupie
 * Auto-Potion / w Alchemia tabie / w shop tile-ach.
 *
 * Merge logic — przekazane id-ki nadpisują istniejące (per-id), zachowując
 * inne id-ki których seed nie dotknął (np. spell chesty z poprzednich
 * test calls). Każda wartość = bezwzględna liczba do USTAWIENIA dla danego
 * id (nie delta) — częstszy use case dla testów (np. "dokladnie 5
 * hp_potion_md" niezależnie od czego inne calle dorobiły).
 *
 * Jeśli postać nie ma jeszcze save-u — tworzy świeży minimal blob ze
 * stamps `_ownerCharacterId` + `_entryOwner` (analogicznie do
 * seedInventoryItem / seedEquippedItem).
 *
 * @example
 * await seedConsumables({
 *   characterId: created.id,
 *   counts: { hp_potion_md: 20, mp_potion_sm: 10 },
 * });
 * // Po hydration: consumables[hp_potion_md] === 20, [mp_potion_sm] === 10.
 */
export interface ISeedConsumablesArgs {
    characterId: string;
    /** id → exact count to set (NIE delta). */
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

    // Per-id merge — passed counts override existing, ale nie ruszamy id-ków
    // których test nie dotknął.
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

/**
 * Patch the per-character `inventory` slice in `game_saves` with extra
 * resources (gold, stones) WITHOUT touching the bag / equipment / deposit
 * that previous seed calls already wrote. Designed to layer on top of
 * `seedInventoryItem` / `seedEquippedItem` for tests that need both a
 * specific item AND a stockpile of stones or gold for upgrade flows.
 *
 * Why separate from seedConsumables: stones are stored under
 * `inventory.stones` (separate map from consumables), and gold is its
 * own scalar. Test code is clearer when "I need 1 stone + 100 gold"
 * = one helper call, not two reaching into different keys.
 *
 * Behaviour:
 *  • If `gold` is provided → REPLACES existing gold (not delta).
 *  • If `stones` is provided → REPLACES existing stones map (not merge).
 *  • Both undefined → no-op write that re-stamps owner ids (harmless).
 *
 * @example
 * await seedInventoryItem({ characterId, itemId: 'iron_helmet' });
 * await seedInventoryResources({
 *   characterId,
 *   gold: 1000,
 *   stones: { common_stone: 5 },
 * });
 */
export interface ISeedInventoryResourcesArgs {
    characterId: string;
    /** Override the gold pool. Pass undefined to leave untouched. */
    gold?: number;
    /** Override the stones map (stoneId → count). Pass undefined to leave untouched. */
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
