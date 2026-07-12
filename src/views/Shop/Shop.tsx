import { useState, useMemo, useEffect, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { AnimatePresence, motion } from 'framer-motion';
import { useCharacterStore } from '../../stores/characterStore';
import { useInventoryStore } from '../../stores/inventoryStore';
import {
  useShopStore,
  generateShopItems,
  ELIXIRS,
  getElixirPrice,
  hasDailyCap,
  DAILY_PURCHASE_CAPS,
  getArenaShopCatalog,
  buyArenaItem,
  type BuyResult,
  type IElixir,
  type IShopItem,
  type IArenaShopItem,
} from '../../stores/shopStore';
import {
  RARITY_COLORS,
  RARITY_LABELS,
  SLOT_LABELS,
  CLASS_WEAPON_TYPES,
  CLASS_OFFHAND_TYPES,
  getUpgradedBaseStat,
  getBaseStatKeysForSlot,
  type IInventoryItem,
} from '../../systems/itemSystem';
import { formatGoldShort } from '../../systems/goldFormat';
import { getPotionMinLevel } from '../../systems/potionGating';
import {
  getItemImage,
  getPotionImage,
  getElixirImage,
  getConsumableImage,
  getStoneImage,
} from '../../systems/spriteAssets';
import type { Rarity, EquipmentSlot } from '../../systems/itemSystem';
import Spinner from '../../components/ui/Spinner/Spinner';
import Icon from '../../components/atoms/Icon/Icon';
import GameIcon from '../../components/atoms/Twemoji/GameIcon';
import { isBackendMode } from '../../config/backendMode';
import { backendApi } from '../../api/backend/backendApi';
import { syncFromBackend } from '../../api/backend/syncState';
import './Shop.scss';


type Tab = 'items' | 'potions' | 'elixirs' | 'arena';

const BUY_MESSAGES: Record<BuyResult, string> = {
  ok: '',
  no_gold: 'Za mało złota!',
  bag_full: 'Plecak pełny!',
  level_too_low: 'Za niski poziom!',
  daily_limit: 'Limit dzienny zakupów wyczerpany!',
};

const isPotionElixir = (id: string): boolean =>
  id.startsWith('hp_potion_') || id.startsWith('mp_potion_');

const STAT_LABEL: Record<string, string> = {
  attack: 'ATK',
  defense: 'DEF',
  hp: 'HP',
  mp: 'MP',
  speed: 'SPD',
  critChance: 'CRIT %',
  critDmg: 'CRIT DMG',
  dmg_min: 'DMG MIN',
  dmg_max: 'DMG MAX',
};
const STAT_ORDER = ['dmg_min', 'dmg_max', 'hp', 'attack', 'defense', 'mp', 'speed', 'critChance', 'critDmg'];

const compareStat = (
  preview: number,
  equipped: IInventoryItem | null | undefined,
  stat: string,
  slot?: string,
): number => {
  if (!equipped) return preview;
  const raw = equipped.bonuses?.[stat] ?? 0;
  const upgradeLevel = equipped.upgradeLevel ?? 0;
  const isBase = slot
    ? getBaseStatKeysForSlot(slot as never).includes(stat)
    : false;
  const cur = isBase ? getUpgradedBaseStat(raw, upgradeLevel) : raw;
  return preview - cur;
};


const Shop = () => {
  const [activeTab, setActiveTab] = useState<Tab>('items');
  const [toast, setToast] = useState<string | null>(null);
  const [buyPulse, setBuyPulse] = useState<Record<string, number>>({});
  const [potionQty, setPotionQty] = useState<Record<string, number>>({});

  const character = useCharacterStore((s) => s.character);
  const gold = useInventoryStore((s) => s.gold);
  const arenaPoints = useInventoryStore((s) => s.arenaPoints);
  const consumables = useInventoryStore((s) => s.consumables);
  const equipment = useInventoryStore((s) => s.equipment);
  const { buyShopItem } = useShopStore(useShallow((s) => ({ buyShopItem: s.buyShopItem })));

  const [goldFlash, setGoldFlash] = useState(0);
  const [goldDelta, setGoldDelta] = useState<number | null>(null);
  const goldDeltaTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerGoldFlash = (amount: number) => {
    if (amount <= 0) return;
    setGoldFlash((k) => k + 1);
    setGoldDelta(amount);
    if (goldDeltaTimerRef.current) clearTimeout(goldDeltaTimerRef.current);
    goldDeltaTimerRef.current = setTimeout(() => setGoldDelta(null), 1200);
  };
  useEffect(() => () => {
    if (goldDeltaTimerRef.current) clearTimeout(goldDeltaTimerRef.current);
  }, []);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  const flashBuy = (id: string) => {
    setBuyPulse((p) => ({ ...p, [id]: (p[id] ?? 0) + 1 }));
  };

  const handleBuyItem = async (item: IShopItem) => {
    if (!character) return;
    if (isBackendMode() && character) {
      try {
        await backendApi.buyShopItem(character.id, item.id);
        await syncFromBackend(character.id);
        showToast(`Kupiono: ${item.name_pl}`);
        flashBuy(item.id);
        return;
      } catch (e) {
        console.warn('[shop] buyShopItem failed', e);
        showToast('Nie udało się kupić (backend).');
        return;
      }
    }
    const result = buyShopItem(item, character);
    if (result !== 'ok') {
      showToast(BUY_MESSAGES[result]);
    } else {
      showToast(`Kupiono: ${item.name_pl}`);
      flashBuy(item.id);
      triggerGoldFlash(item.price);
    }
  };

  const getPotionQty = (id: string): number => potionQty[id] ?? 1;
  const setQtyForPotion = (id: string, qty: number) => {
    const clamped = Math.max(1, Math.min(99999, qty));
    setPotionQty((prev) => ({ ...prev, [id]: clamped }));
  };

  const handleBuyPotion = async (elixir: IElixir, qty: number) => {
    if (isBackendMode() && character) {
      try {
        await backendApi.buyElixir(character.id, elixir.id, qty);
        await syncFromBackend(character.id);
        showToast(`Kupiono ${qty}× ${elixir.name_pl}`);
        flashBuy(elixir.id);
        return;
      } catch (e) {
        console.warn('[shop] buyElixir (potion) failed', e);
        showToast('Nie udało się kupić (backend).');
        return;
      }
    }
    const charLvl = character?.level ?? 1;
    if (elixir.minLevel && charLvl < elixir.minLevel) {
      showToast(`Wymaga poziomu ${elixir.minLevel}`);
      return;
    }
    const unitPrice = getElixirPrice(elixir, charLvl);
    const totalPrice = unitPrice * qty;
    const inv = useInventoryStore.getState();
    if (!inv.spendGold(totalPrice)) {
      showToast('Za mało złota!');
      return;
    }
    inv.addConsumable(elixir.id, qty);
    showToast(`Kupiono ${qty}× ${elixir.name_pl}`);
    flashBuy(elixir.id);
    triggerGoldFlash(totalPrice);
  };

  const handleBuyElixir = async (elixir: IElixir) => {
    if (isBackendMode() && character) {
      try {
        await backendApi.buyElixir(character.id, elixir.id, 1);
        await syncFromBackend(character.id);
        showToast(`Kupiono: ${elixir.name_pl}`);
        flashBuy(elixir.id);
        return;
      } catch (e) {
        console.warn('[shop] buyElixir failed', e);
        showToast('Nie udało się kupić (backend).');
        return;
      }
    }
    const result = useShopStore.getState().buyElixir(elixir, character ?? undefined, 1);
    if (result !== 'ok') {
      showToast(BUY_MESSAGES[result]);
      return;
    }
    showToast(`Kupiono: ${elixir.name_pl}`);
    flashBuy(elixir.id);
    triggerGoldFlash(getElixirPrice(elixir, character?.level ?? 1));
  };

  const handleBuyArena = async (item: IArenaShopItem) => {
    if (!character) return;
    if (isBackendMode() && character) {
      try {
        await backendApi.buyArenaItem(character.id, item.id);
        await syncFromBackend(character.id);
        showToast(`Kupiono: ${item.name_pl}`);
        flashBuy(item.id);
        return;
      } catch (e) {
        console.warn('[shop] buyArenaItem failed', e);
        showToast('Nie udało się kupić (backend).');
        return;
      }
    }
    const result = buyArenaItem(item, character.level, character.class);
    if (result !== 'ok') {
      showToast(result === 'no_gold' ? 'Za mało Punktów Areny!' : BUY_MESSAGES[result]);
      return;
    }
    showToast(`Kupiono: ${item.name_pl}`);
    flashBuy(item.id);
  };

  const availableItems = useMemo(
    () => (character ? generateShopItems(character.class, character.level) : []),
    [character?.class, character?.level],
  );

  const potionElixirs = useMemo(() => ELIXIRS.filter((e) => isPotionElixir(e.id)), []);
  const utilityElixirs = useMemo(() => ELIXIRS.filter((e) => !isPotionElixir(e.id)), []);

  if (!character) {
    return <div className="shop"><Spinner size="lg" /></div>;
  }

  return (
    <div className="shop shop--dark">
      <header className="shop__header-strip">
        <nav className="shop__tabs page-tabs">
          {(['items', 'potions', 'elixirs', 'arena'] as Tab[]).map((tab) => {
            const glyphImg =
              tab === 'items'   ? getItemImage('sword', 'mainHand', 'sword')
            : tab === 'potions' ? getPotionImage('hp_potion_divine')
            : tab === 'elixirs' ? getElixirImage('stat_reset')
            : null;
            const fallbackEmoji =
              tab === 'items'   ? 'crossed-swords'
            : tab === 'potions' ? 'lotion-bottle'
            : tab === 'elixirs' ? 'test-tube'
            :                     'stadium';
            const labelAria =
              tab === 'items'   ? 'Itemy'
            : tab === 'potions' ? 'Potiony'
            : tab === 'elixirs' ? 'Eliksiry'
            :                     'Arena';
            return (
              <button
                key={tab}
                className={`shop__tab page-tab${activeTab === tab ? ' shop__tab--active page-tab--active' : ''}`}
                aria-label={labelAria}
                title={labelAria}
                onClick={() => setActiveTab(tab)}
              >
                <span className="shop__tab-glyph">
                  {glyphImg
                    ? <img src={glyphImg} alt="" draggable={false} />
                    : <GameIcon name={fallbackEmoji} />}
                </span>
              </button>
            );
          })}
        </nav>
      </header>
      {goldDelta !== null && (
        <span key={`gold-delta-${goldFlash}`} className="shop__gold-delta-floating">
          −{formatGoldShort(goldDelta)}
        </span>
      )}

      <AnimatePresence mode="wait">

        {activeTab === 'items' && (
          <motion.div
            key="items"
            className="shop__panel shop__panel--grid"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.18 }}
          >
            {availableItems.map((item) => {
              const color = RARITY_COLORS[item.rarity as Rarity] ?? '#9e9e9e';
              const label = RARITY_LABELS[item.rarity as Rarity] ?? item.rarity;
              const slotLabel = SLOT_LABELS[item.slot as EquipmentSlot] ?? item.slot;
              const canBuy = gold >= item.price;
              const pulseKey = buyPulse[item.id] ?? 0;
              const equipped = equipment[item.slot as EquipmentSlot];
              const baseEntries = STAT_ORDER
                .filter((k) => (item.previewBonuses?.[k] ?? 0) !== 0)
                .map((k) => ({
                  key: k,
                  value: item.previewBonuses[k],
                  delta: compareStat(item.previewBonuses[k], equipped, k, item.slot),
                }));
              return (
                <div
                  key={item.id}
                  className={`shop__card${pulseKey ? ' shop__card--bought' : ''}`}
                  data-pulse={pulseKey}
                  style={{ borderColor: color, boxShadow: `0 0 12px ${color}33` }}
                >
                  <div
                    className="shop__card-icon"
                    style={{ borderColor: color }}
                    aria-label={`${label} ${item.name_pl}`}
                  >
                    {(() => {
                      const img = getItemImage(item.id, item.slot, item.type);
                      return img
                        ? <img src={img} alt={item.name_pl} className="shop__card-icon-img" draggable={false} />
                        : <span className="shop__card-icon-glyph"><GameIcon name={item.icon} /></span>;
                    })()}
                    <span className="shop__card-lvl-badge">Lv {item.level}</span>
                  </div>
                  <div className="shop__card-name" style={{ color }}>
                    {item.name_pl}
                  </div>
                  <div className="shop__card-meta">{slotLabel}</div>
                  {baseEntries.length > 0 && (
                    <ul className="shop__card-stats">
                      {baseEntries.map((b) => (
                        <li key={b.key} className="shop__card-stat-row">
                          <span className="shop__card-stat-label">{STAT_LABEL[b.key] ?? b.key}</span>
                          <span className="shop__card-stat-value">+{b.value}</span>
                          {equipped && b.delta !== 0 && (
                            <span
                              className={`shop__card-stat-delta shop__card-stat-delta--${b.delta > 0 ? 'up' : 'down'}`}
                            >
                              {b.delta > 0 ? <Icon name="triangleUp" /> : <Icon name="triangleDown" />} {Math.abs(b.delta)}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="shop__card-footer">
                    <span className="shop__card-price"><GameIcon name="money-bag" /> {formatGoldShort(item.price)}</span>
                    <button
                      className="shop__buy-btn"
                      disabled={!canBuy}
                      onClick={() => handleBuyItem(item)}
                    >
                      Kup
                    </button>
                  </div>
                </div>
              );
            })}
          </motion.div>
        )}

        {activeTab === 'potions' && (
          <motion.div
            key="potions"
            className="shop__panel shop__panel--grid"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.18 }}
          >
            {potionElixirs.map((elixir) => {
              const owned = consumables[elixir.id] ?? 0;
              const qty = getPotionQty(elixir.id);
              const unitPrice = getElixirPrice(elixir, character?.level ?? 1);
              const totalPrice = unitPrice * qty;
              const levelLocked = !!(elixir.minLevel && (character?.level ?? 1) < elixir.minLevel);
              const canBuy = !levelLocked && gold >= totalPrice;
              const pulseKey = buyPulse[elixir.id] ?? 0;
              const img = getPotionImage(elixir.id);
              return (
                <div
                  key={elixir.id}
                  className={`shop__card${levelLocked ? ' shop__card--locked' : ''}${pulseKey ? ' shop__card--bought' : ''}`}
                  data-pulse={pulseKey}
                >
                  <div className="shop__card-icon">
                    {img
                      ? <img src={img} alt={elixir.name_pl} className="shop__card-icon-img" draggable={false} />
                      : <span className="shop__card-icon-glyph"><GameIcon name={elixir.icon} /></span>}
                    {owned > 0 && <span className="shop__card-lvl-badge">×{owned}</span>}
                  </div>
                  <div className="shop__card-name">{elixir.name_pl}</div>
                  <div className="shop__card-meta">{elixir.description_pl}</div>
                  {levelLocked && (
                    <div className="shop__card-lock"><GameIcon name="locked" /> Lv {elixir.minLevel}</div>
                  )}
                  <div className="shop__card-qty-row">
                    <input
                      type="number"
                      className="shop__qty-input"
                      min={1}
                      max={99999}
                      value={qty}
                      onChange={(e) => setQtyForPotion(elixir.id, parseInt(e.target.value, 10) || 1)}
                    />
                    <button type="button" className="shop__qty-preset" onClick={() => setQtyForPotion(elixir.id, 10)}>×10</button>
                    <button type="button" className="shop__qty-preset" onClick={() => setQtyForPotion(elixir.id, 100)}>×100</button>
                    <button
                      type="button"
                      className="shop__qty-preset"
                      onClick={() => {
                        const max = unitPrice > 0 ? Math.floor(gold / unitPrice) : 1;
                        setQtyForPotion(elixir.id, Math.max(1, max));
                      }}
                    >
                      MAX
                    </button>
                  </div>
                  <div className="shop__card-footer">
                    <span className="shop__card-price">
                      <GameIcon name="money-bag" /> {qty > 1
                        ? `${formatGoldShort(unitPrice)} × ${qty} = ${formatGoldShort(totalPrice)}`
                        : formatGoldShort(unitPrice)}
                    </span>
                    <button
                      className="shop__buy-btn"
                      disabled={!canBuy}
                      onClick={() => handleBuyPotion(elixir, qty)}
                    >
                      {levelLocked ? `Lv ${elixir.minLevel}` : `Kup${qty > 1 ? ` (${qty})` : ''}`}
                    </button>
                  </div>
                </div>
              );
            })}
          </motion.div>
        )}

        {activeTab === 'elixirs' && (
          <motion.div
            key="elixirs"
            className="shop__panel shop__panel--grid"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.18 }}
          >
            {utilityElixirs.map((elixir) => {
              const owned = consumables[elixir.id] ?? 0;
              const levelLocked = !!(elixir.minLevel && character.level < elixir.minLevel);
              const unitPrice = getElixirPrice(elixir, character.level);
              const isCapped = hasDailyCap(elixir.id);
              const dailyRemaining = isCapped
                ? useShopStore.getState().getDailyRemaining(elixir.id)
                : Number.POSITIVE_INFINITY;
              const dailyExhausted = isCapped && dailyRemaining <= 0;
              const canBuy = !levelLocked && !dailyExhausted && gold >= unitPrice;
              const pulseKey = buyPulse[elixir.id] ?? 0;
              const img = getElixirImage(elixir.id);
              return (
                <div
                  key={elixir.id}
                  className={`shop__card shop__card--elixir${levelLocked ? ' shop__card--locked' : ''}${pulseKey ? ' shop__card--bought' : ''}`}
                  data-pulse={pulseKey}
                >
                  <div className="shop__card-icon">
                    {img
                      ? <img src={img} alt={elixir.name_pl} className="shop__card-icon-img" draggable={false} />
                      : <span className="shop__card-icon-glyph"><GameIcon name={elixir.icon} /></span>}
                    {owned > 0 && <span className="shop__card-lvl-badge">×{owned}</span>}
                  </div>
                  <div className="shop__card-name">{elixir.name_pl}</div>
                  <div className="shop__card-meta">{elixir.description_pl}</div>
                  {levelLocked && (
                    <div className="shop__card-lock"><GameIcon name="locked" /> Lv {elixir.minLevel}</div>
                  )}
                  {isCapped && !levelLocked && (
                    <div className={`shop__card-lock${dailyExhausted ? ' shop__card-lock--bad' : ''}`}>
                      <GameIcon name="calendar" /> {DAILY_PURCHASE_CAPS[elixir.id] - dailyRemaining}/{DAILY_PURCHASE_CAPS[elixir.id]}
                    </div>
                  )}
                  <div className="shop__card-footer">
                    <span className="shop__card-price"><GameIcon name="money-bag" /> {formatGoldShort(unitPrice)}</span>
                    <button
                      className="shop__buy-btn"
                      disabled={!canBuy}
                      onClick={() => handleBuyElixir(elixir)}
                    >
                      {levelLocked ? `Lv ${elixir.minLevel}` : dailyExhausted ? 'Limit' : 'Kup'}
                    </button>
                  </div>
                </div>
              );
            })}
          </motion.div>
        )}

        {activeTab === 'arena' && (
          <motion.div
            key="arena"
            className="shop__panel shop__panel--arena"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.18 }}
          >
            <div className="shop__arena-banner">
              <span className="shop__arena-banner-label">Punkty Areny</span>
              <span className="shop__arena-banner-value">
                <strong>{arenaPoints.toLocaleString('pl-PL')}</strong> AP
              </span>
            </div>
            <div className="shop__panel--grid">
              {(() => {
                const catalog = getArenaShopCatalog();
                const lvl = Math.min(1000, Math.max(1, character.level));
                const classMainType = CLASS_WEAPON_TYPES[character.class]?.[0] ?? 'sword';
                const classOffType = CLASS_OFFHAND_TYPES[character.class]?.[0] ?? 'shield';
                return catalog.map((item) => {
                  const price = item.perLevel ? item.apPrice * lvl : item.apPrice;
                  const potionReqLevel = item.kind === 'potion' && item.payloadId
                    ? getPotionMinLevel(item.payloadId)
                    : 0;
                  const levelLocked = potionReqLevel > 0 && character.level < potionReqLevel;
                  const canBuy = !levelLocked && arenaPoints >= price;
                  const pulseKey = buyPulse[item.id] ?? 0;
                  const img =
                    item.kind === 'mythic_weapon'
                      ? getItemImage(classMainType, 'mainHand', classMainType)
                    : item.kind === 'mythic_offhand'
                      ? getItemImage(classOffType, 'offHand', classOffType)
                    : item.kind === 'stone'
                      ? getStoneImage(item.payloadId)
                    : item.payloadId
                      ? getConsumableImage(item.payloadId)
                    : null;
                  return (
                    <div
                      key={item.id}
                      className={`shop__card${item.kind === 'elixir' ? ' shop__card--elixir' : ''}${levelLocked ? ' shop__card--locked' : ''}${pulseKey ? ' shop__card--bought' : ''}`}
                      data-pulse={pulseKey}
                    >
                      <div className="shop__card-icon">
                        {img
                          ? <img src={img} alt={item.name_pl} className="shop__card-icon-img" draggable={false} />
                          : <span className="shop__card-icon-glyph"><GameIcon name={item.icon} /></span>}
                      </div>
                      <div className="shop__card-name" style={{ color: item.kind.startsWith('mythic') ? '#ff5722' : undefined }}>
                        {item.name_pl}
                      </div>
                      <div className="shop__card-meta">{item.description_pl}</div>
                      {item.perLevel && (
                        <div className="shop__card-lock" style={{ color: '#ffd700' }}>
                          Lv {lvl} · {price.toLocaleString('pl-PL')} AP
                        </div>
                      )}
                      {levelLocked && (
                        <div className="shop__card-lock"><GameIcon name="locked" /> Lv {potionReqLevel}</div>
                      )}
                      <div className="shop__card-footer">
                        <span className="shop__card-price">{price.toLocaleString('pl-PL')} AP</span>
                        <button
                          className="shop__buy-btn"
                          disabled={!canBuy}
                          onClick={() => handleBuyArena(item)}
                        >
                          {levelLocked ? `Lv ${potionReqLevel}` : 'Kup'}
                        </button>
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {toast && (
          <motion.div
            className="shop__toast"
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

export default Shop;
