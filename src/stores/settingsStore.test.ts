import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock i18n BEFORE the store is imported. The store calls
// `i18n.changeLanguage()` inside its `setLanguage` action; we don't want
// that to actually trigger a language switch (and don't want to depend on
// i18next's init promise either).
vi.mock('../i18n/index', () => ({
    default: { changeLanguage: vi.fn() },
}));

// Import AFTER the mock so the module factory above intercepts the import.
import { useSettingsStore } from './settingsStore';

// Snapshot of the documented defaults — kept in sync with settingsStore.ts.
const DEFAULTS = {
    language: 'pl' as const,
    combatSpeed: 'x1' as const,
    skillMode: 'auto' as const,
    autoPotionHpEnabled: true,
    autoPotionMpEnabled: true,
    autoPotionHpThreshold: 50,
    autoPotionMpThreshold: 50,
    autoPotionHpId: 'hp_potion_sm',
    autoPotionMpId: 'mp_potion_sm',
    autoPotionPctHpEnabled: false,
    autoPotionPctMpEnabled: false,
    autoPotionPctHpThreshold: 40,
    autoPotionPctMpThreshold: 40,
    autoPotionPctHpId: 'hp_potion_great',
    autoPotionPctMpId: 'mp_potion_great',
    showCombatXpBar: true,
    autoSellCommon: false,
    autoSellRare: false,
    autoSellEpic: false,
    autoSellLegendary: false,
    autoSellMythic: false,
    huntFilterAvailableOnly: false,
    huntFilterTaskedOnly: false,
    huntFilterMinLevel: 0,
    huntFilterSortDesc: false,
    dungeonFilterAvailableOnly: false,
    dungeonFilterMinLevel: 0,
    dungeonFilterSortDesc: false,
    raidFilterAvailableOnly: false,
    raidFilterMinLevel: 0,
    raidFilterSortDesc: false,
    bossFilterAvailableOnly: false,
    bossFilterMinLevel: 0,
    bossFilterSortDesc: false,
    taskFilterAvailableOnly: false,
    taskFilterInactiveOnly: false,
    taskFilterSortDesc: false,
    taskFilterLvlFrom: '',
};

beforeEach(() => {
    useSettingsStore.setState(DEFAULTS);
});

// -- language -----------------------------------------------------------------

describe('setLanguage', () => {
    it('flips language between pl and en', () => {
        useSettingsStore.getState().setLanguage('en');
        expect(useSettingsStore.getState().language).toBe('en');
        useSettingsStore.getState().setLanguage('pl');
        expect(useSettingsStore.getState().language).toBe('pl');
    });
});

// -- combat speed / skill mode ------------------------------------------------

describe('setCombatSpeed', () => {
    it('cycles through allowed speeds', () => {
        const speeds = ['x1', 'x2', 'x4', 'SKIP'] as const;
        for (const s of speeds) {
            useSettingsStore.getState().setCombatSpeed(s);
            expect(useSettingsStore.getState().combatSpeed).toBe(s);
        }
    });
});

describe('setSkillMode', () => {
    it('flips between auto and manual', () => {
        useSettingsStore.getState().setSkillMode('manual');
        expect(useSettingsStore.getState().skillMode).toBe('manual');
        useSettingsStore.getState().setSkillMode('auto');
        expect(useSettingsStore.getState().skillMode).toBe('auto');
    });
});

// -- flat auto-potion (slot 1) ------------------------------------------------

