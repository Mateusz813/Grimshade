import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── characterScope mock ──────────────────────────────────────────────────────
// transitionToOnline awaits saveCurrentCharacterStores → we need to spy on it
// without doing real Supabase / file IO. saveCurrentCharacterStoresSync is
// called synchronously by captureOfflineSnapshot; it must not throw.
//
// vi.hoisted() runs BEFORE vi.mock factories (which are themselves hoisted to
// the top of the file). That guarantees the mock fns are initialized when
// vitest patches the import.
const { saveCurrentCharacterStoresMock, saveCurrentCharacterStoresSyncMock } = vi.hoisted(() => ({
    saveCurrentCharacterStoresMock: vi.fn().mockResolvedValue(undefined),
    saveCurrentCharacterStoresSyncMock: vi.fn(),
}));

vi.mock('../stores/characterScope', () => ({
    saveCurrentCharacterStores: saveCurrentCharacterStoresMock,
    saveCurrentCharacterStoresSync: saveCurrentCharacterStoresSyncMock,
}));

import {
    captureOfflineSnapshot,
    computeOfflineDelta,
    transitionToOffline,
    transitionToOnline,
} from './connectivityTransitions';
import { useCharacterStore } from '../stores/characterStore';
import { useInventoryStore } from '../stores/inventoryStore';
import { useConnectivityStore } from '../stores/connectivityStore';
import { usePartyStore } from '../stores/partyStore';
import { useCombatStore } from '../stores/combatStore';
import { EMPTY_EQUIPMENT, type IInventoryItem } from './itemSystem';
import type { ICharacter } from '../api/v1/characterApi';
import type { IMonster } from '../types/monster';
import type { IPartyInfo } from '../types/party';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const makeCharacter = (overrides?: Partial<ICharacter>): ICharacter => ({
    id: 'char-1',
    user_id: 'user-1',
    name: 'Tester',
    class: 'Knight',
    level: 10,
    xp: 1000,
    hp: 200,
    max_hp: 200,
    mp: 50,
    max_mp: 50,
    attack: 20,
    defense: 10,
    attack_speed: 2,
    crit_chance: 5,
    crit_damage: 150,
    magic_level: 0,
    hp_regen: 0,
    mp_regen: 0,
    gold: 500,
    stat_points: 0,
    highest_level: 10,
    equipment: {},
    created_at: '2026-05-21T00:00:00Z',
    updated_at: '2026-05-21T00:00:00Z',
    ...overrides,
});

const makeBagItem = (overrides?: Partial<IInventoryItem>): IInventoryItem => ({
    uuid: 'item-uuid-1',
    itemId: 'sword_lvl1_common',
    rarity: 'common',
    bonuses: {},
    itemLevel: 1,
    upgradeLevel: 0,
    ...overrides,
});

// ── Lifecycle ────────────────────────────────────────────────────────────────

beforeEach(() => {
    // Reset both Zustand stores to a known empty state before each test so
    // state never leaks across `describe` blocks.
    useCharacterStore.setState({ character: null, isLoading: false });
    useInventoryStore.setState({
        bag: [],
        equipment: { ...EMPTY_EQUIPMENT },
        deposit: [],
        gold: 0,
        arenaPoints: 0,
        consumables: {},
        stones: {},
    });
    useConnectivityStore.setState({
        mode: 'online',
        userExplicitlyOffline: false,
        isNetworkUp: true,
        snapshot: null,
    });
    usePartyStore.setState({ party: null, loading: false, error: null });
    useCombatStore.getState().resetCombat();
    saveCurrentCharacterStoresMock.mockClear();
    saveCurrentCharacterStoresSyncMock.mockClear();
    if (typeof window !== 'undefined') {
        window.localStorage.clear();
        window.sessionStorage.clear();
    }
});

afterEach(() => {
    vi.restoreAllMocks();
});

// ── captureOfflineSnapshot ───────────────────────────────────────────────────

