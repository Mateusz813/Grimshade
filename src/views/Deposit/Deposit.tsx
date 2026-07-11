import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useInventoryStore } from '../../stores/inventoryStore';
import { useCharacterStore } from '../../stores/characterStore';
import { isBackendMode } from '../../config/backendMode';
import { backendApi } from '../../api/backend/backendApi';
import { syncFromBackend } from '../../api/backend/syncState';
import {
    RARITY_COLORS,
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
import Icon from '../../components/atoms/Icon/Icon';
import GameIcon from '../../components/atoms/Twemoji/GameIcon';
import itemsRaw from '../../data/items.json';
import './Deposit.scss';

const ALL_ITEMS = flattenItemsData(itemsRaw as Parameters<typeof flattenItemsData>[0]);

// Mirrors the inventoryStore cap so Deposit -> Bag never races past it.
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
    { id: 'all',          label: 'Wszystkie',    icon: 'backpack' },
    { id: 'weapons',      label: 'Bronie',       icon: 'crossed-swords' },
    { id: 'armor-group',  label: 'Zbroja',       icon: 'shield' },
    { id: 'jewelry',      label: 'Biżuteria',    icon: 'ring' },
    { id: 'mainHand',     label: 'Główna',       icon: 'crossed-swords' },
    { id: 'offHand',      label: 'Pomocnicza',   icon: 'shield' },
    { id: 'helmet',       label: 'Hełm',         icon: 'rescue-worker-s-helmet' },
    { id: 'shoulders',    label: 'Naramienniki', icon: 'military-medal' },
    { id: 'armor',        label: 'Napierśnik',   icon: 'safety-vest' },
    { id: 'gloves',       label: 'Rękawice',     icon: 'gloves' },
    { id: 'pants',        label: 'Spodnie',      icon: 'jeans' },
    { id: 'boots',        label: 'Buty',         icon: 'woman-s-boot' },
    { id: 'necklace',     label: 'Naszyjnik',    icon: 'prayer-beads' },
    { id: 'earrings',     label: 'Kolczyki',     icon: 'sparkles' },
    { id: 'ring1',        label: 'Pierścienie',  icon: 'ring' },
];

const Deposit = () => {
    const navigate = useNavigate();
    const character = useCharacterStore((s) => s.character);
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

    const handleDeposit = async (uuid: string) => {
        // Backend-authoritative branch (opt-in). Server moves the item into the
        // warehouse; we re-hydrate the stores from the returned state.
        if (isBackendMode() && character) {
            try {
                await backendApi.deposit(character.id, uuid);
                await syncFromBackend(character.id);
            } catch (e) {
                console.warn('[backend] deposit failed', e);
            }
            return;
        }
        depositItem(uuid);
    };

    const handleWithdraw = async (uuid: string) => {
        if (isBackendMode() && character) {
            try {
                await backendApi.withdraw(character.id, uuid);
                await syncFromBackend(character.id);
            } catch (e) {
                console.warn('[backend] withdraw failed', e);
            }
            return;
        }
        withdrawItem(uuid);
    };

    const handleDepositAll = async () => {
        const free = MAX_DEPOSIT_SIZE - deposit.length;
        const toMove = filteredBag.slice(0, free).map((i) => i.uuid);
        if (isBackendMode() && character) {
            try {
                for (const uuid of toMove) await backendApi.deposit(character.id, uuid);
                await syncFromBackend(character.id);
            } catch (e) {
                console.warn('[backend] depositAll failed', e);
            }
            return;
        }
        for (const uuid of toMove) depositItem(uuid);
    };

    const handleWithdrawAll = async () => {
        const free = MAX_BAG_SIZE - bag.length;
        const toMove = filteredDeposit.slice(0, free).map((i) => i.uuid);
        if (isBackendMode() && character) {
            try {
                for (const uuid of toMove) await backendApi.withdraw(character.id, uuid);
                await syncFromBackend(character.id);
            } catch (e) {
                console.warn('[backend] withdrawAll failed', e);
            }
            return;
        }
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
                    {action === 'deposit' ? <><Icon name="arrowDown" /> Wpłać</> : <><Icon name="arrowUp" /> Wypłać</>}
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
                    <Icon name="arrowLeft" /> Miasto
                </button>
                <h1 className="deposit__title page-title"><GameIcon name="bank" /> Depozyt</h1>
            </header>
            <p className="deposit__subtitle">
                Przedmioty w depozycie nigdy nie zostaną utracone przy śmierci.
            </p>

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
                            <span className="deposit__filter-icon"><GameIcon name={f.icon} /></span>
                            <span className="deposit__filter-label">{f.label}</span>
                        </button>
                    ))}
                </div>
            </div>

            <div className="deposit__panels">
                {/* Bag panel */}
                <section className="deposit__panel">
                    <div className="deposit__panel-header">
                        <h2 className="deposit__panel-title"><GameIcon name="backpack" /> Plecak</h2>
                        <span className="deposit__panel-count">
                            {bag.length} / {MAX_BAG_SIZE}
                        </span>
                        <button
                            className="deposit__bulk-btn"
                            onClick={handleDepositAll}
                            disabled={filteredBag.length === 0 || deposit.length >= MAX_DEPOSIT_SIZE}
                        >
                            <Icon name="arrowDown" /> Wpłać wszystkie
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
                        <h2 className="deposit__panel-title"><GameIcon name="bank" /> Depozyt</h2>
                        <span className="deposit__panel-count">
                            {deposit.length} / {MAX_DEPOSIT_SIZE}
                        </span>
                        <button
                            className="deposit__bulk-btn"
                            onClick={handleWithdrawAll}
                            disabled={filteredDeposit.length === 0 || bag.length >= MAX_BAG_SIZE}
                        >
                            <Icon name="arrowUp" /> Wypłać wszystkie
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
