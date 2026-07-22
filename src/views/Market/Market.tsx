import { useState, useMemo, useEffect, useCallback, type CSSProperties } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { AnimatePresence, motion } from 'framer-motion';
import { useCharacterStore } from '../../stores/characterStore';
import { useInventoryStore, MAX_BAG_SIZE } from '../../stores/inventoryStore';
import { useMarketStore } from '../../stores/marketStore';
import { ELIXIRS } from '../../stores/shopStore';
import {
    sortListings,
    filterByCategory,
    filterByRarity,
    filterByLevelRange,
    filterByName,
    isValidPrice,
    isValidQuantity,
    isStackKind,
    type IMarketListing,
    type IMarketSaleNotification,
    type MarketSortBy,
    type MarketFilterCategory,
    type MarketKind,
} from '../../systems/marketSystem';
import {
    RARITY_COLORS,
    findBaseItem,
    flattenItemsData,
    formatItemName,
    getItemIcon,
    getItemSlotSafe,
    STONE_NAMES,
    STONE_ICONS,
    type Rarity,
    type IInventoryItem,
} from '../../systems/itemSystem';
import itemsRaw from '../../data/items.json';
import { formatGoldShort } from '../../systems/goldFormat';
import {
    getItemImage,
    getConsumableImage,
    getStoneImage,
    getSpellChestImage,
} from '../../systems/spriteAssets';
import { SPELL_CHEST_LEVELS } from '../../systems/skillSystem';
import { getItemDisplayInfo } from '../../systems/itemGenerator';
import TinyIcon from '../../components/ui/TinyIcon/TinyIcon';
import GameIcon from '../../components/atoms/Twemoji/GameIcon';
import Icon from '../../components/atoms/Icon/Icon';
import { isBackendMode } from '../../config/backendMode';
import { backendApi } from '../../api/backend/backendApi';
import { syncFromBackend } from '../../api/backend/syncState';
import './Market.scss';

const ALL_ITEMS = flattenItemsData(itemsRaw as Parameters<typeof flattenItemsData>[0]);

type MarketTab = 'browse' | 'sell' | 'my';

const PAGE_SIZE = 50;

const CATEGORY_OPTIONS: { value: MarketFilterCategory; label: string; iconKind: 'item' | 'potion' | 'elixir' | 'stone' | 'arena' | 'all' }[] = [
    { value: 'all',           label: 'Wszystkie',     iconKind: 'all' },
    { value: 'mainHand',      label: 'Główna',        iconKind: 'item' },
    { value: 'offHand',       label: 'Pomocnicza',    iconKind: 'item' },
    { value: 'helmet',        label: 'Hełm',          iconKind: 'item' },
    { value: 'shoulders',     label: 'Naramienniki',  iconKind: 'item' },
    { value: 'armor',         label: 'Zbroja',        iconKind: 'item' },
    { value: 'gloves',        label: 'Rękawice',      iconKind: 'item' },
    { value: 'pants',         label: 'Spodnie',       iconKind: 'item' },
    { value: 'boots',         label: 'Buty',          iconKind: 'item' },
    { value: 'necklace',      label: 'Naszyjnik',     iconKind: 'item' },
    { value: 'earrings',      label: 'Kolczyki',      iconKind: 'item' },
    { value: 'ring',          label: 'Pierścień',     iconKind: 'item' },
    { value: 'potions',       label: 'Potiony',       iconKind: 'potion' },
    { value: 'elixirs',       label: 'Eliksiry',      iconKind: 'elixir' },
    { value: 'stones',        label: 'Kamienie',      iconKind: 'stone' },
    { value: 'arena_points',  label: 'Punkty Areny',  iconKind: 'arena' },
    { value: 'spell_chests',  label: 'Spell Chesty',  iconKind: 'all' },
];

const SORT_OPTIONS: { value: MarketSortBy; label: string }[] = [
    { value: 'newest',     label: 'Najnowsze' },
    { value: 'price_asc',  label: 'Cena rosnąco' },
    { value: 'price_desc', label: 'Cena malejąco' },
    { value: 'level_asc',  label: 'Lvl rosnąco' },
    { value: 'level_desc', label: 'Lvl malejąco' },
];

const RARITY_OPTIONS: { value: Rarity | 'all'; label: string }[] = [
    { value: 'all',       label: 'Wszystkie' },
    { value: 'common',    label: 'Common' },
    { value: 'rare',      label: 'Rare' },
    { value: 'epic',      label: 'Epic' },
    { value: 'legendary', label: 'Legendary' },
    { value: 'mythic',    label: 'Mythic' },
    { value: 'heroic',    label: 'Heroic' },
];

const isPotionId = (id: string): boolean => id.startsWith('hp_potion_') || id.startsWith('mp_potion_');

const CONSUMABLE_ALIASES: Record<string, string> = {
    xp_elixir:            'xp_boost',
    skill_xp_elixir:      'skill_xp_boost',
    premium_xp_elixir:    'premium_xp_boost',
    cooldown_elixir:      'cd_reduction_elixir',
    hp_sm:                'hp_potion_sm',
    hp_md:                'hp_potion_md',
    hp_lg:                'hp_potion_lg',
    hp_great:             'hp_potion_great',
    mp_sm:                'mp_potion_sm',
    mp_md:                'mp_potion_md',
    mp_lg:                'mp_potion_lg',
    mp_great:             'mp_potion_great',
};
const aliasConsumableId = (id: string): string => CONSUMABLE_ALIASES[id] ?? id;

const consumableKind = (id: string): MarketKind =>
    (isPotionId(aliasConsumableId(id)) ? 'potion' : 'elixir');

const consumableName = (id: string): string => {
    const aliased = aliasConsumableId(id);
    const e = ELIXIRS.find((x) => x.id === aliased);
    return e?.name_pl ?? id;
};

const consumableIcon = (id: string): string =>
    getConsumableImage(aliasConsumableId(id)) ?? 'test-tube';

const consumableRarity = (id: string): Rarity => {
    const x = aliasConsumableId(id);
    if (x === 'premium_xp_boost') return 'heroic';
    if (x.endsWith('_100') || x.includes('_divine') || x.includes('_ultimate')) return 'mythic';
    if (x.includes('_super') || x.includes('_great') || x.includes('_mega')) return 'legendary';
    if (x.includes('boost') || x.includes('elixir') || x === 'utamo_vita') return 'epic';
    if (x.endsWith('_lg') || x.endsWith('_md')) return 'rare';
    return 'common';
};

const isSpellChestId = (id: string): boolean => id.startsWith('spell_chest_');
const parseSpellChestLevel = (id: string): number => {
    const n = parseInt(id.replace('spell_chest_', ''), 10);
    return Number.isFinite(n) && n > 0 ? n : (SPELL_CHEST_LEVELS[0] ?? 5);
};
const CHEST_LEVEL_TO_TIER: Record<number, number> = {
    5: 1, 10: 2, 20: 3, 30: 4, 40: 5, 50: 6, 60: 7, 70: 8,
    80: 9, 100: 10, 150: 11, 300: 12, 600: 13, 800: 14, 1000: 15,
};
const CHEST_TIER_RARITY: Record<number, Rarity> = {
    1: 'common',  2: 'common',    3: 'common',  4: 'common',
    5: 'rare',    6: 'rare',      7: 'rare',    8: 'rare',
    9: 'epic',    10: 'epic',
    11: 'legendary', 12: 'legendary',
    13: 'mythic', 14: 'mythic',
    15: 'heroic',
};
const spellChestRarity = (level: number): Rarity => {
    const tier = CHEST_LEVEL_TO_TIER[level] ?? 15;
    return CHEST_TIER_RARITY[tier] ?? 'common';
};