describe('captureOfflineSnapshot', () => {
    it('returns null when there is no active character', () => {
        const snap = captureOfflineSnapshot();
        expect(snap).toBeNull();
        // setSnapshot must NOT be touched when no character is present —
        // we don't want a half-baked baseline ending up in the store.
        expect(useConnectivityStore.getState().snapshot).toBeNull();
        // saveCurrentCharacterStoresSync is also not invoked in the null
        // path (early return before the flush call).
        expect(saveCurrentCharacterStoresSyncMock).not.toHaveBeenCalled();
    });

    it('captures level / xp / hp / mp / gold from the live stores', () => {
        const character = makeCharacter({ level: 25, xp: 5000, hp: 180, mp: 30 });
        useCharacterStore.setState({ character });
        useInventoryStore.setState({
            bag: [],
            equipment: { ...EMPTY_EQUIPMENT },
            deposit: [],
            gold: 1234,
            arenaPoints: 0,
            consumables: {},
            stones: {},
        });

        const snap = captureOfflineSnapshot();
        expect(snap).not.toBeNull();
        expect(snap!.characterId).toBe('char-1');
        expect(snap!.level).toBe(25);
        expect(snap!.xp).toBe(5000);
        expect(snap!.hp).toBe(180);
        expect(snap!.mp).toBe(30);
        expect(snap!.gold).toBe(1234);
        expect(typeof snap!.capturedAt).toBe('string');
        // The ISO timestamp should parse back into a valid Date.
        expect(Number.isNaN(new Date(snap!.capturedAt).getTime())).toBe(false);
    });

    it('counts items across bag + equipment slots', () => {
        useCharacterStore.setState({ character: makeCharacter() });
        useInventoryStore.setState({
            bag: [
                makeBagItem({ uuid: 'a' }),
                makeBagItem({ uuid: 'b' }),
            ],
            equipment: {
                ...EMPTY_EQUIPMENT,
                mainHand: makeBagItem({ uuid: 'eq-1' }),
                helmet: makeBagItem({ uuid: 'eq-2' }),
            },
            deposit: [],
            gold: 0,
            arenaPoints: 0,
            consumables: {},
            stones: {},
        });

        const snap = captureOfflineSnapshot()!;
        // 2 bag stacks (default quantity=1) + 2 equipped items = 4
        expect(snap.itemCount).toBe(4);
    });

    it('respects per-stack `quantity` field on bag items when counting', () => {
        useCharacterStore.setState({ character: makeCharacter() });
        useInventoryStore.setState({
            bag: [
                { ...makeBagItem({ uuid: 'stack-a' }), quantity: 5 } as IInventoryItem & { quantity: number },
                { ...makeBagItem({ uuid: 'stack-b' }), quantity: 3 } as IInventoryItem & { quantity: number },
            ],
            equipment: { ...EMPTY_EQUIPMENT },
            deposit: [],
            gold: 0,
            arenaPoints: 0,
            consumables: {},
            stones: {},
        });

        const snap = captureOfflineSnapshot()!;
        expect(snap.itemCount).toBe(8);
    });

    it('flushes stores via saveCurrentCharacterStoresSync before snapshotting', () => {
        useCharacterStore.setState({ character: makeCharacter() });
        captureOfflineSnapshot();
        expect(saveCurrentCharacterStoresSyncMock).toHaveBeenCalledTimes(1);
    });

    it('persists the snapshot via connectivityStore.setSnapshot', () => {
        useCharacterStore.setState({ character: makeCharacter() });
        const snap = captureOfflineSnapshot();
        expect(useConnectivityStore.getState().snapshot).toEqual(snap);
    });

    it('attaches storesBlob from localStorage when present', () => {
        useCharacterStore.setState({ character: makeCharacter({ id: 'char-blob' }) });
        // Mirror the format characterScope writes: `{ state, updated_at }`.
        window.localStorage.setItem(
            'dungeon_rpg_save_char_char-blob',
            JSON.stringify({ state: { foo: 'bar' }, updated_at: '2026-05-21T00:00:00Z' }),
        );
        const snap = captureOfflineSnapshot();
        expect(snap!.storesBlob).toEqual({ foo: 'bar' });
    });

    it('falls back to storesBlob=null when localStorage key is missing or malformed', () => {
        useCharacterStore.setState({ character: makeCharacter({ id: 'char-noblob' }) });
        window.localStorage.setItem(
            'dungeon_rpg_save_char_char-noblob',
            '{not_json',
        );
        const snap = captureOfflineSnapshot();
        expect(snap!.storesBlob).toBeNull();
    });
});

