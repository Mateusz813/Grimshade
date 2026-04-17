import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useCharacterStore } from '../../stores/characterStore';
import { useInventoryStore } from '../../stores/inventoryStore';
import {
  useShopStore,
  generateShopItems,
  ELIXIRS,
  getElixirPrice,
  type BuyResult,
  type IElixir,
  type IShopItem,
} from '../../stores/shopStore';
import { RARITY_COLORS, RARITY_LABELS, SLOT_LABELS } from '../../systems/itemSystem';
import type { Rarity, EquipmentSlot } from '../../systems/itemSystem';
import Market from '../Market/Market';
import './Shop.scss';

// ── Types ─────────────────────────────────────────────────────────────────────

type Tab = 'items' | 'elixirs' | 'market';

// ── Helpers ───────────────────────────────────────────────────────────────────

const BUY_MESSAGES: Record<BuyResult, string> = {
  ok: '',
  no_gold: 'Za mało złota!',
  bag_full: 'Plecak pełny!',
  level_too_low: 'Za niski poziom!',
};

// ── Component ─────────────────────────────────────────────────────────────────

const Shop = () => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<Tab>('items');
  const [toast, setToast] = useState<string | null>(null);
  const [elixirQty, setElixirQty] = useState<Record<string, number>>({});

  const character = useCharacterStore((s) => s.character);
  const gold = useInventoryStore((s) => s.gold);
  const consumables = useInventoryStore((s) => s.consumables);
  const { buyShopItem } = useShopStore();

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  const handleBuyItem = (item: IShopItem) => {
    if (!character) return;
    const result = buyShopItem(item, character);
    if (result !== 'ok') showToast(BUY_MESSAGES[result]);
    else showToast(`Kupiono: ${item.name_pl}`);
  };

  const getElixirQty = (id: string): number => elixirQty[id] ?? 1;

  const setQtyForElixir = (id: string, qty: number) => {
    const clamped = Math.max(1, Math.min(99999, qty));
    setElixirQty((prev) => ({ ...prev, [id]: clamped }));
  };

  const handleBuyElixir = (elixir: IElixir, qty: number) => {
    const charLvl = character?.level ?? 1;
    const unitPrice = getElixirPrice(elixir, charLvl);
    const totalPrice = unitPrice * qty;
    const inv = useInventoryStore.getState();
    if (!inv.spendGold(totalPrice)) {
      showToast('Za malo zlota!');
      return;
    }
    inv.addConsumable(elixir.id, qty);
    showToast(`Kupiono ${qty}x ${elixir.name_pl}`);
  };

  if (!character) {
    return <div className="shop"><p className="shop__loading">Ładowanie...</p></div>;
  }

  const availableItems = useMemo(
    () => generateShopItems(character.class, character.level),
    [character.class, character.level],
  );

  return (
    <div className="shop">
      {/* Header */}
      <header className="shop__header">
        <button className="shop__back" onClick={() => navigate('/')}>← Miasto</button>
        <h1 className="shop__title">Sklep</h1>
        <span className="shop__gold">💰 {gold.toLocaleString('pl-PL')}</span>
      </header>

      {/* Tabs */}
      <nav className="shop__tabs">
        {(['items', 'elixirs', 'market'] as Tab[]).map((tab) => (
          <button
            key={tab}
            className={`shop__tab${activeTab === tab ? ' shop__tab--active' : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab === 'items' && '⚔️ Itemy'}
            {tab === 'elixirs' && '🧪 Eliksiry'}
            {tab === 'market' && '🏪 Market'}
          </button>
        ))}
      </nav>

      <AnimatePresence mode="wait">

        {/* ── Items tab ──────────────────────────────────────────────────── */}
        {activeTab === 'items' && (
          <motion.div
            key="items"
            className="shop__panel"
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

              return (
                <div
                  key={item.id}
                  className="shop__item"
                  style={{ borderColor: color, background: `${color}11` }}
                >
                  <div className="shop__item-top">
                    <span className="shop__item-name" style={{ color }}>
                      {item.icon} {item.name_pl}
                    </span>
                    <span className="shop__item-rarity" style={{ color }}>
                      {label}
                    </span>
                  </div>
                  <div className="shop__item-meta">
                    <span>{slotLabel}</span>
                    {item.baseAtk > 0 && <span>ATK: ~{item.baseAtk}</span>}
                    {item.baseDef > 0 && <span>DEF: ~{item.baseDef}</span>}
                    <span>Lvl {item.level}</span>
                  </div>
                  <div className="shop__item-footer">
                    <span className="shop__item-price">💰 {item.price.toLocaleString('pl-PL')}</span>
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

        {/* ── Elixirs tab ────────────────────────────────────────────────── */}
        {activeTab === 'elixirs' && (
          <motion.div
            key="elixirs"
            className="shop__panel"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.18 }}
          >
            {ELIXIRS.map((elixir) => {
              const owned = consumables[elixir.id] ?? 0;
              const levelLocked = !!(elixir.minLevel && character && character.level < elixir.minLevel);
              const qty = getElixirQty(elixir.id);
              const unitPrice = getElixirPrice(elixir, character?.level ?? 1);
              const totalPrice = unitPrice * qty;
              const canBuy = !levelLocked && gold >= totalPrice;

              return (
                <div key={elixir.id} className={`shop__elixir${levelLocked ? ' shop__elixir--locked' : ''}`}>
                  <span className="shop__elixir-icon">{elixir.icon}</span>
                  <div className="shop__elixir-info">
                    <div className="shop__elixir-name">{elixir.name_pl}</div>
                    <div className="shop__elixir-desc">{elixir.description_pl}</div>
                    {levelLocked && (
                      <div className="shop__elixir-locked-info">🔒 Wymaga poziomu {elixir.minLevel}</div>
                    )}
                    {!levelLocked && owned > 0 && (
                      <div className="shop__elixir-owned">Posiadasz: {owned}</div>
                    )}
                  </div>
                  <div className="shop__elixir-side">
                    {!levelLocked && (
                      <div className="shop__elixir-qty-row">
                        <input
                          type="number"
                          className="shop__qty-input"
                          min={1}
                          max={99999}
                          value={qty}
                          onChange={(e) => setQtyForElixir(elixir.id, parseInt(e.target.value, 10) || 1)}
                        />
                        <button
                          type="button"
                          className="shop__qty-preset"
                          onClick={() => setQtyForElixir(elixir.id, 10)}
                        >
                          ×10
                        </button>
                        <button
                          type="button"
                          className="shop__qty-preset"
                          onClick={() => setQtyForElixir(elixir.id, 100)}
                        >
                          ×100
                        </button>
                        <button
                          type="button"
                          className="shop__qty-preset"
                          onClick={() => {
                            const maxAffordable = unitPrice > 0 ? Math.floor(gold / unitPrice) : 1;
                            setQtyForElixir(elixir.id, Math.max(1, maxAffordable));
                          }}
                        >
                          MAX
                        </button>
                      </div>
                    )}
                    <span className="shop__item-price">
                      {qty > 1
                        ? `💰 ${qty} × ${unitPrice.toLocaleString('pl-PL')} = ${totalPrice.toLocaleString('pl-PL')}`
                        : `💰 ${unitPrice.toLocaleString('pl-PL')}`}
                    </span>
                    <button
                      className="shop__buy-btn"
                      disabled={!canBuy}
                      onClick={() => handleBuyElixir(elixir, qty)}
                    >
                      {levelLocked ? `Lvl ${elixir.minLevel}` : `Kup${qty > 1 ? ` (${qty})` : ''}`}
                    </button>
                  </div>
                </div>
              );
            })}
          </motion.div>
        )}

        {/* ── Market tab ────────────────────────────────────────────────── */}
        {activeTab === 'market' && (
          <motion.div
            key="market"
            className="shop__panel"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.18 }}
          >
            <Market embedded />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Toast */}
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
