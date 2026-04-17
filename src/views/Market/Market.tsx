import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useCharacterStore } from '../../stores/characterStore';
import { useInventoryStore } from '../../stores/inventoryStore';
import { useMarketStore } from '../../stores/marketStore';
import {
    sortListings,
    filterBySlot,
    filterByRarity,
    calculateMarketTax,
    isValidPrice,
    type MarketSortBy,
    type MarketFilterSlot,
} from '../../systems/marketSystem';
import {
    RARITY_COLORS,
    RARITY_LABELS,
    findBaseItem,
    flattenItemsData,
    formatItemName,
    getItemIcon,
    type Rarity,
    type IInventoryItem,
} from '../../systems/itemSystem';
import itemsRaw from '../../data/items.json';
import './Market.scss';

const ALL_ITEMS = flattenItemsData(itemsRaw as Parameters<typeof flattenItemsData>[0]);

type MarketTab = 'browse' | 'sell' | 'my_listings';

const SORT_OPTIONS: { value: MarketSortBy; label: string }[] = [
    { value: 'newest', label: 'Najnowsze' },
    { value: 'price_asc', label: 'Cena rosnaco' },
    { value: 'price_desc', label: 'Cena malejaco' },
    { value: 'level_asc', label: 'Lvl rosnaco' },
    { value: 'level_desc', label: 'Lvl malejaco' },
];

const SLOT_FILTER_OPTIONS: { value: MarketFilterSlot; label: string }[] = [
    { value: 'all', label: 'Wszystkie' },
    { value: 'mainHand', label: 'Bron' },
    { value: 'offHand', label: 'Offhand' },
    { value: 'helmet', label: 'Helm' },
    { value: 'armor', label: 'Zbroja' },
    { value: 'pants', label: 'Spodnie' },
    { value: 'boots', label: 'Buty' },
    { value: 'ring', label: 'Pierscien' },
    { value: 'necklace', label: 'Naszyjnik' },
];

interface IMarketProps {
    embedded?: boolean;
}