// ── computeOfflineDelta ──────────────────────────────────────────────────────

describe('computeOfflineDelta', () => {
    it('returns null when no character is loaded', () => {
        const snap = {
            characterId: 'char-1',
            capturedAt: new Date().toISOString(),
            level: 1, xp: 0, hp: 100, mp: 50, gold: 0, itemCount: 0, storesBlob: null,
        };
        expect(computeOfflineDelta(snap)).toBeNull();
    });

    it('returns null when active character id does not match snapshot characterId', () => {
        useCharacterStore.setState({ character: makeCharacter({ id: 'char-A' }) });
        const snap = {
            characterId: 'char-B',
            capturedAt: new Date().toISOString(),
            level: 1, xp: 0, hp: 100, mp: 50, gold: 0, itemCount: 0, storesBlob: null,
        };
        expect(computeOfflineDelta(snap)).toBeNull();
    });

    it('reports zero deltas when the live state matches the snapshot', () => {
        useCharacterStore.setState({ character: makeCharacter({ level: 10, xp: 1000 }) });
        useInventoryStore.setState({
            bag: [], equipment: { ...EMPTY_EQUIPMENT }, deposit: [], gold: 500,
            arenaPoints: 0, consumables: {}, stones: {},
        });
        const snap = {
            characterId: 'char-1',
            capturedAt: new Date().toISOString(),
            level: 10, xp: 1000, hp: 200, mp: 50, gold: 500, itemCount: 0, storesBlob: null,
        };
        const delta = computeOfflineDelta(snap)!;
        expect(delta.levelGained).toBe(0);
        expect(delta.xpGained).toBe(0);
        expect(delta.goldDelta).toBe(0);
        expect(delta.itemCountDelta).toBe(0);
        expect(delta.suspicious).toBe(false);
        expect(delta.reasons).toEqual([]);
    });

    it('computes positive deltas for level / xp / gold / item count', () => {
        useCharacterStore.setState({ character: makeCharacter({ level: 15, xp: 3000 }) });
        useInventoryStore.setState({
            bag: [makeBagItem({ uuid: 'x' })], equipment: { ...EMPTY_EQUIPMENT },
            deposit: [], gold: 2000, arenaPoints: 0, consumables: {}, stones: {},
        });
        const snap = {
            characterId: 'char-1',
            capturedAt: new Date().toISOString(),
            level: 10, xp: 1000, hp: 200, mp: 50, gold: 500, itemCount: 0, storesBlob: null,
        };
        const delta = computeOfflineDelta(snap)!;
        expect(delta.levelGained).toBe(5);
        expect(delta.xpGained).toBe(2000);
        expect(delta.goldDelta).toBe(1500);
        expect(delta.itemCountDelta).toBe(1);
        // None of these breach the absurd thresholds → not suspicious.
        expect(delta.suspicious).toBe(false);
    });

    it('flags suspicious when level jump >= ABSURD_LEVEL_JUMP (20)', () => {
        useCharacterStore.setState({ character: makeCharacter({ level: 50 }) });
        const snap = {
            characterId: 'char-1',
            capturedAt: new Date().toISOString(),
            level: 30, xp: 0, hp: 200, mp: 50, gold: 0, itemCount: 0, storesBlob: null,
        };
        const delta = computeOfflineDelta(snap)!;
        expect(delta.levelGained).toBe(20);
        expect(delta.suspicious).toBe(true);
        expect(delta.reasons.some((r) => r.includes('levels'))).toBe(true);
    });

    it('flags suspicious when gold grows by > 50× (ABSURD_GOLD_MULT)', () => {
        useCharacterStore.setState({ character: makeCharacter({ level: 10 }) });
        useInventoryStore.setState({
            bag: [], equipment: { ...EMPTY_EQUIPMENT }, deposit: [], gold: 60_000,
            arenaPoints: 0, consumables: {}, stones: {},
        });
        const snap = {
            characterId: 'char-1',
            capturedAt: new Date().toISOString(),
            level: 10, xp: 0, hp: 200, mp: 50, gold: 1000, itemCount: 0, storesBlob: null,
        };
        const delta = computeOfflineDelta(snap)!;
        expect(delta.suspicious).toBe(true);
        expect(delta.reasons.some((r) => r.includes('gold'))).toBe(true);
    });

    it('does NOT flag gold suspicion when snapshot gold was zero (cannot multiply by 0)', () => {
        useCharacterStore.setState({ character: makeCharacter({ level: 10 }) });
        useInventoryStore.setState({
            bag: [], equipment: { ...EMPTY_EQUIPMENT }, deposit: [], gold: 1_000_000,
            arenaPoints: 0, consumables: {}, stones: {},
        });
        const snap = {
            characterId: 'char-1',
            capturedAt: new Date().toISOString(),
            level: 10, xp: 0, hp: 200, mp: 50, gold: 0, itemCount: 0, storesBlob: null,
        };
        const delta = computeOfflineDelta(snap)!;
        // The guard short-circuits when snap.gold === 0, so we shouldn't see
        // a gold-related reason fire here.
        expect(delta.reasons.some((r) => r.includes('gold'))).toBe(false);
    });

    it('flags suspicious when item count grows by > 10× (ABSURD_ITEM_MULT)', () => {
        useCharacterStore.setState({ character: makeCharacter({ level: 10 }) });
        useInventoryStore.setState({
            bag: Array.from({ length: 11 }, (_, i) => makeBagItem({ uuid: `i-${i}` })),
            equipment: { ...EMPTY_EQUIPMENT }, deposit: [], gold: 0,
            arenaPoints: 0, consumables: {}, stones: {},
        });
        const snap = {
            characterId: 'char-1',
            capturedAt: new Date().toISOString(),
            level: 10, xp: 0, hp: 200, mp: 50, gold: 0, itemCount: 1, storesBlob: null,
        };
        const delta = computeOfflineDelta(snap)!;
        expect(delta.suspicious).toBe(true);
        expect(delta.reasons.some((r) => r.includes('itemy'))).toBe(true);
    });

    it('records elapsedSec as a non-negative integer based on capturedAt', () => {
        useCharacterStore.setState({ character: makeCharacter() });
        const tenSecondsAgo = new Date(Date.now() - 10_000).toISOString();
        const snap = {
            characterId: 'char-1',
            capturedAt: tenSecondsAgo,
            level: 10, xp: 1000, hp: 200, mp: 50, gold: 500, itemCount: 0, storesBlob: null,
        };
        useInventoryStore.setState({
            bag: [], equipment: { ...EMPTY_EQUIPMENT }, deposit: [], gold: 500,
            arenaPoints: 0, consumables: {}, stones: {},
        });
        const delta = computeOfflineDelta(snap)!;
        expect(delta.elapsedSec).toBeGreaterThanOrEqual(9);
        expect(delta.elapsedSec).toBeLessThanOrEqual(12);
    });

    it('clamps elapsedSec to 0 if capturedAt is in the future (clock skew)', () => {
        useCharacterStore.setState({ character: makeCharacter() });
        const tenSecondsAhead = new Date(Date.now() + 10_000).toISOString();
        const snap = {
            characterId: 'char-1',
            capturedAt: tenSecondsAhead,
            level: 10, xp: 1000, hp: 200, mp: 50, gold: 500, itemCount: 0, storesBlob: null,
        };
        const delta = computeOfflineDelta(snap)!;
        expect(delta.elapsedSec).toBe(0);
    });
});

