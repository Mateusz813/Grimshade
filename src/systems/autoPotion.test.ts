/**
 * Auto-potion threshold logic — integration tests for `tryAutoPotion`.
 *
 * Covers BACKLOG.md 11.x (Auto-potion threshold/trigger tests, classified as
 * U+I+E; the engine-side U+I subset is what lives here). The E2E counterpart
 * tests the UI threshold slider + persistence; this file tests the actual
 * decision logic the engine runs every combat tick.
 *
 * Decision matrix tested (per HP/MP, per slot kind flat/pct):
 *   1. enabled flag OFF              -> never fires
 *   2. threshold = 0                 -> never fires
 *   3. current >= max                -> never fires (safety: don't waste a potion)
 *   4. current% > threshold          -> never fires
 *   5. on cooldown                   -> never fires
 *   6. no potions owned              -> never fires
 *   7. heal amount > missing         -> never fires (anti-waste guard:
 *      "lost 1 HP, burned a 50 HP potion" — see comment in `useAutoPotionSlot`)
 *   8. healthy fire path             -> fires, decrements consumable, installs CD
 *
 * Why unit/integration: the matrix is enabled × threshold × current × cooldown
 * × potion-stock × slot-kind = thousands of states. Pure-function vitest tests
 * give μs-precision determinism that an in-browser timer can't match.
 *
 * The flat-potion fixtures use `hp_potion_sm` (heal_hp_50, FLAT_COOLDOWN_MS=1000)
 * and `mp_potion_sm` (heal_mp_30) so the missing-vs-heal math is easy to read.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
    tryAutoPotion,
} from './combatEngine';
import {
    resolveAutoPotionElixir,
    FLAT_POTION_COOLDOWN_MS,
    PCT_POTION_COOLDOWN_MS,
} from './potionSystem';
import { useSettingsStore } from '../stores/settingsStore';
import { useInventoryStore } from '../stores/inventoryStore';
import { useCombatStore } from '../stores/combatStore';
import { useCooldownStore } from '../stores/cooldownStore';
import { useCharacterStore } from '../stores/characterStore';
import { useDailyQuestStore } from '../stores/dailyQuestStore';
import type { IMonster } from '../stores/combatStore';

// -- Fixtures -----------------------------------------------------------------

const DEFAULT_SETTINGS = {
    autoPotionHpEnabled: false,
    autoPotionMpEnabled: false,
    autoPotionPctHpEnabled: false,
    autoPotionPctMpEnabled: false,
    autoPotionHpThreshold: 50,
    autoPotionMpThreshold: 50,
    autoPotionPctHpThreshold: 40,
    autoPotionPctMpThreshold: 40,
    autoPotionHpId: 'hp_potion_sm',
    autoPotionMpId: 'mp_potion_sm',
    autoPotionPctHpId: 'hp_potion_great',
    autoPotionPctMpId: 'mp_potion_great',
};

const makeMonster = (): IMonster => ({
    id: 'rat',
    name_pl: 'Szczur',
    name_en: 'Rat',
    icon: 'rat',
    level: 1,
    hp: 27,
    attack: 4,
    defense: 1,
    speed: 1,
    xp: 17,
    gold: [1, 5],
} as unknown as IMonster);

const setupStores = (settingsOverrides: Partial<typeof DEFAULT_SETTINGS> = {}): void => {
    useSettingsStore.setState({
        ...useSettingsStore.getState(),
        ...DEFAULT_SETTINGS,
        ...settingsOverrides,
    });
    useInventoryStore.setState({
        ...useInventoryStore.getState(),
        consumables: {},
    });
    useCooldownStore.getState().clearAll();
    // Combat store needs to be in fighting phase so healPlayerHp / addLog
    // don't no-op. We init a dummy fight so the store has a valid state.
    useCharacterStore.setState({
        character: {
            id: 'char-1', user_id: 'u-1', name: 'T', class: 'Knight',
            level: 10, xp: 0, hp: 100, max_hp: 100, mp: 50, max_mp: 50,
            attack: 20, defense: 10, attack_speed: 2,
            crit_chance: 0.05, crit_damage: 2.0, magic_level: 0,
            hp_regen: 0, mp_regen: 0, gold: 0, stat_points: 0,
            highest_level: 10, equipment: {},
            created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
        isLoading: false,
    });
    useCombatStore.getState().initCombat(makeMonster(), 100, 50, 'normal');
    useDailyQuestStore.setState({ lastRefreshDate: null, activeQuests: [], todayQuestDefs: [] });
};

// -- Disabled / threshold-zero / threshold-respected (no-fire branches) ------

describe('tryAutoPotion: no-fire when slot disabled', () => {
    beforeEach(() => setupStores());

    it('does NOT consume a potion when autoPotionHpEnabled=false even at 1 HP', () => {
        useInventoryStore.setState({
            ...useInventoryStore.getState(),
            consumables: { hp_potion_sm: 5 },
        });
        useSettingsStore.setState({
            ...useSettingsStore.getState(),
            autoPotionHpEnabled: false,
            autoPotionHpThreshold: 99,
        });

        tryAutoPotion(1, 100, 50, 50);

        expect(useInventoryStore.getState().consumables['hp_potion_sm']).toBe(5);
    });

    it('does NOT fire when threshold=0 (even with enabled=true + 0 HP)', () => {
        useInventoryStore.setState({
            ...useInventoryStore.getState(),
            consumables: { hp_potion_sm: 5 },
        });
        useSettingsStore.setState({
            ...useSettingsStore.getState(),
            autoPotionHpEnabled: true,
            autoPotionHpThreshold: 0,
        });

        tryAutoPotion(0, 100, 50, 50);

        expect(useInventoryStore.getState().consumables['hp_potion_sm']).toBe(5);
    });
});

describe('tryAutoPotion: no-fire when current% > threshold', () => {
    beforeEach(() => setupStores());

    it('does NOT fire HP slot when HP% (80%) > threshold (50%)', () => {
        useInventoryStore.setState({
            ...useInventoryStore.getState(),
            consumables: { hp_potion_sm: 5 },
        });
        useSettingsStore.setState({
            ...useSettingsStore.getState(),
            autoPotionHpEnabled: true,
            autoPotionHpThreshold: 50,
        });

        tryAutoPotion(80, 100, 50, 50);

        expect(useInventoryStore.getState().consumables['hp_potion_sm']).toBe(5);
    });

    it('does NOT fire HP slot at HP% exactly equal to threshold + 1', () => {
        // 51 / 100 = 51% > 50% threshold -> no fire.
        useInventoryStore.setState({
            ...useInventoryStore.getState(),
            consumables: { hp_potion_sm: 5 },
        });
        useSettingsStore.setState({
            ...useSettingsStore.getState(),
            autoPotionHpEnabled: true,
            autoPotionHpThreshold: 50,
        });

        tryAutoPotion(51, 100, 50, 50);

        expect(useInventoryStore.getState().consumables['hp_potion_sm']).toBe(5);
    });
});

describe('tryAutoPotion: no-fire when no potions owned', () => {
    beforeEach(() => setupStores());

    it('returns silently with consumables={} and HP=0 (would normally fire)', () => {
        useInventoryStore.setState({
            ...useInventoryStore.getState(),
            consumables: {},
        });
        useSettingsStore.setState({
            ...useSettingsStore.getState(),
            autoPotionHpEnabled: true,
            autoPotionHpThreshold: 90,
        });

        // Resolver returns null -> useAutoPotionSlot short-circuits.
        expect(() => tryAutoPotion(0, 100, 50, 50)).not.toThrow();
        expect(useCooldownStore.getState().hpPotionCooldown).toBe(0);
    });
});

describe('tryAutoPotion: no-fire when current >= max (safety)', () => {
    beforeEach(() => setupStores());

    it('does NOT fire when current HP equals max HP', () => {
        useInventoryStore.setState({
            ...useInventoryStore.getState(),
            consumables: { hp_potion_sm: 5 },
        });
        useSettingsStore.setState({
            ...useSettingsStore.getState(),
            autoPotionHpEnabled: true,
            autoPotionHpThreshold: 100,
        });

        tryAutoPotion(100, 100, 50, 50);

        expect(useInventoryStore.getState().consumables['hp_potion_sm']).toBe(5);
    });

    it('does NOT fire when current HP exceeds max (defensive)', () => {
        // Edge case: stale state where stats decrease — should still no-op.
        useInventoryStore.setState({
            ...useInventoryStore.getState(),
            consumables: { hp_potion_sm: 5 },
        });
        useSettingsStore.setState({
            ...useSettingsStore.getState(),
            autoPotionHpEnabled: true,
            autoPotionHpThreshold: 100,
        });

        tryAutoPotion(150, 100, 50, 50);

        expect(useInventoryStore.getState().consumables['hp_potion_sm']).toBe(5);
    });
});

describe('tryAutoPotion: no-fire when on cooldown', () => {
    beforeEach(() => setupStores());

    it('does NOT fire HP slot when hpPotionCooldown > 0 even at 1 HP', () => {
        useInventoryStore.setState({
            ...useInventoryStore.getState(),
            consumables: { hp_potion_sm: 5 },
        });
        useSettingsStore.setState({
            ...useSettingsStore.getState(),
            autoPotionHpEnabled: true,
            autoPotionHpThreshold: 100,
        });
        useCooldownStore.getState().setHpPotionCooldown(500);

        tryAutoPotion(1, 100, 50, 50);

        // Potion unspent, cooldown unchanged.
        expect(useInventoryStore.getState().consumables['hp_potion_sm']).toBe(5);
        expect(useCooldownStore.getState().hpPotionCooldown).toBe(500);
    });
});

// -- Heal-anti-waste guard (missing < healAmount -> don't fire) ---------------

describe('tryAutoPotion: anti-waste guard (heal > missing -> no fire)', () => {
    beforeEach(() => setupStores());

    it('does NOT fire hp_potion_sm (50 HP heal) when only 10 HP is missing', () => {
        // Spec comment: "no matter what the % threshold says, we will never
        // fire a potion unless at least its heal amount of HP/MP is actually missing."
        useInventoryStore.setState({
            ...useInventoryStore.getState(),
            consumables: { hp_potion_sm: 5 },
        });
        useSettingsStore.setState({
            ...useSettingsStore.getState(),
            autoPotionHpEnabled: true,
            autoPotionHpThreshold: 100, // 100% — threshold won't block
        });

        tryAutoPotion(90, 100, 50, 50); // 10 HP missing, 50 HP heal -> no fire

        expect(useInventoryStore.getState().consumables['hp_potion_sm']).toBe(5);
        expect(useCooldownStore.getState().hpPotionCooldown).toBe(0);
    });

    it('FIRES hp_potion_sm (50 HP heal) when exactly 50 HP missing (boundary)', () => {
        useInventoryStore.setState({
            ...useInventoryStore.getState(),
            consumables: { hp_potion_sm: 5 },
        });
        useSettingsStore.setState({
            ...useSettingsStore.getState(),
            autoPotionHpEnabled: true,
            autoPotionHpThreshold: 100,
        });

        tryAutoPotion(50, 100, 50, 50); // 50 missing, 50 heal -> fires.

        expect(useInventoryStore.getState().consumables['hp_potion_sm']).toBe(4);
        expect(useCooldownStore.getState().hpPotionCooldown).toBe(FLAT_POTION_COOLDOWN_MS);
    });

    it('FIRES hp_potion_sm when 60 HP missing (heal 50 < missing 60)', () => {
        useInventoryStore.setState({
            ...useInventoryStore.getState(),
            consumables: { hp_potion_sm: 5 },
        });
        useSettingsStore.setState({
            ...useSettingsStore.getState(),
            autoPotionHpEnabled: true,
            autoPotionHpThreshold: 100,
        });

        tryAutoPotion(40, 100, 50, 50); // 60 missing, 50 heal -> fires.

        expect(useInventoryStore.getState().consumables['hp_potion_sm']).toBe(4);
    });
});

// -- Healthy fire-path (decrement consumable + install CD + heal) ------------

describe('tryAutoPotion: full fire path on threshold breach', () => {
    beforeEach(() => setupStores());

    it('consumes 1 hp_potion_sm + installs 1000ms HP cooldown + heals 50 HP', () => {
        useInventoryStore.setState({
            ...useInventoryStore.getState(),
            consumables: { hp_potion_sm: 5 },
        });
        useSettingsStore.setState({
            ...useSettingsStore.getState(),
            autoPotionHpEnabled: true,
            autoPotionHpThreshold: 50,
        });
        useCombatStore.setState({
            ...useCombatStore.getState(),
            playerCurrentHp: 40,
        });

        tryAutoPotion(40, 100, 50, 50);

        // Decrement.
        expect(useInventoryStore.getState().consumables['hp_potion_sm']).toBe(4);
        // Cooldown.
        expect(useCooldownStore.getState().hpPotionCooldown).toBe(FLAT_POTION_COOLDOWN_MS);
        // Heal landed: 40 + 50 = 90.
        expect(useCombatStore.getState().playerCurrentHp).toBe(90);
    });

    it('consumes mp_potion_sm (30 MP heal) + installs MP cooldown', () => {
        useInventoryStore.setState({
            ...useInventoryStore.getState(),
            consumables: { mp_potion_sm: 3 },
        });
        useSettingsStore.setState({
            ...useSettingsStore.getState(),
            autoPotionMpEnabled: true,
            autoPotionMpThreshold: 50,
        });
        useCombatStore.setState({
            ...useCombatStore.getState(),
            playerCurrentMp: 10,
        });

        tryAutoPotion(100, 100, 10, 50); // MP 10/50 = 20% < 50%, missing=40 > heal 30

        expect(useInventoryStore.getState().consumables['mp_potion_sm']).toBe(2);
        expect(useCooldownStore.getState().mpPotionCooldown).toBe(FLAT_POTION_COOLDOWN_MS);
        expect(useCombatStore.getState().playerCurrentMp).toBe(40);
    });

    it('PCT HP slot fires with pct cooldown (500ms, half of flat)', () => {
        useInventoryStore.setState({
            ...useInventoryStore.getState(),
            consumables: { hp_potion_great: 2 }, // 20% pct
        });
        useSettingsStore.setState({
            ...useSettingsStore.getState(),
            autoPotionPctHpEnabled: true,
            autoPotionPctHpThreshold: 50,
        });
        useCombatStore.setState({
            ...useCombatStore.getState(),
            playerCurrentHp: 30,
        });

        // HP 30/100 = 30% < 50%. Heal 20% × 100 = 20. Missing = 70 ≥ 20. Fires.
        tryAutoPotion(30, 100, 50, 50);

        expect(useInventoryStore.getState().consumables['hp_potion_great']).toBe(1);
        expect(useCooldownStore.getState().pctHpCooldown).toBe(PCT_POTION_COOLDOWN_MS);
    });
});

// -- Multiple slot interaction (flat + pct should both trigger if applicable) -

describe('tryAutoPotion: independent flat + pct slot triggering', () => {
    beforeEach(() => setupStores());

    it('fires both flat HP and pct HP independently when both eligible', () => {
        useInventoryStore.setState({
            ...useInventoryStore.getState(),
            consumables: { hp_potion_sm: 5, hp_potion_great: 2 },
        });
        useSettingsStore.setState({
            ...useSettingsStore.getState(),
            autoPotionHpEnabled: true,
            autoPotionHpThreshold: 60,
            autoPotionPctHpEnabled: true,
            autoPotionPctHpThreshold: 60,
        });
        useCombatStore.setState({
            ...useCombatStore.getState(),
            playerCurrentHp: 40,
        });

        tryAutoPotion(40, 100, 50, 50);

        // Both slots fired in the same tick.
        expect(useInventoryStore.getState().consumables['hp_potion_sm']).toBe(4);
        expect(useInventoryStore.getState().consumables['hp_potion_great']).toBe(1);
        expect(useCooldownStore.getState().hpPotionCooldown).toBe(FLAT_POTION_COOLDOWN_MS);
        expect(useCooldownStore.getState().pctHpCooldown).toBe(PCT_POTION_COOLDOWN_MS);
    });

    it('fires HP slot but NOT MP slot when only HP is low', () => {
        useInventoryStore.setState({
            ...useInventoryStore.getState(),
            consumables: { hp_potion_sm: 5, mp_potion_sm: 5 },
        });
        useSettingsStore.setState({
            ...useSettingsStore.getState(),
            autoPotionHpEnabled: true,
            autoPotionHpThreshold: 60,
            autoPotionMpEnabled: true,
            autoPotionMpThreshold: 60,
        });
        useCombatStore.setState({
            ...useCombatStore.getState(),
            playerCurrentHp: 30,
            playerCurrentMp: 50, // 100% — no MP fire
        });

        tryAutoPotion(30, 100, 50, 50);

        expect(useInventoryStore.getState().consumables['hp_potion_sm']).toBe(4); // fired
        expect(useInventoryStore.getState().consumables['mp_potion_sm']).toBe(5); // unfired
    });
});

// -- resolveAutoPotionElixir contract (re-verified with engine-flow context) -

describe('resolveAutoPotionElixir contract under engine flow', () => {
    it('returns the preferred id when consumable count > 0', () => {
        const inv = { hp_potion_sm: 3 };
        const e = resolveAutoPotionElixir('hp_potion_sm', 'hp', 'flat', inv);
        expect(e?.id).toBe('hp_potion_sm');
    });

    it('falls back to highest-tier owned when preferred has 0 stock', () => {
        const inv = { hp_potion_sm: 0, hp_potion_lg: 4 };
        const e = resolveAutoPotionElixir('hp_potion_sm', 'hp', 'flat', inv);
        expect(e?.id).toBe('hp_potion_lg');
    });

    it('returns null when nothing is owned in the matching pool', () => {
        const e = resolveAutoPotionElixir('hp_potion_great', 'hp', 'pct', {});
        expect(e).toBeNull();
    });

    it('respects slotKind partition — pct request cannot pick a flat potion', () => {
        const inv = { hp_potion_sm: 5 }; // only flat owned
        const e = resolveAutoPotionElixir(undefined, 'hp', 'pct', inv);
        // Pct pool empty -> null even though flat HP is in stock.
        expect(e).toBeNull();
    });

    it('respects family partition — HP request cannot pick MP potion', () => {
        const inv = { mp_potion_sm: 5 };
        const e = resolveAutoPotionElixir(undefined, 'hp', 'flat', inv);
        expect(e).toBeNull();
    });
});