describe('flat auto-potion setters', () => {
    it('toggles HP/MP enabled flags', () => {
        const s = useSettingsStore.getState();
        s.setAutoPotionHpEnabled(false);
        s.setAutoPotionMpEnabled(false);
        expect(useSettingsStore.getState().autoPotionHpEnabled).toBe(false);
        expect(useSettingsStore.getState().autoPotionMpEnabled).toBe(false);
    });

    it('stores HP/MP thresholds verbatim (no clamping in the setter)', () => {
        // The store currently does NOT clamp; documenting the contract.
        useSettingsStore.getState().setAutoPotionHpThreshold(35);
        useSettingsStore.getState().setAutoPotionMpThreshold(80);
        expect(useSettingsStore.getState().autoPotionHpThreshold).toBe(35);
        expect(useSettingsStore.getState().autoPotionMpThreshold).toBe(80);
    });

    it('stores potion ids', () => {
        useSettingsStore.getState().setAutoPotionHpId('hp_potion');
        useSettingsStore.getState().setAutoPotionMpId('mp_potion');
        expect(useSettingsStore.getState().autoPotionHpId).toBe('hp_potion');
        expect(useSettingsStore.getState().autoPotionMpId).toBe('mp_potion');
    });
});

// -- pct auto-potion (slot 2) -------------------------------------------------

describe('pct auto-potion setters', () => {
    it('toggles pct HP/MP enabled flags', () => {
        const s = useSettingsStore.getState();
        s.setAutoPotionPctHpEnabled(true);
        s.setAutoPotionPctMpEnabled(true);
        expect(useSettingsStore.getState().autoPotionPctHpEnabled).toBe(true);
        expect(useSettingsStore.getState().autoPotionPctMpEnabled).toBe(true);
    });

    it('stores pct thresholds + ids', () => {
        const s = useSettingsStore.getState();
        s.setAutoPotionPctHpThreshold(25);
        s.setAutoPotionPctMpThreshold(30);
        s.setAutoPotionPctHpId('hp_potion_divine');
        s.setAutoPotionPctMpId('mp_potion_divine');
        const state = useSettingsStore.getState();
        expect(state.autoPotionPctHpThreshold).toBe(25);
        expect(state.autoPotionPctMpThreshold).toBe(30);
        expect(state.autoPotionPctHpId).toBe('hp_potion_divine');
        expect(state.autoPotionPctMpId).toBe('mp_potion_divine');
    });
});

// -- auto-sell flags ----------------------------------------------------------

describe('auto-sell setters', () => {
    it('flips each rarity flag independently', () => {
        const s = useSettingsStore.getState();
        s.setAutoSellCommon(true);
        s.setAutoSellRare(true);
        s.setAutoSellEpic(true);
        s.setAutoSellLegendary(true);
        s.setAutoSellMythic(true);
        const state = useSettingsStore.getState();
        expect(state.autoSellCommon).toBe(true);
        expect(state.autoSellRare).toBe(true);
        expect(state.autoSellEpic).toBe(true);
        expect(state.autoSellLegendary).toBe(true);
        expect(state.autoSellMythic).toBe(true);
    });

    it('does not coerce — false stays false', () => {
        useSettingsStore.getState().setAutoSellCommon(true);
        useSettingsStore.getState().setAutoSellCommon(false);
        expect(useSettingsStore.getState().autoSellCommon).toBe(false);
    });
});

// -- combat XP bar (uses localStorage side effect) -----------------------------

describe('setShowCombatXpBar', () => {
    it('persists the value to localStorage and updates state', () => {
        useSettingsStore.getState().setShowCombatXpBar(false);
        expect(useSettingsStore.getState().showCombatXpBar).toBe(false);
        expect(window.localStorage.getItem('showCombatXpBar')).toBe('false');
        useSettingsStore.getState().setShowCombatXpBar(true);
        expect(useSettingsStore.getState().showCombatXpBar).toBe(true);
        expect(window.localStorage.getItem('showCombatXpBar')).toBe('true');
    });
});

// -- hunt / dungeon / raid / boss filters -------------------------------------
//
// All four filter blocks expose the same shape: availableOnly + minLevel +
// sortDesc, with the minLevel setter clamping negatives to 0 and flooring
// fractions. Group them under a single describe to keep noise low.