// ── transitionToOffline ──────────────────────────────────────────────────────

describe('transitionToOffline', () => {
    it('sets mode to "offline" and records the explicit flag', () => {
        useCharacterStore.setState({ character: makeCharacter() });
        transitionToOffline({ explicit: true });

        const state = useConnectivityStore.getState();
        expect(state.mode).toBe('offline');
        expect(state.userExplicitlyOffline).toBe(true);
    });

    it('captures a snapshot before flipping the mode', () => {
        useCharacterStore.setState({ character: makeCharacter({ level: 12, xp: 600 }) });
        transitionToOffline({ explicit: false });

        const snap = useConnectivityStore.getState().snapshot;
        expect(snap).not.toBeNull();
        expect(snap!.level).toBe(12);
        expect(snap!.xp).toBe(600);
        // explicit=false → store remembers the auto-flip flavour
        expect(useConnectivityStore.getState().userExplicitlyOffline).toBe(false);
    });

    it('does not crash when no character is loaded — snapshot is null but mode still flips', () => {
        // Edge case: DC watcher fires during char-select. We still want the
        // mode flag to flip so the UI hides online-only features.
        transitionToOffline({ explicit: false });
        expect(useConnectivityStore.getState().mode).toBe('offline');
        expect(useConnectivityStore.getState().snapshot).toBeNull();
    });
});