const isStoneId = (id: string): boolean => id.endsWith('_stone');

const cleanItemName = (itemId: string): string => {
    const gen = getItemDisplayInfo(itemId);
    if (gen?.name_pl) return gen.name_pl;
    const base = findBaseItem(itemId, ALL_ITEMS);
    if (base?.name_pl) return base.name_pl;
    return formatItemName(itemId)
        .replace(/\s+Lvl\d+\s+\w+$/i, '')
        .trim();
};

const STAT_LABEL: Record<string, string> = {
    attack: 'ATK',
    defense: 'DEF',
    hp: 'HP',
    mp: 'MP',
    speed: 'SPD',
    critChance: 'CRIT %',
    dmg_min: 'DMG MIN',
    dmg_max: 'DMG MAX',
};

const STAT_ORDER = [
    'dmg_min', 'dmg_max', 'hp', 'attack', 'defense', 'mp', 'speed', 'critChance',
];

const formatBonusEntries = (
    bonuses: Record<string, number>,
): Array<{ key: string; label: string; value: number }> =>
    STAT_ORDER
        .filter((k) => (bonuses?.[k] ?? 0) > 0)
        .map((k) => ({ key: k, label: STAT_LABEL[k] ?? k, value: bonuses[k] }));

const detectKindFromId = (itemId: string): MarketKind => {
    if (itemId === 'arena_points') return 'arena_points';
    if (isStoneId(itemId)) return 'stone';
    if (isSpellChestId(itemId)) return 'spell_chest';
    const aliased = aliasConsumableId(itemId);
    if (aliased.startsWith('hp_potion_') || aliased.startsWith('mp_potion_')) return 'potion';
    if (ELIXIRS.some((e) => e.id === aliased)) return 'elixir';
    return 'item';
};

const resolveListingIcon = (itemId: string, kind: MarketKind, slot?: string): string => {
    if (kind === 'item') {
        return getItemImage(itemId, slot) ?? getItemIcon(itemId, slot ?? '', ALL_ITEMS);
    }
    if (kind === 'potion' || kind === 'elixir') {
        return getConsumableImage(aliasConsumableId(itemId)) ?? 'test-tube';
    }
    if (kind === 'stone') return getStoneImage(itemId) ?? 'gem-stone';
    if (kind === 'arena_points') return 'sports-medal';
    if (kind === 'spell_chest') {
        return getSpellChestImage(parseSpellChestLevel(itemId)) ?? 'package';
    }
    return 'package';
};

const resolveListingName = (itemId: string, kind: MarketKind, fallback: string): string => {
    if (kind === 'stone') return STONE_NAMES[itemId] ?? fallback;
    if (kind === 'potion' || kind === 'elixir') {
        const aliased = aliasConsumableId(itemId);
        const e = ELIXIRS.find((x) => x.id === aliased);
        return e?.name_pl ?? fallback;
    }
    if (kind === 'arena_points') return 'Punkty Areny';
    if (kind === 'spell_chest') return `Spell Chest Lv ${parseSpellChestLevel(itemId)}`;
    return cleanItemName(itemId);
};


const RARITY_VALUES: Rarity[] = ['common', 'rare', 'epic', 'legendary', 'mythic', 'heroic'];
const MARKET_KIND_VALUES: MarketKind[] = ['item', 'potion', 'elixir', 'stone', 'arena_points', 'spell_chest'];

const asString = (v: unknown, fallback = ''): string =>
    (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : fallback);

const asNumber = (v: unknown, fallback = 0): number => {
    const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
    return Number.isFinite(n) ? n : fallback;
};

const asRarity = (v: unknown): Rarity =>
    (typeof v === 'string' && (RARITY_VALUES as string[]).includes(v) ? (v as Rarity) : 'common');

const asKind = (v: unknown): MarketKind =>
    (typeof v === 'string' && (MARKET_KIND_VALUES as string[]).includes(v) ? (v as MarketKind) : 'item');

const asBonuses = (v: unknown): Record<string, number> => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    const out: Record<string, number> = {};
    for (const [k, raw] of Object.entries(v as Record<string, unknown>)) {
        const n = typeof raw === 'number' ? raw : Number(raw);
        if (Number.isFinite(n)) out[k] = n;
    }
    return out;
};

const normalizeBackendListing = (raw: unknown): IMarketListing | null => {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    const pick = (...keys: string[]): unknown => {
        for (const k of keys) {
            const val = o[k];
            if (val !== undefined && val !== null) return val;
        }
        return undefined;
    };
    const id = asString(pick('id', 'listingId', 'listing_id'));
    if (!id) return null;
    const quantity = Math.max(1, asNumber(pick('quantity', 'qty', 'quantityRemaining', 'quantity_remaining'), 1));
    const quantityInitial = Math.max(quantity, asNumber(pick('quantityInitial', 'quantity_initial'), quantity));
    return {
        id,
        sellerId: asString(pick('sellerId', 'seller_id', 'sellerCharacterId', 'seller_character_id')),
        sellerName: asString(pick('sellerName', 'seller_name'), '—'),
        kind: asKind(pick('kind')),
        itemId: asString(pick('itemId', 'item_id')),
        itemName: asString(pick('itemName', 'item_name'), 'Przedmiot'),
        itemLevel: Math.max(1, asNumber(pick('itemLevel', 'item_level'), 1)),
        rarity: asRarity(pick('rarity')),
        slot: asString(pick('slot')),
        price: Math.max(0, asNumber(pick('price'), 0)),
        quantity,
        quantityInitial,
        bonuses: asBonuses(pick('bonuses')),
        upgradeLevel: Math.max(0, asNumber(pick('upgradeLevel', 'upgrade_level'), 0)),
        listedAt: asString(pick('listedAt', 'listed_at', 'createdAt', 'created_at')),
    };
};

const normalizeBackendListings = (raw: unknown): IMarketListing[] => {
    const arr = Array.isArray(raw)
        ? raw
        : raw && typeof raw === 'object'
            ? (raw as Record<string, unknown>).data
              ?? (raw as Record<string, unknown>).listings
              ?? (raw as Record<string, unknown>).items
            : undefined;
    if (!Array.isArray(arr)) return [];
    const out: IMarketListing[] = [];
    for (const r of arr) {
        const n = normalizeBackendListing(r);
        if (n) out.push(n);
    }
    return out;
};


interface IMarketProps { embedded?: boolean }

