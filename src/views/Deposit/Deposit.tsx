import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useInventoryStore } from '../../stores/inventoryStore';
import {
    RARITY_COLORS,
    SLOT_ICONS,
    findBaseItem,
    flattenItemsData,
    formatItemName,
    getItemIcon,
    getItemSlotSafe,
    type IInventoryItem,
    type EquipmentSlot,
} from '../../systems/itemSystem';
import { getItemDisplayInfo } from '../../systems/itemGenerator';
import ItemIcon from '../../components/ui/ItemIcon/ItemIcon';
import itemsRaw from '../../data/items.json';
import './Deposit.scss';

const ALL_ITEMS = flattenItemsData(itemsRaw as Parameters<typeof flattenItemsData>[0]);

// Mirrors the inventoryStore cap so Deposit → Bag never races past it.
const MAX_BAG_SIZE = 1000;
const MAX_DEPOSIT_SIZE = 10000;

const getDisplayName = (item: IInventoryItem): string => {
    const base = findBaseItem(item.itemId, ALL_ITEMS);
    if (base) return base.name_pl;
    const gen = getItemDisplayInfo(item.itemId);
    if (gen) return gen.name_pl;
    return formatItemName(item.itemId);
};

const getEmoji = (itemId: string): string => {
    const gen = getItemDisplayInfo(itemId);
    if (gen) return gen.icon;
    return getItemIcon(itemId, '', ALL_ITEMS);
};

type TFilter = 'all' | 'common' | 'rare' | 'epic' | 'legendary' | 'mythic' | 'heroic';

type TSlotFilter =
    | 'all'
    | 'weapons' | 'armor-group' | 'jewelry'
    | EquipmentSlot;

interface ISlotFilterDef { id: TSlotFilter; label: string; icon: string }

const SLOT_FILTERS: ISlotFilterDef[] = [
    { id: 'all',          label: 'Wszystkie',    icon: '🎒' },
    { id: 'weapons',      label: 'Bronie',       icon: '⚔️' },
    { id: 'armor-group',  label: 'Zbroja',       icon: '🛡️' },
    { id: 'jewelry',      label: 'Biżuteria',    icon: '💍' },
    { id: 'mainHand',     label: 'Główna',       icon: '⚔️' },
    { id: 'offHand',      label: 'Pomocnicza',   icon: '🛡️' },
    { id: 'helmet',       label: 'Hełm',         icon: '⛑️' },
    { id: 'shoulders',    label: 'Naramienniki', icon: '🎖️' },
    { id: 'armor',        label: 'Napierśnik',   icon: '🦺' },
    { id: 'gloves',       label: 'Rękawice',     icon: '🧤' },
    { id: 'pants',        label: 'Spodnie',      icon: '👖' },
    { id: 'boots',        label: 'Buty',         icon: '👢' },
    { id: 'necklace',     label: 'Naszyjnik',    icon: '📿' },
    { id: 'earrings',     label: 'Kolczyki',     icon: '✨' },
    { id: 'ring1',        label: 'Pierścienie',  icon: '💍' },
];