// ── GAP #17 — offline transition does NOT drop party / kill the player ───────
//
// FINDING (documented, not a bug): the *system* function `transitionToOffline`
// is a pure snapshot-and-flip. It does NOT leave the party, clear party state,
// or mutate the player's HP/level. The "drop the party before going offline"
// rule lives entirely in the UI glue `AvatarMenu.togglePlayMode`, which calls
// `usePartyStore.leaveParty(ch.id)` BEFORE invoking `transitionToOffline`.
//
// There is also NO "die when going offline mid party-combat" logic anywhere in
// the systems layer — `AvatarMenu` just leaves the party then flips the mode.
// That behaviour, and the route-blocking it enables, is exercised at the E2E
// level (`tests/e2e/offline/mode-blocks-party-route.spec.ts` +
// `online-toggle-mid-combat-finalizes-correctly.spec.ts`).
//
// These unit tests lock in the ACTUAL system contract so a future refactor
// that accidentally bolts party/combat side effects onto `transitionToOffline`
// (double-leaving, killing the player, wiping combat) gets caught here.

const makeParty = (overrides?: Partial<IPartyInfo>): IPartyInfo => ({
    id: 'party-1',
    leaderId: 'char-1',
    members: [
        { id: 'char-1', name: 'Tester', class: 'Knight', level: 10, hp: 200, maxHp: 200, isBot: false, isOnline: true },
    ],
    createdAt: '2026-05-21T00:00:00Z',
    ...overrides,
});

const makeMonster = (overrides?: Partial<IMonster>): IMonster => ({
    id: 'rat',
    name_pl: 'Szczur',
    name_en: 'Rat',
    icon: '🐀',
    level: 1,
    hp: 27,
    attack: 4,
    defense: 1,
    speed: 1.0,
    xp: 17,
    gold: [1, 5],
    ...overrides,
} as IMonster);