const Market = ({ embedded = false }: IMarketProps) => {
    const character = useCharacterStore((s) => s.character);
    const bag = useInventoryStore((s) => s.bag);
    const consumables = useInventoryStore((s) => s.consumables);
    const stones = useInventoryStore((s) => s.stones);
    const arenaPoints = useInventoryStore((s) => s.arenaPoints);
    const gold = useInventoryStore((s) => s.gold);
    const inv = useInventoryStore;

    const {
        listings, myListings, saleNotifications, error,
        fetchListings, fetchMyListings, fetchSaleNotifications,
        listItem, editListing, cancelListing, buyListing,
        dismissNotification, clearError,
    } = useMarketStore(useShallow((s) => ({ listings: s.listings, myListings: s.myListings, saleNotifications: s.saleNotifications, error: s.error, fetchListings: s.fetchListings, fetchMyListings: s.fetchMyListings, fetchSaleNotifications: s.fetchSaleNotifications, listItem: s.listItem, editListing: s.editListing, cancelListing: s.cancelListing, buyListing: s.buyListing, dismissNotification: s.dismissNotification, clearError: s.clearError })));

    useEffect(() => {
        void fetchListings();
        if (character) {
            void fetchMyListings(character.id);
            void fetchSaleNotifications(character.id);
        }
    }, [fetchListings, fetchMyListings, fetchSaleNotifications, character]);

    useEffect(() => {
        if (!character) return;
        const id = setInterval(() => {
            void fetchSaleNotifications(character.id);
        }, 30_000);
        return () => clearInterval(id);
    }, [character, fetchSaleNotifications]);

    const [backendListings, setBackendListings] = useState<IMarketListing[]>([]);
    const [backendMyListings, setBackendMyListings] = useState<IMarketListing[]>([]);

    const refreshBackendMarket = useCallback(async () => {
        if (!isBackendMode()) return;
        try {
            const all = await backendApi.marketListings();
            setBackendListings(normalizeBackendListings(all));
        } catch (e) {
            console.warn('[market] marketListings failed', e);
        }
        if (character) {
            try {
                const mine = await backendApi.marketMine(character.id);
                setBackendMyListings(normalizeBackendListings(mine));
            } catch (e) {
                console.warn('[market] marketMine failed', e);
            }
        }
    }, [character]);

    useEffect(() => {
        void refreshBackendMarket();
    }, [refreshBackendMarket]);

    const backendMode = isBackendMode();
    const sourceListings = backendMode ? backendListings : listings;
    const sourceMyListings = backendMode ? backendMyListings : myListings;

    const [tab, setTab] = useState<MarketTab>('browse');

    const [category, setCategory] = useState<MarketFilterCategory>('all');
    const [rarityFilter, setRarityFilter] = useState<Rarity | 'all'>('all');
    const [sortBy, setSortBy] = useState<MarketSortBy>('newest');
    const [search, setSearch] = useState('');
    const [minLevel, setMinLevel] = useState(1);
    const [maxLevel, setMaxLevel] = useState(1000);
    const [page, setPage] = useState(1);

    useEffect(() => { setPage(1); }, [category, rarityFilter, sortBy, search, minLevel, maxLevel, tab]);

    const [buyTarget, setBuyTarget] = useState<IMarketListing | null>(null);
    const [sellTarget, setSellTarget] = useState<{
        kind: MarketKind;
        bagItem?: IInventoryItem;
        consumableId?: string;
        stoneId?: string;
        isArenaPoints?: boolean;
        name: string;
        rarity: Rarity;
        icon: string;
        slot: string;
        itemLevel: number;
        bonuses: Record<string, number>;
        upgradeLevel: number;
        maxQty: number;
    } | null>(null);
    const [editTarget, setEditTarget] = useState<IMarketListing | null>(null);
    const [showNotifications, setShowNotifications] = useState(false);
    const [toast, setToast] = useState<string | null>(null);

    const showToast = (msg: string) => {
        setToast(msg);
        setTimeout(() => setToast(null), 2500);
    };

    const dedupeById = useCallback((items: IMarketListing[]): IMarketListing[] => {
        const seen = new Set<string>();
        const out: IMarketListing[] = [];
        for (const l of items) {
            if (!l.id || seen.has(l.id)) continue;
            seen.add(l.id);
            out.push(l);
        }
        return out;
    }, []);
    const applyFilters = useCallback((items: IMarketListing[]): IMarketListing[] => {
        let r = dedupeById(items);
        r = filterByCategory(r, category);
        r = filterByRarity(r, rarityFilter);
        r = filterByLevelRange(r, minLevel, maxLevel);
        r = filterByName(r, search);
        return sortListings(r, sortBy);
    }, [dedupeById, category, rarityFilter, minLevel, maxLevel, search, sortBy]);

    const filteredBrowse = useMemo(() => applyFilters(sourceListings), [sourceListings, applyFilters]);
    const filteredMy = useMemo(() => applyFilters(sourceMyListings), [sourceMyListings, applyFilters]);

    const pagedBrowse = useMemo(() => {
        const start = (page - 1) * PAGE_SIZE;
        return filteredBrowse.slice(start, start + PAGE_SIZE);
    }, [filteredBrowse, page]);
    const pagedMy = useMemo(() => {
        const start = (page - 1) * PAGE_SIZE;
        return filteredMy.slice(start, start + PAGE_SIZE);
    }, [filteredMy, page]);

    const totalBrowsePages = Math.max(1, Math.ceil(filteredBrowse.length / PAGE_SIZE));
    const totalMyPages = Math.max(1, Math.ceil(filteredMy.length / PAGE_SIZE));

    interface ISellTile {
        key: string;
        kind: MarketKind;
        name: string;
        rarity: Rarity;
        icon: string;
        slot: string;
        itemLevel: number;
        bonuses: Record<string, number>;
        upgradeLevel: number;
        maxQty: number;
        bagItem?: IInventoryItem;
        consumableId?: string;
        stoneId?: string;
        isArenaPoints?: boolean;
    }

    const sellTiles = useMemo<ISellTile[]>(() => {
        const out: ISellTile[] = [];
        for (const item of bag) {
            const slot = getItemSlotSafe(item.itemId, ALL_ITEMS) ?? '';
            const name = cleanItemName(item.itemId);
            const png = getItemImage(item.itemId, slot);
            out.push({
                key: `bag_${item.uuid}`,
                kind: 'item',
                name,
                rarity: item.rarity,
                icon: png ?? getItemIcon(item.itemId, slot, ALL_ITEMS),
                slot,
                itemLevel: item.itemLevel || 1,
                bonuses: item.bonuses,
                upgradeLevel: item.upgradeLevel ?? 0,
                maxQty: 1,
                bagItem: item,
            });
        }
        for (const [id, count] of Object.entries(consumables)) {
            if ((count ?? 0) <= 0) continue;
            if (isSpellChestId(id)) {
                const lvl = parseSpellChestLevel(id);
                out.push({
                    key: `cons_${id}`,
                    kind: 'spell_chest',
                    name: `Spell Chest Lv ${lvl}`,
                    rarity: spellChestRarity(lvl),
                    icon: getSpellChestImage(lvl) ?? 'package',
                    slot: '',
                    itemLevel: lvl,
                    bonuses: {},
                    upgradeLevel: 0,
                    maxQty: count ?? 0,
                    consumableId: id,
                });
                continue;
            }
            if (isStoneId(id)) {
                const tier = id.split('_')[0] as Rarity;
                out.push({
                    key: `cons_${id}`,
                    kind: 'stone',
                    name: STONE_NAMES[id] ?? id,
                    rarity: (['common','rare','epic','legendary','mythic','heroic'] as Rarity[]).includes(tier) ? tier : 'common',
                    icon: getStoneImage(id) ?? STONE_ICONS[id] ?? 'gem-stone',
                    slot: '',
                    itemLevel: 1,
                    bonuses: {},
                    upgradeLevel: 0,
                    maxQty: count ?? 0,
                    consumableId: id,
                });
                continue;
            }
            out.push({
                key: `cons_${id}`,
                kind: consumableKind(id),
                name: consumableName(id),
                rarity: consumableRarity(id),
                icon: consumableIcon(id),
                slot: '',
                itemLevel: 1,
                bonuses: {},
                upgradeLevel: 0,
                maxQty: count ?? 0,
                consumableId: id,
            });
        }
        for (const [id, count] of Object.entries(stones)) {
            if ((count ?? 0) <= 0) continue;
            const tier = id.split('_')[0] as Rarity;
            out.push({
                key: `stone_${id}`,
                kind: 'stone',
                name: STONE_NAMES[id] ?? id,
                rarity: (['common','rare','epic','legendary','mythic','heroic'] as Rarity[]).includes(tier) ? tier : 'common',
                icon: getStoneImage(id) ?? STONE_ICONS[id] ?? 'gem-stone',
                slot: '',
                itemLevel: 1,
                bonuses: {},
                upgradeLevel: 0,
                maxQty: count ?? 0,
                stoneId: id,
            });
        }
        if (arenaPoints > 0) {
            out.push({
                key: 'ap',
                kind: 'arena_points',
                name: 'Punkty Areny',
                rarity: 'legendary',
                icon: 'sports-medal',
                slot: '',
                itemLevel: 1,
                bonuses: {},
                upgradeLevel: 0,
                maxQty: arenaPoints,
                isArenaPoints: true,
            });
        }
        return out;
    }, [bag, consumables, stones, arenaPoints]);

    const filteredSellTiles = useMemo(() => {
        const q = search.trim().toLowerCase();
        return sellTiles.filter((t) => {
            if (category !== 'all') {
                if (category === 'potions') { if (t.kind !== 'potion') return false; }
                else if (category === 'elixirs') { if (t.kind !== 'elixir') return false; }
                else if (category === 'stones') { if (t.kind !== 'stone') return false; }
                else if (category === 'arena_points') { if (t.kind !== 'arena_points') return false; }
                else if (category === 'spell_chests') { if (t.kind !== 'spell_chest') return false; }
                else if (category === 'ring') { if (t.slot !== 'ring1' && t.slot !== 'ring2') return false; }
                else { if (t.slot !== category) return false; }
            }
            if (rarityFilter !== 'all' && t.rarity !== rarityFilter) return false;
            if (t.itemLevel < minLevel || t.itemLevel > maxLevel) return false;
            if (q && !t.name.toLowerCase().includes(q)) return false;
            return true;
        });
    }, [sellTiles, category, rarityFilter, minLevel, maxLevel, search]);

    const pagedSellTiles = useMemo(() => {
        const start = (page - 1) * PAGE_SIZE;
        return filteredSellTiles.slice(start, start + PAGE_SIZE);
    }, [filteredSellTiles, page]);
    const totalSellPages = Math.max(1, Math.ceil(filteredSellTiles.length / PAGE_SIZE));

    const handleConfirmBuy = async (qty: number) => {
        if (isBackendMode() && character && buyTarget) {
            try {
                await backendApi.marketBuy(character.id, buyTarget.id);
                await syncFromBackend(character.id);
                await refreshBackendMarket();
                showToast(`Kupiono: ${buyTarget.itemName}`);
                setBuyTarget(null);
                return;
            } catch (e) {
                console.warn('[market] marketBuy failed', e);
                showToast('Nie udało się kupić (backend).');
                return;
            }
        }
        if (!buyTarget || !character) return;
        const total = buyTarget.price * qty;
        if (gold < total) { showToast('Za mało złota!'); return; }
        if (buyTarget.kind === 'item' && bag.length >= MAX_BAG_SIZE) {
            showToast('Plecak pełny!'); return;
        }
        clearError();
        const result = await buyListing(buyTarget.id, qty);
        if (!result) {
            const msg = useMarketStore.getState().error ?? 'Nie udało się kupić.';
            showToast(msg);
            return;
        }
        inv.getState().spendGold(total);
        if (result.listing.kind === 'item') {
            inv.getState().restoreItem({
                uuid: `mkt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                itemId: result.listing.itemId,
                rarity: result.listing.rarity,
                bonuses: result.listing.bonuses,
                itemLevel: result.listing.itemLevel,
                upgradeLevel: result.listing.upgradeLevel,
            });
        } else if (result.listing.kind === 'potion' || result.listing.kind === 'elixir') {
            inv.getState().addConsumable(result.listing.itemId, qty);
        } else if (result.listing.kind === 'stone') {
            inv.getState().addStones(result.listing.itemId, qty);
        } else if (result.listing.kind === 'arena_points') {
            inv.getState().addArenaPoints(qty);
        } else if (result.listing.kind === 'spell_chest') {
            inv.getState().addConsumable(result.listing.itemId, qty);
        }
        showToast(`Kupiono: ${result.listing.itemName} ×${qty}`);
        if (character) {
          void import('../../api/v1/characterApi').then(({ characterApi }) => {
            void characterApi.bumpStat({
              characterId: character.id,
              column: 'market_items_bought',
              value: qty,
              mode: 'add',
            });
            void characterApi.bumpStat({
              characterId: character.id,
              column: 'market_gold_spent',
              value: total,
              mode: 'add',
            });
            const sellerId = result.listing.sellerId;
            if (sellerId && sellerId !== character.id) {
              void characterApi.bumpMarketSaleRpc({
                sellerCharacterId: sellerId,
                quantity: qty,
                goldAmount: total,
              });
            }
          }).catch(() => { });
        }
        setBuyTarget(null);
    };

    const handleConfirmSell = async (price: number, qty: number) => {
        if (isBackendMode() && character && sellTarget) {
            if (!isValidPrice(price)) { showToast('Nieprawidłowa cena!'); return; }
            if (!isValidQuantity(qty, sellTarget.maxQty)) { showToast('Nieprawidłowa ilość!'); return; }
            let beItemId = '';
            if (sellTarget.bagItem) beItemId = sellTarget.bagItem.itemId;
            else if (sellTarget.consumableId) beItemId = sellTarget.consumableId;
            else if (sellTarget.stoneId) beItemId = sellTarget.stoneId;
            else if (sellTarget.isArenaPoints) beItemId = 'arena_points';
            try {
                await backendApi.marketList(character.id, {
                    kind: sellTarget.kind,
                    itemId: beItemId,
                    itemName: sellTarget.name,
                    itemLevel: sellTarget.itemLevel,
                    rarity: sellTarget.rarity,
                    slot: sellTarget.slot,
                    price,
                    quantity: qty,
                    bonuses: sellTarget.bonuses,
                    upgradeLevel: sellTarget.upgradeLevel,
                });
                await syncFromBackend(character.id);
                await refreshBackendMarket();
                setSellTarget(null);
                setTab('my');
                showToast(`Wystawiono: ${sellTarget.name} ×${qty}`);
                return;
            } catch (e) {
                console.warn('[market] marketList failed', e);
                showToast('Nie udało się wystawić (backend).');
                return;
            }
        }
        if (!sellTarget || !character) return;
        if (!isValidPrice(price)) { showToast('Nieprawidłowa cena!'); return; }
        if (!isValidQuantity(qty, sellTarget.maxQty)) { showToast('Nieprawidłowa ilość!'); return; }
        clearError();

        let itemId = '';
        if (sellTarget.bagItem) itemId = sellTarget.bagItem.itemId;
        else if (sellTarget.consumableId) itemId = sellTarget.consumableId;
        else if (sellTarget.stoneId) itemId = sellTarget.stoneId;
        else if (sellTarget.isArenaPoints) itemId = 'arena_points';

        const id = await listItem({
            sellerId: character.id,
            sellerName: character.name,
            kind: sellTarget.kind,
            itemId,
            itemName: sellTarget.name,
            itemLevel: sellTarget.itemLevel,
            rarity: sellTarget.rarity,
            slot: sellTarget.slot,
            price,
            quantity: qty,
            quantityInitial: qty,
            bonuses: sellTarget.bonuses,
            upgradeLevel: sellTarget.upgradeLevel,
        });
        if (!id) {
            const msg = useMarketStore.getState().error ?? 'Nie udało się wystawić.';
            showToast(msg);
            return;
        }

        let escrowOk = true;
        if (sellTarget.bagItem) {
            inv.getState().removeItem(sellTarget.bagItem.uuid);
        } else if (sellTarget.consumableId) {
            inv.getState().addConsumable(sellTarget.consumableId, -qty);
        } else if (sellTarget.stoneId) {
            escrowOk = inv.getState().useStones(sellTarget.stoneId, qty);
        } else if (sellTarget.isArenaPoints) {
            escrowOk = inv.getState().spendArenaPoints(qty);
        }
        if (!escrowOk) {
            void cancelListing(id);
            setSellTarget(null);
            showToast('Brak wystarczającej ilości w plecaku.');
            return;
        }
        setSellTarget(null);
        setTab('my');
        showToast(`Wystawiono: ${sellTarget.name} ×${qty}`);
    };

    const handleEditPrice = async (newPrice: number) => {
        if (!editTarget) return;
        if (!isValidPrice(newPrice)) { showToast('Nieprawidłowa cena!'); return; }
        if (isBackendMode() && character && editTarget) {
            try {
                await backendApi.editListing(character.id, editTarget.id, { price: newPrice });
                await syncFromBackend(character.id);
                await refreshBackendMarket();
                setEditTarget(null);
                showToast('Cena zaktualizowana.');
                return;
            } catch (e) {
                console.warn('[market] editListing failed', e);
                showToast('Nie udało się zaktualizować (backend).');
                return;
            }
        }
        clearError();
        const updated = await editListing(editTarget.id, { price: newPrice });
        if (!updated) {
            const msg = useMarketStore.getState().error ?? 'Nie udało się zaktualizować.';
            showToast(msg);
            return;
        }
        setEditTarget(null);
        showToast('Cena zaktualizowana.');
    };

    const handleCancelListing = async () => {
        if (isBackendMode() && character && editTarget) {
            try {
                await backendApi.marketCancel(character.id, editTarget.id);
                await syncFromBackend(character.id);
                await refreshBackendMarket();
                setEditTarget(null);
                showToast('Zdjęto z marketu.');
                return;
            } catch (e) {
                console.warn('[market] marketCancel failed', e);
                showToast('Nie udało się zdjąć z marketu (backend).');
                return;
            }
        }
        if (!editTarget) return;
        if (editTarget.kind === 'item' && bag.length >= MAX_BAG_SIZE) {
            showToast('Opróżnij plecak — pełny.'); return;
        }
        clearError();
        const cancelled = await cancelListing(editTarget.id);
        if (!cancelled) {
            const msg = useMarketStore.getState().error ?? 'Nie udało się zdjąć z marketu.';
            showToast(msg);
            return;
        }
        if (cancelled.kind === 'item') {
            inv.getState().restoreItem({
                uuid: `mkt_cancel_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
                itemId: cancelled.itemId,
                rarity: cancelled.rarity,
                bonuses: cancelled.bonuses,
                itemLevel: cancelled.itemLevel,
                upgradeLevel: cancelled.upgradeLevel,
            });
        } else if (cancelled.kind === 'potion' || cancelled.kind === 'elixir') {
            inv.getState().addConsumable(cancelled.itemId, cancelled.quantity);
        } else if (cancelled.kind === 'stone') {
            inv.getState().addStones(cancelled.itemId, cancelled.quantity);
        } else if (cancelled.kind === 'arena_points') {
            inv.getState().addArenaPoints(cancelled.quantity);
        } else if (cancelled.kind === 'spell_chest') {
            inv.getState().addConsumable(cancelled.itemId, cancelled.quantity);
        }
        setEditTarget(null);
        showToast('Zdjęto z marketu.');
    };

    if (!character) return null;

    const totalPagesForTab =
        tab === 'browse' ? totalBrowsePages
      : tab === 'sell' ? totalSellPages
      : totalMyPages;

    return (
        <div className={`market${embedded ? ' market--embedded' : ''}`}>

            <div className="market__top-row">
                <div className="market__tabs">
                    <button
                        className={`market__tab${tab === 'browse' ? ' market__tab--active' : ''}`}
                        onClick={() => setTab('browse')}
                    >
                        Przeglądaj
                        {sourceListings.length > 0 && <span className="market__tab-count">({sourceListings.length})</span>}
                    </button>
                    <button
                        className={`market__tab${tab === 'sell' ? ' market__tab--active' : ''}`}
                        onClick={() => setTab('sell')}
                    >
                        Sprzedawaj
                    </button>
                    <button
                        className={`market__tab${tab === 'my' ? ' market__tab--active' : ''}`}
                        onClick={() => setTab('my')}
                    >
                        Moje
                        {sourceMyListings.length > 0 && <span className="market__tab-count">({sourceMyListings.length})</span>}
                    </button>
                </div>
                <button
                    className={`market__notify-btn${saleNotifications.length > 0 ? ' market__notify-btn--active' : ''}`}
                    aria-label="Powiadomienia o sprzedaży"
                    title="Powiadomienia o sprzedaży"
                    onClick={() => setShowNotifications(true)}
                >
                    <GameIcon name="bell" />
                    {saleNotifications.length > 0 && (
                        <span className="market__notify-badge">{saleNotifications.length}</span>
                    )}
                </button>
            </div>

            <div className="market__filters">
                <input
                    type="text"
                    className="market__search"
                    placeholder="Szukaj…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                />
                <select
                    className="market__select"
                    value={category}
                    onChange={(e) => setCategory(e.target.value as MarketFilterCategory)}
                >
                    {CATEGORY_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                </select>
                <select
                    className="market__select"
                    value={rarityFilter}
                    onChange={(e) => setRarityFilter(e.target.value as Rarity | 'all')}
                >
                    {RARITY_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                </select>
                <select
                    className="market__select"
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as MarketSortBy)}
                >
                    {SORT_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                </select>
                <input
                    type="number"
                    className="market__lvl-input"
                    placeholder="Lvl od"
                    value={minLevel}
                    onChange={(e) => setMinLevel(Math.max(1, parseInt(e.target.value, 10) || 1))}
                    min={1}
                />
                <input
                    type="number"
                    className="market__lvl-input"
                    placeholder="Lvl do"
                    value={maxLevel}
                    onChange={(e) => setMaxLevel(Math.max(1, parseInt(e.target.value, 10) || 1))}
                    min={1}
                />
            </div>

            {error && (
                <div className="market__error">
                    <span>{error}</span>
                    <button onClick={clearError}><Icon name="x" /></button>
                </div>
            )}

            <AnimatePresence mode="wait">
                {tab === 'browse' && (
                    <motion.div
                        key="browse"
                        className="market__panel market__panel--list"
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        transition={{ duration: 0.18 }}
                    >
                        {pagedBrowse.length === 0 ? (
                            <p className="market__empty">Brak ofert spełniających kryteria.</p>
                        ) : pagedBrowse.map((l) => {
                            const isOwn = l.sellerId === character.id;
                            return (
                                <ListingRow
                                    key={l.id}
                                    listing={l}
                                    isOwn={isOwn}
                                    onClick={() => {
                                        if (isOwn) setEditTarget(l);
                                        else setBuyTarget(l);
                                    }}
                                />
                            );
                        })}
                    </motion.div>
                )}

                {tab === 'sell' && (
                    <motion.div
                        key="sell"
                        className="market__panel market__panel--grid"
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        transition={{ duration: 0.18 }}
                    >
                        {pagedSellTiles.length === 0 ? (
                            <p className="market__empty">Brak przedmiotów do wystawienia.</p>
                        ) : pagedSellTiles.map((t) => (
                            <button
                                key={t.key}
                                type="button"
                                className={`market__sell-tile${t.kind === 'elixir' ? ' market__sell-tile--elixir' : ''}`}
                                style={{ '--rarity-color': RARITY_COLORS[t.rarity] } as CSSProperties}
                                onClick={() => setSellTarget(t)}
                            >
                                <div className="market__sell-tile-icon">
                                    <TinyIcon icon={t.icon} size={36} />
                                    {t.kind === 'item' && t.itemLevel > 1 && (
                                        <span className="market__sell-tile-lvl">Lv {t.itemLevel}</span>
                                    )}
                                    {t.upgradeLevel > 0 && (
                                        <span className="market__sell-tile-upgrade">+{t.upgradeLevel}</span>
                                    )}
                                    {t.maxQty > 1 && (
                                        <span className="market__sell-tile-qty">×{t.maxQty}</span>
                                    )}
                                </div>
                                <div className="market__sell-tile-name" style={{ color: RARITY_COLORS[t.rarity] }}>
                                    {t.name}
                                </div>
                            </button>
                        ))}
                    </motion.div>
                )}

                {tab === 'my' && (
                    <motion.div
                        key="my"
                        className="market__panel market__panel--list"
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        transition={{ duration: 0.18 }}
                    >
                        {pagedMy.length === 0 ? (
                            <p className="market__empty">Nie masz wystawionych przedmiotów.</p>
                        ) : pagedMy.map((l) => (
                            <ListingRow
                                key={l.id}
                                listing={l}
                                isOwn
                                isMyTab
                                onClick={() => setEditTarget(l)}
                            />
                        ))}
                    </motion.div>
                )}
            </AnimatePresence>

            {totalPagesForTab > 1 && (
                <div className="market__pagination">
                    <button
                        type="button"
                        className="market__page-btn"
                        disabled={page <= 1}
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                    >
                        <Icon name="arrowLeft" /> Poprzednia
                    </button>
                    <span className="market__page-info">
                        Strona {page} / {totalPagesForTab}
                    </span>
                    <button
                        type="button"
                        className="market__page-btn"
                        disabled={page >= totalPagesForTab}
                        onClick={() => setPage((p) => Math.min(totalPagesForTab, p + 1))}
                    >
                        Następna <Icon name="arrowRight" />
                    </button>
                </div>
            )}

            <AnimatePresence>
                {buyTarget && (
                    <BuyModal
                        listing={buyTarget}
                        playerGold={gold}
                        onClose={() => setBuyTarget(null)}
                        onConfirm={handleConfirmBuy}
                    />
                )}
                {sellTarget && (
                    <SellModal
                        target={sellTarget}
                        onClose={() => setSellTarget(null)}
                        onConfirm={handleConfirmSell}
                    />
                )}
                {editTarget && (
                    <EditListingModal
                        listing={editTarget}
                        onClose={() => setEditTarget(null)}
                        onEditPrice={handleEditPrice}
                        onCancelListing={handleCancelListing}
                    />
                )}
                {showNotifications && (
                    <NotificationsModal
                        notifications={saleNotifications}
                        onClose={() => setShowNotifications(false)}
                        onDismiss={(id) => {
                            if (isBackendMode() && character) {
                                void (async () => {
                                    try {
                                        await backendApi.dismissNotification(character.id, id);
                                        await syncFromBackend(character.id);
                                    } catch { }
                                })();
                                return;
                            }
                            const n = saleNotifications.find((x) => x.id === id);
                            if (n) inv.getState().addGold(n.goldReceived);
                            void dismissNotification(id);
                        }}
                    />
                )}
                {toast && (
                    <motion.div
                        className="market__toast"
                        initial={{ opacity: 0, y: 18 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 18 }}
                    >
                        {toast}
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};


interface IListingRowProps {
    listing: IMarketListing;
    isOwn: boolean;
    isMyTab?: boolean;
    onClick: () => void;
}

const ListingRow = ({ listing, isOwn, isMyTab, onClick }: IListingRowProps) => {
    const color = RARITY_COLORS[listing.rarity];
    const icon = resolveListingIcon(listing.itemId, listing.kind, listing.slot);
    const cleanName = resolveListingName(listing.itemId, listing.kind, listing.itemName);
    const stats = formatBonusEntries(listing.bonuses);
    const isElixirRow = listing.kind === 'elixir';
    return (
        <button
            type="button"
            className={`market__row${isElixirRow ? ' market__row--elixir' : ''}`}
            style={{ '--rarity-color': color } as CSSProperties}
            onClick={onClick}
        >
            <div className="market__row-icon" style={{ background: `${color}22`, borderColor: color }}>
                <TinyIcon icon={icon} size={42} />
                {listing.kind === 'item' && listing.itemLevel > 1 && (
                    <span className="market__row-lvl">Lv {listing.itemLevel}</span>
                )}
                {listing.upgradeLevel > 0 && (
                    <span className="market__row-upgrade">+{listing.upgradeLevel}</span>
                )}
                {listing.quantity > 1 && (
                    <span className="market__row-qty">×{listing.quantity}</span>
                )}
            </div>
            <div className="market__row-info">
                <div className="market__row-name" style={{ color }}>
                    {cleanName}
                </div>
                {stats.length > 0 && (
                    <div className="market__row-stats">
                        {stats.map((s) => (
                            <span key={s.key} className="market__row-stat">
                                <span className="market__row-stat-label">{s.label}</span>
                                <span className="market__row-stat-value">+{s.value}</span>
                            </span>
                        ))}
                    </div>
                )}
                {!isMyTab && (
                    <div className="market__row-seller">od: {listing.sellerName}</div>
                )}
            </div>
            <div className="market__row-price">
                <span className="market__row-price-value">
                    {formatGoldShort(listing.price)}
                </span>
                <span className="market__row-price-label">
                    {listing.quantity > 1 ? '/szt' : ''}
                </span>
            </div>
            <div className="market__row-cta">
                {isMyTab ? 'Edytuj' : (isOwn ? 'Twoje' : 'Kup')}
            </div>
        </button>
    );
};

interface IBuyModalProps {
    listing: IMarketListing;
    playerGold: number;
    onClose: () => void;
    onConfirm: (qty: number) => void;
}

const BuyModal = ({ listing, playerGold, onClose, onConfirm }: IBuyModalProps) => {
    const isStack = isStackKind(listing.kind);
    const [qty, setQty] = useState(1);
    const [submitting, setSubmitting] = useState(false);
    const total = listing.price * qty;
    const canAfford = playerGold >= total;
    const color = RARITY_COLORS[listing.rarity];
    const icon = resolveListingIcon(listing.itemId, listing.kind, listing.slot);
    const cleanName = resolveListingName(listing.itemId, listing.kind, listing.itemName);
    const stats = formatBonusEntries(listing.bonuses);
    const handleConfirm = async () => {
        if (submitting) return;
        setSubmitting(true);
        try {
            await onConfirm(qty);
        } finally {
            setSubmitting(false);
        }
    };
    return (
        <motion.div
            className="market__modal-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
        >
            <motion.div
                className="market__modal"
                style={{ '--rarity-color': color } as CSSProperties}
                initial={{ scale: 0.92, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.96, opacity: 0 }}
                onClick={(e) => e.stopPropagation()}
            >
                <button className="market__modal-close" onClick={onClose}><Icon name="x" /></button>
                <div
                    className={`market__modal-hero${(listing.kind === 'elixir') ? ' market__modal-hero--elixir' : ''}`}
                    style={(listing.kind === 'elixir')
                        ? undefined
                        : { background: `linear-gradient(135deg, ${color}33, ${color}11)`, borderColor: color }}
                >
                    <div className="market__modal-icon">
                        <TinyIcon icon={icon} size={72} />
                        {listing.kind === 'item' && listing.itemLevel > 1 && (
                            <span className="market__modal-icon-lvl">Lv {listing.itemLevel}</span>
                        )}
                        {listing.upgradeLevel > 0 && (
                            <span className="market__modal-icon-upgrade">+{listing.upgradeLevel}</span>
                        )}
                    </div>
                    <div>
                        <div className="market__modal-name" style={{ color }}>{cleanName}</div>
                        <div className="market__modal-seller">od: {listing.sellerName}</div>
                    </div>
                </div>
                {stats.length > 0 && (
                    <ul className="market__modal-stats">
                        {stats.map((s) => (
                            <li key={s.key} className="market__modal-stat">
                                <span className="market__modal-stat-label">{s.label}</span>
                                <span className="market__modal-stat-value">+{s.value}</span>
                            </li>
                        ))}
                    </ul>
                )}
                {isStack && (
                    <div className="market__modal-qty-row">
                        <label>Ilość:</label>
                        <input
                            type="number"
                            min={1}
                            max={listing.quantity}
                            value={qty}
                            onChange={(e) => setQty(Math.max(1, Math.min(listing.quantity, parseInt(e.target.value, 10) || 1)))}
                        />
                        <button type="button" onClick={() => setQty(listing.quantity)}>MAX</button>
                        <span className="market__modal-qty-info">/ {listing.quantity}</span>
                    </div>
                )}
                <div className="market__modal-total">
                    <span>Cena:</span>
                    <strong>{formatGoldShort(total)}</strong>
                    {qty > 1 && <span className="market__modal-unit">({formatGoldShort(listing.price)} × {qty})</span>}
                </div>
                <div className="market__modal-actions">
                    <button className="market__modal-btn market__modal-btn--cancel" onClick={onClose} disabled={submitting}>Anuluj</button>
                    <button
                        className="market__modal-btn market__modal-btn--confirm"
                        disabled={submitting || !canAfford || qty < 1 || qty > listing.quantity}
                        onClick={() => void handleConfirm()}
                    >
                        {submitting ? '…' : (canAfford ? 'Zatwierdź' : 'Brak złota')}
                    </button>
                </div>
            </motion.div>
        </motion.div>
    );
};

interface ISellModalProps {
    target: {
        kind: MarketKind;
        name: string;
        rarity: Rarity;
        icon: string;
        maxQty: number;
        upgradeLevel: number;
        itemLevel: number;
        bonuses: Record<string, number>;
    };
    onClose: () => void;
    onConfirm: (price: number, qty: number) => void;
}

const SellModal = ({ target, onClose, onConfirm }: ISellModalProps) => {
    const stackable = isStackKind(target.kind);
    const [qty, setQty] = useState(stackable ? Math.min(1, target.maxQty) : 1);
    const [priceStr, setPriceStr] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const price = parseInt(priceStr, 10) || 0;
    const color = RARITY_COLORS[target.rarity];
    const stats = formatBonusEntries(target.bonuses);
    const handleConfirm = async () => {
        if (submitting) return;
        setSubmitting(true);
        try {
            await onConfirm(price, qty);
        } finally {
            setSubmitting(false);
        }
    };
    return (
        <motion.div
            className="market__modal-backdrop"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose}
        >
            <motion.div
                className="market__modal"
                style={{ '--rarity-color': color } as CSSProperties}
                initial={{ scale: 0.92, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.96, opacity: 0 }}
                onClick={(e) => e.stopPropagation()}
            >
                <button className="market__modal-close" onClick={onClose}><Icon name="x" /></button>
                <div
                    className={`market__modal-hero${target.kind === 'elixir' ? ' market__modal-hero--elixir' : ''}`}
                    style={target.kind === 'elixir'
                        ? undefined
                        : { background: `linear-gradient(135deg, ${color}33, ${color}11)`, borderColor: color }}
                >
                    <div className="market__modal-icon">
                        <TinyIcon icon={target.icon} size={72} />
                        {target.kind === 'item' && target.itemLevel > 1 && (
                            <span className="market__modal-icon-lvl">Lv {target.itemLevel}</span>
                        )}
                        {target.upgradeLevel > 0 && (
                            <span className="market__modal-icon-upgrade">+{target.upgradeLevel}</span>
                        )}
                    </div>
                    <div>
                        <div className="market__modal-name" style={{ color }}>{target.name}</div>
                    </div>
                </div>
                {stats.length > 0 && (
                    <ul className="market__modal-stats">
                        {stats.map((s) => (
                            <li key={s.key} className="market__modal-stat">
                                <span className="market__modal-stat-label">{s.label}</span>
                                <span className="market__modal-stat-value">+{s.value}</span>
                            </li>
                        ))}
                    </ul>
                )}
                {stackable && (
                    <div className="market__modal-qty-row">
                        <label>Ilość:</label>
                        <input
                            type="number"
                            min={1}
                            max={target.maxQty}
                            value={qty}
                            onChange={(e) => setQty(Math.max(1, Math.min(target.maxQty, parseInt(e.target.value, 10) || 1)))}
                        />
                        <button type="button" onClick={() => setQty(target.maxQty)}>MAX</button>
                        <span className="market__modal-qty-info">/ {target.maxQty}</span>
                    </div>
                )}
                <div className="market__modal-price-row">
                    <label>Cena{stackable ? ' za sztukę' : ''}:</label>
                    <input
                        type="number"
                        min={1}
                        placeholder="np. 1000"
                        value={priceStr}
                        onChange={(e) => setPriceStr(e.target.value)}
                    />
                    <span className="market__modal-price-suffix">
                        {qty > 1 && price > 0 ? `Suma: ${formatGoldShort(price * qty)}` : ''}
                    </span>
                </div>
                <div className="market__modal-actions">
                    <button className="market__modal-btn market__modal-btn--cancel" onClick={onClose} disabled={submitting}>Anuluj</button>
                    <button
                        className="market__modal-btn market__modal-btn--confirm"
                        disabled={submitting || !isValidPrice(price) || qty < 1 || qty > target.maxQty}
                        onClick={() => void handleConfirm()}
                    >
                        {submitting ? '…' : 'Wystaw'}
                    </button>
                </div>
            </motion.div>
        </motion.div>
    );
};

interface IEditModalProps {
    listing: IMarketListing;
    onClose: () => void;
    onEditPrice: (price: number) => void;
    onCancelListing: () => void;
}

const EditListingModal = ({ listing, onClose, onEditPrice, onCancelListing }: IEditModalProps) => {
    const [priceStr, setPriceStr] = useState(String(listing.price));
    const price = parseInt(priceStr, 10) || 0;
    const color = RARITY_COLORS[listing.rarity];
    const icon = resolveListingIcon(listing.itemId, listing.kind, listing.slot);
    const cleanName = resolveListingName(listing.itemId, listing.kind, listing.itemName);
    return (
        <motion.div
            className="market__modal-backdrop"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose}
        >
            <motion.div
                className="market__modal"
                style={{ '--rarity-color': color } as CSSProperties}
                initial={{ scale: 0.92, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.96, opacity: 0 }}
                onClick={(e) => e.stopPropagation()}
            >
                <button className="market__modal-close" onClick={onClose}><Icon name="x" /></button>
                <div
                    className={`market__modal-hero${(listing.kind === 'elixir') ? ' market__modal-hero--elixir' : ''}`}
                    style={(listing.kind === 'elixir')
                        ? undefined
                        : { background: `linear-gradient(135deg, ${color}33, ${color}11)`, borderColor: color }}
                >
                    <div className="market__modal-icon">
                        <TinyIcon icon={icon} size={72} />
                        {listing.kind === 'item' && listing.itemLevel > 1 && (
                            <span className="market__modal-icon-lvl">Lv {listing.itemLevel}</span>
                        )}
                        {listing.upgradeLevel > 0 && (
                            <span className="market__modal-icon-upgrade">+{listing.upgradeLevel}</span>
                        )}
                    </div>
                    <div>
                        <div className="market__modal-name" style={{ color }}>
                            {cleanName}
                        </div>
                        {listing.quantity > 1 && (
                            <div className="market__modal-seller">×{listing.quantity}</div>
                        )}
                    </div>
                </div>
                {(() => {
                    const stats = formatBonusEntries(listing.bonuses);
                    if (stats.length === 0) return null;
                    return (
                        <ul className="market__modal-stats">
                            {stats.map((s) => (
                                <li key={s.key} className="market__modal-stat">
                                    <span className="market__modal-stat-label">{s.label}</span>
                                    <span className="market__modal-stat-value">+{s.value}</span>
                                </li>
                            ))}
                        </ul>
                    );
                })()}
                <div className="market__modal-price-row">
                    <label>Cena{isStackKind(listing.kind) ? ' za sztukę' : ''}:</label>
                    <input
                        type="number"
                        min={1}
                        value={priceStr}
                        onChange={(e) => setPriceStr(e.target.value)}
                    />
                </div>
                <div className="market__modal-actions market__modal-actions--column">
                    <button
                        className="market__modal-btn market__modal-btn--confirm"
                        disabled={!isValidPrice(price) || price === listing.price}
                        onClick={() => onEditPrice(price)}
                    >
                        Zapisz cenę
                    </button>
                    <button
                        className="market__modal-btn market__modal-btn--remove"
                        onClick={onCancelListing}
                    >
                        Zdejmij z marketu
                    </button>
                    <button className="market__modal-btn market__modal-btn--cancel" onClick={onClose}>
                        Anuluj
                    </button>
                </div>
            </motion.div>
        </motion.div>
    );
};

interface INotificationsModalProps {
    notifications: IMarketSaleNotification[];
    onClose: () => void;
    onDismiss: (id: string) => void;
}

const NotificationsModal = ({ notifications, onClose, onDismiss }: INotificationsModalProps) => (
    <motion.div
        className="market__modal-backdrop"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose}
    >
        <motion.div
            className="market__modal market__modal--notifications"
            initial={{ scale: 0.92, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.96, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
        >
            <button className="market__modal-close" onClick={onClose}><Icon name="x" /></button>
            <div className="market__modal-title"><GameIcon name="package" /> Powiadomienia o sprzedaży</div>
            {notifications.length === 0 ? (
                <p className="market__empty">Brak nowych powiadomień.</p>
            ) : (
                <ul className="market__notify-list">
                    {notifications.map((n) => {
                        const color = RARITY_COLORS[n.rarity];
                        const kind = detectKindFromId(n.itemId);
                        const icon = resolveListingIcon(n.itemId, kind);
                        const cleanName = resolveListingName(n.itemId, kind, n.itemName);
                        return (
                            <motion.li
                                key={n.id}
                                className="market__notify-row"
                                style={{ '--rarity-color': color } as CSSProperties}
                                initial={{ x: -16, opacity: 0 }}
                                animate={{ x: 0, opacity: 1 }}
                                exit={{ x: 16, opacity: 0 }}
                            >
                                <div className="market__notify-row-icon"><TinyIcon icon={icon} size={36} /></div>
                                <div className="market__notify-row-info">
                                    <div className="market__notify-row-name" style={{ color }}>
                                        {cleanName}
                                        {n.quantitySold > 1 && <span> ×{n.quantitySold}</span>}
                                    </div>
                                    <div className="market__notify-row-gold">
                                        +{formatGoldShort(n.goldReceived)}
                                    </div>
                                </div>
                                <button
                                    className="market__notify-row-dismiss"
                                    onClick={() => onDismiss(n.id)}
                                    aria-label="Odrzuć"
                                >
                                    <GameIcon name="check-mark-button" />
                                </button>
                            </motion.li>
                        );
                    })}
                </ul>
            )}
        </motion.div>
    </motion.div>
);

export default Market;