describe('list filter setters', () => {
    it('hunt filters: toggle + clamp', () => {
        const s = useSettingsStore.getState();
        s.setHuntFilterAvailableOnly(true);
        s.setHuntFilterTaskedOnly(true);
        s.setHuntFilterSortDesc(true);
        s.setHuntFilterMinLevel(-5);
        expect(useSettingsStore.getState().huntFilterAvailableOnly).toBe(true);
        expect(useSettingsStore.getState().huntFilterTaskedOnly).toBe(true);
        expect(useSettingsStore.getState().huntFilterSortDesc).toBe(true);
        // Negative input clamped to 0.
        expect(useSettingsStore.getState().huntFilterMinLevel).toBe(0);
    });

    it('hunt filters: minLevel floored on fractional input', () => {
        useSettingsStore.getState().setHuntFilterMinLevel(12.7);
        expect(useSettingsStore.getState().huntFilterMinLevel).toBe(12);
    });

    it('dungeon filters: toggle + clamp', () => {
        const s = useSettingsStore.getState();
        s.setDungeonFilterAvailableOnly(true);
        s.setDungeonFilterSortDesc(true);
        s.setDungeonFilterMinLevel(7);
        expect(useSettingsStore.getState().dungeonFilterAvailableOnly).toBe(true);
        expect(useSettingsStore.getState().dungeonFilterSortDesc).toBe(true);
        expect(useSettingsStore.getState().dungeonFilterMinLevel).toBe(7);
        useSettingsStore.getState().setDungeonFilterMinLevel(-99);
        expect(useSettingsStore.getState().dungeonFilterMinLevel).toBe(0);
    });

    it('raid filters: independent of dungeon filters', () => {
        const s = useSettingsStore.getState();
        s.setDungeonFilterMinLevel(50);
        s.setRaidFilterMinLevel(200);
        expect(useSettingsStore.getState().dungeonFilterMinLevel).toBe(50);
        expect(useSettingsStore.getState().raidFilterMinLevel).toBe(200);
    });

    it('boss filters: independent of dungeon/raid', () => {
        const s = useSettingsStore.getState();
        s.setBossFilterAvailableOnly(true);
        s.setBossFilterSortDesc(true);
        s.setBossFilterMinLevel(900);
        const state = useSettingsStore.getState();
        expect(state.bossFilterAvailableOnly).toBe(true);
        expect(state.bossFilterSortDesc).toBe(true);
        expect(state.bossFilterMinLevel).toBe(900);
    });

    it('any filter: passing NaN/undefined-coerced 0 falls back to 0 (|| 0 guard)', () => {
        // Math.floor(NaN || 0) -> 0; pinning the documented behaviour here so
        // a stray bad number doesn't blow up the hub.
        useSettingsStore.getState().setHuntFilterMinLevel(Number.NaN);
        expect(useSettingsStore.getState().huntFilterMinLevel).toBe(0);
    });
});

// 2026-06-24: Quests "taski" filters/sort — persisted per-character so they
// survive reloads (registered in characterScope stateKeys alongside the other
// *Filter* controls).
describe('task filter/sort setters (persisted)', () => {
    it('default to show-everything / ascending / no level floor', () => {
        const s = useSettingsStore.getState();
        expect(s.taskFilterAvailableOnly).toBe(false);
        expect(s.taskFilterInactiveOnly).toBe(false);
        expect(s.taskFilterSortDesc).toBe(false);
        expect(s.taskFilterLvlFrom).toBe('');
    });

    it('setters update each field', () => {
        useSettingsStore.getState().setTaskFilterAvailableOnly(true);
        useSettingsStore.getState().setTaskFilterInactiveOnly(true);
        useSettingsStore.getState().setTaskFilterSortDesc(true);
        useSettingsStore.getState().setTaskFilterLvlFrom('65');
        const s = useSettingsStore.getState();
        expect(s.taskFilterAvailableOnly).toBe(true);
        expect(s.taskFilterInactiveOnly).toBe(true);
        expect(s.taskFilterSortDesc).toBe(true);
        expect(s.taskFilterLvlFrom).toBe('65');
    });
});