describe('transitionToOffline — GAP #17 party / combat side-effect contract', () => {
    it('does NOT clear the party (party drop is UI glue, not the system fn)', () => {
        useCharacterStore.setState({ character: makeCharacter() });
        usePartyStore.setState({ party: makeParty(), loading: false, error: null });

        transitionToOffline({ explicit: true });

        // The system function leaves party state EXACTLY as-is. AvatarMenu is
        // responsible for calling leaveParty() first.
        expect(usePartyStore.getState().party).not.toBeNull();
        expect(usePartyStore.getState().party!.id).toBe('party-1');
        // Mode still flipped.
        expect(useConnectivityStore.getState().mode).toBe('offline');
    });

    it('does NOT mutate the player HP / level when going offline solo mid-combat', () => {
        // Solo combat in progress → offline must NOT kill the player or strip
        // levels. Combat state + character vitals are preserved verbatim so
        // the fight can keep running offline.
        useCharacterStore.setState({ character: makeCharacter({ level: 10, hp: 150, max_hp: 200 }) });
        usePartyStore.setState({ party: null, loading: false, error: null });
        useCombatStore.getState().initCombat(makeMonster(), 150, 50, 'normal');
        expect(useCombatStore.getState().phase).toBe('fighting');

        transitionToOffline({ explicit: true });

        const c = useCharacterStore.getState().character!;
        // No death, no level loss — vitals untouched.
        expect(c.level).toBe(10);
        expect(c.hp).toBe(150);
        // Combat keeps going (solo offline = fight continues).
        expect(useCombatStore.getState().phase).toBe('fighting');
        expect(useConnectivityStore.getState().mode).toBe('offline');
    });

    it('preserves an in-progress party-combat state at the system level (no auto-leave / no death)', () => {
        // Mirrors "in a party DURING combat" — but at the SYSTEM boundary the
        // only effect is the snapshot + mode flip. The party-leave + (UI-level)
        // consequences are AvatarMenu's job, covered by E2E.
        useCharacterStore.setState({ character: makeCharacter({ level: 10, hp: 200, max_hp: 200 }) });
        usePartyStore.setState({ party: makeParty(), loading: false, error: null });
        useCombatStore.getState().initCombat(makeMonster(), 200, 50, 'normal');

        transitionToOffline({ explicit: true });

        // Party NOT auto-dropped, player NOT killed by the system fn.
        expect(usePartyStore.getState().party).not.toBeNull();
        expect(useCharacterStore.getState().character!.hp).toBe(200);
        // A trusted baseline snapshot was still captured before the flip.
        const snap = useConnectivityStore.getState().snapshot;
        expect(snap).not.toBeNull();
        expect(snap!.level).toBe(10);
    });
});

// ── transitionToOnline ───────────────────────────────────────────────────────

