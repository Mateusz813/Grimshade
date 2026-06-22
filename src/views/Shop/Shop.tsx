import { useState, useMemo, useEffect, useRef } from 'react';
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
import './Shop.scss';

// -- Types ---------------------------------------------------------------------

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

// 2026-05-08: human-readable labels for the bonus stat keys we display
// on the item card. Keys mirror itemGenerator's bonus map.
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
// 2026-05-08 v3: per spec ("pokazuj tylko bazowe w sklepie") the card
// renders ONLY the base stats — no random pool. previewBonuses is
// already pruned to base stats by buildPreviewBonuses, so the card just
// iterates STAT_ORDER and renders whatever's there.
const STAT_ORDER = ['dmg_min', 'dmg_max', 'hp', 'attack', 'defense', 'mp', 'speed', 'critChance', 'critDmg'];

/**
 * Compare a shop item's preview stat to the player's currently-equipped
 * piece in the same slot. Returns the delta (preview − current effective)
 * so the caller can render a green ^ or red v arrow + magnitude.
 *
 * 2026-05-08 v3 — base stats on the equipped item store the RAW bonus
 * value; the displayed/effective number the player sees in the gear
 * modal is `getUpgradedBaseStat(raw, upgradeLevel)`. The shop preview
 * is also raw (always +0 upgrade), but if we compared raw-to-raw an
 * equipped +5 armor would look the same as a fresh +0 of the same
 * tier — exactly the bug the player flagged ("moja zbroja zalozona ma
 * ponad 1700HP, a w sklepie pisze ze bardziej mi sie oplaca kupic
 * gdy to nie prawda"). Lift the equipped side through the upgrade
 * multiplier so the delta reflects the EFFECTIVE numbers in play.
 *
 * Random bonuses (e.g. crit chance on a chest armor) are never scaled
 * by upgrade level, so we only apply the multiplier to keys that the
 * slot's base-stat list says are scaled.
 */
const compareStat = (
  preview: number,
  equipped: IInventoryItem | null | undefined,
  stat: string,
  slot?: string,
): number => {
  if (!equipped) return preview; // no equipped -> everything is an upgrade
  const raw = equipped.bonuses?.[stat] ?? 0;
  const upgradeLevel = equipped.upgradeLevel ?? 0;
  // Only apply the upgrade multiplier when this stat is the SLOT's
  // base stat (the same set itemSystem treats as scaled).
  const isBase = slot
    ? getBaseStatKeysForSlot(slot as never).includes(stat)
    : false;
  const cur = isBase ? getUpgradedBaseStat(raw, upgradeLevel) : raw;
  return preview - cur;
};