const Deposit = () => {
    const navigate = useNavigate();
    const bag = useInventoryStore((s) => s.bag);
    const deposit = useInventoryStore((s) => s.deposit);
    const depositItem = useInventoryStore((s) => s.depositItem);
    const withdrawItem = useInventoryStore((s) => s.withdrawItem);

    const [filter, setFilter] = useState<TFilter>('all');
    const [slotFilter, setSlotFilter] = useState<TSlotFilter>('all');
    const [search, setSearch] = useState('');

    const filterItem = (item: IInventoryItem): boolean => {
        if (filter !== 'all' && item.rarity !== filter) return false;
        if (search.trim()) {
            const name = getDisplayName(item).toLowerCase();
            if (!name.includes(search.trim().toLowerCase())) return false;
        }
        if (slotFilter !== 'all') {
            const slot = getItemSlotSafe(item.itemId, ALL_ITEMS);
            if (!slot) return false;
            if (slotFilter === 'weapons')     return slot === 'mainHand' || slot === 'offHand';
            if (slotFilter === 'armor-group') return slot === 'helmet' || slot === 'armor' || slot === 'pants'
                                                    || slot === 'gloves' || slot === 'shoulders' || slot === 'boots';
            if (slotFilter === 'jewelry')     return slot === 'ring1' || slot === 'ring2' || slot === 'necklace' || slot === 'earrings';
            if (slotFilter === 'ring1')       return slot === 'ring1' || slot === 'ring2';
            return slot === slotFilter;
        }
        return true;
    };

    const filteredBag = useMemo(() => bag.filter(filterItem), [bag, filter, slotFilter, search]);
    const filteredDeposit = useMemo(() => deposit.filter(filterItem), [deposit, filter, slotFilter, search]);

    const handleDeposit = (uuid: string) => {
        depositItem(uuid);
    };

    const handleWithdraw = (uuid: string) => {
        withdrawItem(uuid);
    };

    const handleDepositAll = () => {
        const free = MAX_DEPOSIT_SIZE - deposit.length;
        const toMove = filteredBag.slice(0, free).map((i) => i.uuid);
        for (const uuid of toMove) depositItem(uuid);
    };

    const handleWithdrawAll = () => {
        const free = MAX_BAG_SIZE - bag.length;
        const toMove = filteredDeposit.slice(0, free).map((i) => i.uuid);
        for (const uuid of toMove) withdrawItem(uuid);
    };

    const renderTile = (item: IInventoryItem, action: 'deposit' | 'withdraw') => {
        const color = RARITY_COLORS[item.rarity];
        return (
            <div
                key={item.uuid}
                className="deposit__tile"
                onClick={() => (action === 'deposit' ? handleDeposit(item.uuid) : handleWithdraw(item.uuid))}
                title={action === 'deposit' ? 'Wpłać do depozytu' : 'Wypłać z depozytu'}
            >
                <ItemIcon
                    icon={getEmoji(item.itemId)}
                    rarity={item.rarity}
                    upgradeLevel={item.upgradeLevel}
                    itemLevel={item.itemLevel || 1}
                    size="md"
                    showTooltip={false}
                />
                <span className="deposit__tile-name" style={{ color }}>
                    {getDisplayName(item)}
                </span>
                <span className={`deposit__tile-action deposit__tile-action--${action}`}>
                    {action === 'deposit' ? '↓ Wpłać' : '↑ Wypłać'}
                </span>
            </div>
        );
    };

    const RARITY_FILTERS: { id: TFilter; label: string }[] = [
        { id: 'all', label: 'Wszystkie' },
        { id: 'common', label: 'Common' },
        { id: 'rare', label: 'Rare' },
        { id: 'epic', label: 'Epic' },
        { id: 'legendary', label: 'Legendary' },
        { id: 'mythic', label: 'Mythic' },
        { id: 'heroic', label: 'Heroic' },
    ];

    return (
        <div className="deposit">
            <header className="deposit__header page-header">
                <button className="deposit__back page-back-btn" onClick={() => navigate('/')}>
                    ← Powrót
                </button>
                <h1 className="deposit__title page-title">🏦 Depozyt</h1>
                <p className="deposit__subtitle">
                    Przedmioty w depozycie nigdy nie zostaną utracone przy śmierci.
                </p>
            </header>

            <div className="deposit__controls">
                <input
                    className="deposit__search"
                    type="text"
                    placeholder="Szukaj przedmiotu..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                />
                <div className="deposit__filters">
                    {RARITY_FILTERS.map((f) => (
                        <button
                            key={f.id}
                            className={`deposit__filter${filter === f.id ? ' deposit__filter--active' : ''}`}
                            onClick={() => setFilter(f.id)}
                        >
                            {f.label}
                        </button>
                    ))}
                </div>
                <div className="deposit__filters deposit__filters--slots">
                    {SLOT_FILTERS.map((f) => (
                        <button
                            key={f.id}
                            className={`deposit__filter deposit__filter--slot${slotFilter === f.id ? ' deposit__filter--active' : ''}`}
                            onClick={() => setSlotFilter(f.id)}
                            title={f.label}
                        >
                            <span className="deposit__filter-icon">{f.icon}</span>
                            <span className="deposit__filter-label">{f.label}</span>
                        </button>
                    ))}
                </div>
            </div>

            <div className="deposit__panels">
                {/* Bag panel */}
                <section className="deposit__panel">
                    <div className="deposit__panel-header">
                        <h2 className="deposit__panel-title">🎒 Plecak</h2>
                        <span className="deposit__panel-count">
                            {bag.length} / {MAX_BAG_SIZE}
                        </span>
                        <button
                            className="deposit__bulk-btn"
                            onClick={handleDepositAll}
                            disabled={filteredBag.length === 0 || deposit.length >= MAX_DEPOSIT_SIZE}
                        >
                            ↓ Wpłać wszystkie
                        </button>
                    </div>
                    {filteredBag.length === 0 ? (
                        <div className="deposit__empty">Brak przedmiotów</div>
                    ) : (
                        <div className="deposit__grid">
                            {filteredBag.map((item) => renderTile(item, 'deposit'))}
                        </div>
                    )}
                </section>

                {/* Deposit panel */}
                <section className="deposit__panel">
                    <div className="deposit__panel-header">
                        <h2 className="deposit__panel-title">🏦 Depozyt</h2>
                        <span className="deposit__panel-count">
                            {deposit.length} / {MAX_DEPOSIT_SIZE}
                        </span>
                        <button
                            className="deposit__bulk-btn"
                            onClick={handleWithdrawAll}
                            disabled={filteredDeposit.length === 0 || bag.length >= MAX_BAG_SIZE}
                        >
                            ↑ Wypłać wszystkie
                        </button>
                    </div>
                    {filteredDeposit.length === 0 ? (
                        <div className="deposit__empty">Brak przedmiotów w depozycie</div>
                    ) : (
                        <div className="deposit__grid">
                            {filteredDeposit.map((item) => renderTile(item, 'withdraw'))}
                        </div>
                    )}
                </section>
            </div>
        </div>
    );
};

export default Deposit;