describe('transitionToOnline', () => {
    it('flips mode to "online" and clears the explicit-offline flag', async () => {
        useCharacterStore.setState({ character: makeCharacter() });
        useConnectivityStore.setState({
            mode: 'offline',
            userExplicitlyOffline: true,
            isNetworkUp: true,
            snapshot: null,
        });

        await transitionToOnline();
        const state = useConnectivityStore.getState();
        expect(state.mode).toBe('online');
        expect(state.userExplicitlyOffline).toBe(false);
    });

    it('calls saveCurrentCharacterStores exactly once on successful sync', async () => {
        useCharacterStore.setState({ character: makeCharacter() });
        await transitionToOnline();
        expect(saveCurrentCharacterStoresMock).toHaveBeenCalledTimes(1);
    });

    it('clears the snapshot after a successful sync', async () => {
        useCharacterStore.setState({ character: makeCharacter() });
        useConnectivityStore.setState({
            mode: 'offline',
            userExplicitlyOffline: false,
            isNetworkUp: true,
            snapshot: {
                characterId: 'char-1',
                capturedAt: new Date().toISOString(),
                level: 10, xp: 1000, hp: 200, mp: 50, gold: 500, itemCount: 0, storesBlob: null,
            },
        });

        await transitionToOnline();
        expect(useConnectivityStore.getState().snapshot).toBeNull();
    });

    it('returns a delta when a snapshot was present', async () => {
        useCharacterStore.setState({ character: makeCharacter({ level: 15, xp: 5000 }) });
        useInventoryStore.setState({
            bag: [], equipment: { ...EMPTY_EQUIPMENT }, deposit: [], gold: 1000,
            arenaPoints: 0, consumables: {}, stones: {},
        });
        useConnectivityStore.setState({
            mode: 'offline',
            userExplicitlyOffline: false,
            isNetworkUp: true,
            snapshot: {
                characterId: 'char-1',
                capturedAt: new Date().toISOString(),
                level: 10, xp: 1000, hp: 200, mp: 50, gold: 500, itemCount: 0, storesBlob: null,
            },
        });

        const delta = await transitionToOnline();
        expect(delta).not.toBeNull();
        expect(delta!.levelGained).toBe(5);
        expect(delta!.goldDelta).toBe(500);
    });

    it('returns null delta when no snapshot was captured beforehand', async () => {
        useCharacterStore.setState({ character: makeCharacter() });
        // snapshot stays null
        const delta = await transitionToOnline();
        expect(delta).toBeNull();
        // Sync still happened — coming back online always pushes.
        expect(saveCurrentCharacterStoresMock).toHaveBeenCalledTimes(1);
    });

    it('keeps the snapshot when saveCurrentCharacterStores rejects', async () => {
        useCharacterStore.setState({ character: makeCharacter({ level: 10 }) });
        const snap = {
            characterId: 'char-1',
            capturedAt: new Date().toISOString(),
            level: 10, xp: 1000, hp: 200, mp: 50, gold: 500, itemCount: 0, storesBlob: null,
        };
        useConnectivityStore.setState({
            mode: 'offline',
            userExplicitlyOffline: false,
            isNetworkUp: true,
            snapshot: snap,
        });
        saveCurrentCharacterStoresMock.mockRejectedValueOnce(new Error('network down'));

        const delta = await transitionToOnline();
        // Delta still computed before the sync attempt.
        expect(delta).not.toBeNull();
        // Snapshot is preserved so the next sync attempt can compare again.
        expect(useConnectivityStore.getState().snapshot).not.toBeNull();
        // Mode was flipped to online BEFORE the failing sync, so it stays online.
        expect(useConnectivityStore.getState().mode).toBe('online');
    });

    it('flips mode to online BEFORE awaiting saveCurrentCharacterStores', async () => {
        useCharacterStore.setState({ character: makeCharacter() });
        useConnectivityStore.setState({
            mode: 'offline',
            userExplicitlyOffline: true,
            isNetworkUp: true,
            snapshot: null,
        });
        // Track the mode state at the moment our mocked sync is invoked. The
        // mode must already be 'online' so that any concurrent background
        // sync sees the new value.
        let modeWhenSyncCalled: string | null = null;
        saveCurrentCharacterStoresMock.mockImplementationOnce(async () => {
            modeWhenSyncCalled = useConnectivityStore.getState().mode;
        });

        await transitionToOnline();
        expect(modeWhenSyncCalled).toBe('online');
    });

    it('logs suspicious deltas to the console (audit trail)', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);

        useCharacterStore.setState({ character: makeCharacter({ level: 50 }) });
        useConnectivityStore.setState({
            mode: 'offline',
            userExplicitlyOffline: false,
            isNetworkUp: true,
            snapshot: {
                characterId: 'char-1',
                capturedAt: new Date().toISOString(),
                level: 20, xp: 0, hp: 200, mp: 50, gold: 0, itemCount: 0, storesBlob: null,
            },
        });

        await transitionToOnline();

        expect(infoSpy).toHaveBeenCalled();
        // Suspicious path triggers a console.warn with "SUSPICIOUS" prefix.
        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining('SUSPICIOUS'),
            expect.any(String),
        );
    });
});

// ── TODO ─────────────────────────────────────────────────────────────────────
// TODO(line ~80): the snapshot serialization round-trip via sessionStorage is
// exercised only indirectly here. A dedicated test would set a snapshot,
// reload the module, and assert it bootstraps in offline mode — that
// requires a `vi.resetModules()` dance and a clean import which is fiddly
// in vitest with the global setup file. Left out for now to keep the
// test surface focused on the transition helpers themselves.
//
// TODO(line ~250): `transitionToOffline` is called by both the avatar-menu
// toggle AND the DC watcher; the explicit-flag semantics differ. The tests
// here cover both `explicit: true` and `explicit: false` but don't verify
// what happens when the DC watcher auto-flips while the player had earlier
// chosen offline explicitly — that interaction lives in connectivityStore
// and is owned by its own tests.