// -- Component -----------------------------------------------------------------

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
  const { buyShopItem } = useShopStore();

  // 2026-05-08 v2: gold-loss flash now driven by the actual sticker
  // price, not a balance-diff watcher. The previous implementation
  // computed `prev - gold` which under-reported when auto-sell fired
  // immediately after a buy and reimbursed part of the cost (e.g.
  // buying a 3,02k common Luk while auto-sell-common is on netted
  // -2,5k). The flash should reflect the sticker price the player
  // saw on the card, regardless of any auto-sell aftermath.
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

  const handleBuyItem = (item: IShopItem) => {
    if (!character) return;
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

  const handleBuyPotion = (elixir: IElixir, qty: number) => {
    const charLvl = character?.level ?? 1;
    // Defense-in-depth: never sell a level-locked potion even if the disabled
    // button is somehow bypassed.
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

  const handleBuyElixir = (elixir: IElixir) => {
    const result = useShopStore.getState().buyElixir(elixir, character ?? undefined, 1);
    if (result !== 'ok') {
      showToast(BUY_MESSAGES[result]);
      return;
    }
    showToast(`Kupiono: ${elixir.name_pl}`);
    flashBuy(elixir.id);
    triggerGoldFlash(getElixirPrice(elixir, character?.level ?? 1));
  };

  const handleBuyArena = (item: IArenaShopItem) => {
    if (!character) return;
    // Pass class so mythic weapon/offhand purchases generate the
    // class-correct type (sword for Knight, bow for Archer, …).
    const result = buyArenaItem(item, character.level, character.class);
    if (result !== 'ok') {
      showToast(result === 'no_gold' ? 'Za mało Punktów Areny!' : BUY_MESSAGES[result]);
      return;
    }
    showToast(`Kupiono: ${item.name_pl}`);
    flashBuy(item.id);
  };

  // 2026-06-21 Rules-of-Hooks fix: ALL hooks must run before any early return.
  // The `if (!character) return <Spinner>` guard used to sit ABOVE these
  // useMemos — so when the character hydrated after mount the re-render ran
  // MORE hooks than the first ("Rendered more hooks than during the previous
  // render" crash, same class as the Boss/Transform/Dungeon/Trainer fixes).
  // useMemos are now null-safe and the guard moved below them.
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
      {/* 2026-05-08: header chrome stripped per spec — no back button or
          page title. Just the tabs row and a gold/AP chip pinned at the
          top-right so the player still sees their wallet. */}
      {/* 2026-05-08: gold chip lives in the global TopHeader; the
          duplicate next-to-tabs chip was redundant. We KEEP the
          gold-flash logic so the TopHeader number animation can be
          wired later — the React state still tracks deltas. The
          floating "−Nk" delta is rendered as a fixed overlay near
          the top-right so the player sees their balance drop even
          though the chip itself isn't here. */}
      {/* 2026-05-08: tabs are icons-ONLY (no text labels) per spec.
          Each tab pulls its glyph from the elixir/potion/item registry
          where possible — Items uses a sword PNG, Potions uses the
          divine HP potion art, Elixirs uses the universal `eliksiry-1`
          art, Arena keeps the colosseum emoji until/unless an art file
          lands. The active state colour is `var(--nav-accent)` so it
          tracks the player's active transformation tier.            */}
      <header className="shop__header-strip">
        <nav className="shop__tabs page-tabs">
          {(['items', 'potions', 'elixirs', 'arena'] as Tab[]).map((tab) => {
            // Resolve a per-tab glyph. Falls back to the legacy emoji
            // when no PNG is registered.
            const glyphImg =
              tab === 'items'   ? getItemImage('sword', 'mainHand', 'sword')
            : tab === 'potions' ? getPotionImage('hp_potion_divine')
              // 2026-05-08: per spec the Eliksiry tab shows the
              // stat-reset elixir art (it's the most recognisable
              // "elixir" silhouette in the new pack).
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
      {/* Gold-loss delta overlay — fixed top-right so it aligns with
          the global header's gold chip without duplicating the chip. */}
      {goldDelta !== null && (
        <span key={`gold-delta-${goldFlash}`} className="shop__gold-delta-floating">
          −{formatGoldShort(goldDelta)}
        </span>
      )}

      <AnimatePresence mode="wait">

        {/* -- Items tab — backpack-style grid ---------------------------- */}
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
              // Order the bonus rows by STAT_ORDER so they're visually
              // stable card-to-card. Render every preview stat plus a
              // ^ / v vs the equipped piece in the same slot.
              // 2026-05-08 v3: only base stats. previewBonuses is
              // already pruned by buildPreviewBonuses, so anything in
              // the map is by definition a base stat for the slot.
              // Pass `item.slot` to compareStat so the equipped value
              // is lifted through its upgrade multiplier before the
              // delta is computed (raw stored vs displayed effective).
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
                    // 2026-05-08 spec: hard #000 background. Only the
                    // border keeps the rarity color so the player
                    // still sees rarity at a glance.
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
                  {/* Base stats only — generator's slot-specific roll
                      (HP for armor, DMG MIN/MAX for weapons, ATK for
                      gloves/rings, DEF for necklace/earrings, etc.). */}
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

        {/* -- Potions tab — backpack-style grid w/ qty input ------------- */}
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
              // 2026-06-21: HP/MP potions are level-gated (50→lvl1, 150→20,
              // 400→50, 1000→100, 20%→200, 35%→350, 50%→500, 100%→700). Block
              // the buy below the unlock level — mirrors the elixirs tab.
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

        {/* -- Elixirs tab — backpack-style grid, single buy ------------- */}
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
              // 2026-05-08: utility elixirs (XP boost, ATK, Utamo
              // Vita, etc.) live in `assets/images/eliksirs/` — use
              // the dedicated elixir registry instead of the potion
              // one which only knows about HP/MP variants.
              const img = getElixirImage(elixir.id);
              return (
                <div
                  key={elixir.id}
                  // 2026-05-08 v3 spec ("eliksiry maja taki sam border
                  // wszedzie") — utility elixirs get the gold->purple
                  // gradient border via `shop__card--elixir`. Same
                  // visual treatment as the market sell tile + listing
                  // row + bag tile so the family reads as one cohort.
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

        {/* -- Arena tab — backpack-style grid, AP currency -------------- */}
        {activeTab === 'arena' && (
          <motion.div
            key="arena"
            className="shop__panel shop__panel--arena"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.18 }}
          >
            {/* 2026-05-08 v2: full-width AP banner above the grid.
                Replaces the old "Sklep Areny" side-panel chip. The
                player sees their AP balance at a glance, and the
                items render in the same backpack-style grid as the
                other tabs. Currency abbrev. is "AP" (not "PA"). */}
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
                // 2026-05-08: pick the player's class-correct mythic
                // weapon + offhand types so the preview art and the
                // generated drop are aligned. Knight -> sword/shield,
                // Mage -> staff/spellbook, Archer -> bow/quiver, etc.
                const classMainType = CLASS_WEAPON_TYPES[character.class]?.[0] ?? 'sword';
                const classOffType = CLASS_OFFHAND_TYPES[character.class]?.[0] ?? 'shield';
                return catalog.map((item) => {
                  const price = item.perLevel ? item.apPrice * lvl : item.apPrice;
                  // 2026-06-21: arena HP/MP potions are level-gated by the real
                  // potion they pay out (payloadId → getPotionMinLevel).
                  const potionReqLevel = item.kind === 'potion' && item.payloadId
                    ? getPotionMinLevel(item.payloadId)
                    : 0;
                  const levelLocked = potionReqLevel > 0 && character.level < potionReqLevel;
                  const canBuy = !levelLocked && arenaPoints >= price;
                  const pulseKey = buyPulse[item.id] ?? 0;
                  // Resolve the right PNG per kind. Mythic weapons
                  // pull the class-specific art, stones show their
                  // tier art, potions/elixirs use the unified
                  // consumable resolver.
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
                      // Arena elixirs get the gold->purple gradient border
                      // for consistency with the rest of the app. Stones,
                      // potions and mythic weapons keep their default chrome.
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