const Market = ({ embedded = false }: IMarketProps) => {
    const navigate = useNavigate();
    const character = useCharacterStore((s) => s.character);
    const { bag, gold, addGold, addItem, removeItem } = useInventoryStore();
    const { listings, myListings, isLoading, error, fetchListings, fetchMyListings, listItem, cancelListing, buyListing, clearError } = useMarketStore();

    useEffect(() => {
        void fetchListings();
        if (character) {
            void fetchMyListings(character.id);
        }
    }, [fetchListings, fetchMyListings, character]);

    const [tab, setTab] = useState<MarketTab>('browse');
    const [sortBy, setSortBy] = useState<MarketSortBy>('newest');
    const [slotFilter, setSlotFilter] = useState<MarketFilterSlot>('all');
    const [rarityFilter, _setRarityFilter] = useState<Rarity | 'all'>('all');
    const [toast, setToast] = useState<string | null>(null);

    // Sell tab state
    const [selectedBagItem, setSelectedBagItem] = useState<IInventoryItem | null>(null);
    const [sellPrice, setSellPrice] = useState<string>('');

    const showToast = (msg: string) => {
        setToast(msg);
        setTimeout(() => setToast(null), 2500);
    };

    const filteredListings = useMemo(() => {
        let result = [...listings];
        result = filterBySlot(result, slotFilter);
        result = filterByRarity(result, rarityFilter);
        result = sortListings(result, sortBy);
        return result;
    }, [listings, slotFilter, rarityFilter, sortBy]);

    const handleBuy = async (listingId: string) => {
        const listing = listings.find((l) => l.id === listingId);
        if (!listing || !character) return;
        if (gold < listing.price) return;
        if (listing.sellerId === character.id) return;

        const bought = await buyListing(listingId);
        if (!bought) return;

        addGold(-listing.price);
        addItem({
            uuid: `market_${Date.now()}`,
            itemId: bought.itemId,
            rarity: bought.rarity,
            bonuses: bought.bonuses,
            itemLevel: bought.itemLevel,
            upgradeLevel: bought.upgradeLevel,
        });
        showToast(`Kupiono: ${bought.itemName}`);
    };

    const handleSell = async () => {
        if (!selectedBagItem || !character) return;
        const price = parseInt(sellPrice, 10);
        if (!isValidPrice(price)) return;

        const base = findBaseItem(selectedBagItem.itemId, ALL_ITEMS);
        const itemName = base?.name_pl ?? formatItemName(selectedBagItem.itemId);

        const id = await listItem({
            sellerId: character.id,
            sellerName: character.name,
            itemId: selectedBagItem.itemId,
            itemName,
            itemLevel: selectedBagItem.itemLevel || 1,
            rarity: selectedBagItem.rarity,
            slot: base?.slot ?? 'mainHand',
            price,
            bonuses: selectedBagItem.bonuses,
            upgradeLevel: selectedBagItem.upgradeLevel ?? 0,
        });

        if (id) {
            removeItem(selectedBagItem.uuid);
            setSelectedBagItem(null);
            setSellPrice('');
            setTab('my_listings');
            showToast(`Wystawiono: ${itemName} za ${price}g`);
        }
    };

    const handleCancel = async (listingId: string) => {
        const listing = await cancelListing(listingId);
        if (!listing) return;
        addItem({
            uuid: `cancel_${Date.now()}`,
            itemId: listing.itemId,
            rarity: listing.rarity,
            bonuses: listing.bonuses,
            itemLevel: listing.itemLevel,
            upgradeLevel: listing.upgradeLevel,
        });
        showToast('Wycofano oferte');
    };

    if (!character) return null;

    return (
        <div className={`market${embedded ? ' market--embedded' : ''}`}>
            {!embedded && (
                <header className="market__header">
                    <button className="market__back" onClick={() => navigate('/')}>
                        &larr; Miasto
                    </button>
                    <h1 className="market__title">Market</h1>
                    <span className="market__gold">
                        {gold.toLocaleString('pl-PL')}g
                    </span>
                </header>
            )}

            <div className="market__tabs">
                <button
                    className={`market__tab${tab === 'browse' ? ' market__tab--active' : ''}`}
                    onClick={() => setTab('browse')}
                >
                    Przegladaj ({listings.length})
                </button>
                <button
                    className={`market__tab${tab === 'sell' ? ' market__tab--active' : ''}`}
                    onClick={() => setTab('sell')}
                >
                    Wystaw
                </button>
                <button
                    className={`market__tab${tab === 'my_listings' ? ' market__tab--active' : ''}`}
                    onClick={() => setTab('my_listings')}
                >
                    Moje ({myListings.length})
                </button>
            </div>

            {isLoading && <div className="market__loading">Ladowanie...</div>}
            {error && (
                <div className="market__error">
                    <span>{error}</span>
                    <button onClick={clearError}>&#10005;</button>
                </div>
            )}

            {/* Browse tab */}
            {tab === 'browse' && (
                <motion.div
                    key="browse"
                    className="market__browse"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.18 }}
                >
                    <div className="market__filters">
                        <select
                            className="market__select"
                            value={sortBy}
                            onChange={(e) => setSortBy(e.target.value as MarketSortBy)}
                        >
                            {SORT_OPTIONS.map((o) => (
                                <option key={o.value} value={o.value}>{o.label}</option>
                            ))}
                        </select>
                        <select
                            className="market__select"
                            value={slotFilter}
                            onChange={(e) => setSlotFilter(e.target.value as MarketFilterSlot)}
                        >
                            {SLOT_FILTER_OPTIONS.map((o) => (
                                <option key={o.value} value={o.value}>{o.label}</option>
                            ))}
                        </select>
                    </div>

                    {filteredListings.length === 0 ? (
                        <p className="market__empty">Brak ofert. Badz pierwszy!</p>
                    ) : (
                        <div className="market__listing-grid">
                            {filteredListings.map((listing) => (
                                <div
                                    key={listing.id}
                                    className="market__listing"
                                    style={{ '--rarity-color': RARITY_COLORS[listing.rarity] } as React.CSSProperties}
                                >
                                    <div className="market__listing-icon">
                                        {getItemIcon(listing.itemId, listing.slot, ALL_ITEMS)}
                                    </div>
                                    <div className="market__listing-info">
                                        <span
                                            className="market__listing-name"
                                            style={{ color: RARITY_COLORS[listing.rarity] }}
                                        >
                                            {listing.itemName}
                                            {listing.upgradeLevel > 0 && ` +${listing.upgradeLevel}`}
                                        </span>
                                        <span className="market__listing-meta">
                                            {RARITY_LABELS[listing.rarity]} · Lvl {listing.itemLevel}
                                        </span>
                                        <span className="market__listing-seller">
                                            od: {listing.sellerName}
                                        </span>
                                    </div>
                                    <div className="market__listing-price-wrap">
                                        <span className="market__listing-price">
                                            {listing.price.toLocaleString('pl-PL')}g
                                        </span>
                                        <button
                                            className="market__buy-btn"
                                            disabled={gold < listing.price || listing.sellerId === character.id}
                                            onClick={() => handleBuy(listing.id)}
                                        >
                                            {listing.sellerId === character.id
                                                ? 'Twoje'
                                                : gold < listing.price
                                                    ? 'Brak golda'
                                                    : 'Kup'}
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </motion.div>
            )}

            {/* Sell tab */}
            {tab === 'sell' && (
                <motion.div
                    key="sell"
                    className="market__sell"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.18 }}
                >
                    <p className="market__sell-info">
                        Wybierz przedmiot z plecaka i ustaw cene. Prowizja: 5%
                    </p>

                    {selectedBagItem ? (
                        <div className="market__sell-selected">
                            <div
                                className="market__sell-item"
                                style={{ '--rarity-color': RARITY_COLORS[selectedBagItem.rarity] } as React.CSSProperties}
                            >
                                <span style={{ color: RARITY_COLORS[selectedBagItem.rarity] }}>
                                    {findBaseItem(selectedBagItem.itemId, ALL_ITEMS)?.name_pl ?? formatItemName(selectedBagItem.itemId)}
                                </span>
                                <span className="market__sell-rarity">
                                    {RARITY_LABELS[selectedBagItem.rarity]} · Lvl {selectedBagItem.itemLevel || 1}
                                </span>
                            </div>
                            <div className="market__sell-form">
                                <input
                                    className="market__sell-input"
                                    type="number"
                                    placeholder="Cena w goldzie..."
                                    value={sellPrice}
                                    onChange={(e) => setSellPrice(e.target.value)}
                                    min={1}
                                />
                                {sellPrice && isValidPrice(parseInt(sellPrice, 10)) && (
                                    <span className="market__sell-tax">
                                        Prowizja: {calculateMarketTax(parseInt(sellPrice, 10))}g
                                    </span>
                                )}
                                <div className="market__sell-actions">
                                    <button
                                        className="market__sell-btn"
                                        onClick={handleSell}
                                        disabled={!isValidPrice(parseInt(sellPrice, 10))}
                                    >
                                        Wystaw na market
                                    </button>
                                    <button
                                        className="market__cancel-select-btn"
                                        onClick={() => setSelectedBagItem(null)}
                                    >
                                        Anuluj
                                    </button>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="market__sell-bag">
                            {bag.length === 0 ? (
                                <p className="market__empty">Plecak jest pusty.</p>
                            ) : (
                                <div className="market__sell-bag-grid">
                                    {bag.map((item) => {
                                        const base = findBaseItem(item.itemId, ALL_ITEMS);
                                        return (
                                            <button
                                                key={item.uuid}
                                                className="market__sell-bag-item"
                                                style={{ '--rarity-color': RARITY_COLORS[item.rarity] } as React.CSSProperties}
                                                onClick={() => setSelectedBagItem(item)}
                                            >
                                                <span className="market__sell-bag-icon">
                                                    {getItemIcon(item.itemId, base?.slot ?? '', ALL_ITEMS)}
                                                </span>
                                                <span
                                                    className="market__sell-bag-name"
                                                    style={{ color: RARITY_COLORS[item.rarity] }}
                                                >
                                                    {base?.name_pl ?? formatItemName(item.itemId)}
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    )}
                </motion.div>
            )}

            {/* My Listings tab */}
            {tab === 'my_listings' && (
                <motion.div
                    key="my_listings"
                    className="market__my"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.18 }}
                >
                    {myListings.length === 0 ? (
                        <p className="market__empty">Nie masz aktywnych ofert.</p>
                    ) : (
                        <div className="market__listing-grid">
                            {myListings.map((listing) => (
                                <div
                                    key={listing.id}
                                    className="market__listing"
                                    style={{ '--rarity-color': RARITY_COLORS[listing.rarity] } as React.CSSProperties}
                                >
                                    <div className="market__listing-icon">
                                        {getItemIcon(listing.itemId, listing.slot, ALL_ITEMS)}
                                    </div>
                                    <div className="market__listing-info">
                                        <span
                                            className="market__listing-name"
                                            style={{ color: RARITY_COLORS[listing.rarity] }}
                                        >
                                            {listing.itemName}
                                            {listing.upgradeLevel > 0 && ` +${listing.upgradeLevel}`}
                                        </span>
                                        <span className="market__listing-meta">
                                            {RARITY_LABELS[listing.rarity]} · Lvl {listing.itemLevel}
                                        </span>
                                        <span className="market__listing-price">
                                            {listing.price.toLocaleString('pl-PL')}g
                                        </span>
                                    </div>
                                    <div className="market__listing-price-wrap">
                                        <button
                                            className="market__cancel-btn"
                                            onClick={() => handleCancel(listing.id)}
                                        >
                                            Wycofaj
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </motion.div>
            )}

            {/* Toast */}
            <AnimatePresence>
                {toast && (
                    <motion.div
                        className="market__toast"
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 20 }}
                    >
                        {toast}
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default Market;
