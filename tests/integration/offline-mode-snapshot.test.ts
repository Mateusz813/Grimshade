
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    transitionToOffline,
    transitionToOnline,
    captureOfflineSnapshot,
    computeOfflineDelta,
} from '../../src/systems/connectivityTransitions';
import { useConnectivityStore } from '../../src/stores/connectivityStore';
import { useCharacterStore, type ICharacter } from '../../src/stores/characterStore';
import { useInventoryStore } from '../../src/stores/inventoryStore';
import { EMPTY_EQUIPMENT } from '../../src/systems/itemSystem';


const makeChar = (overrides: Partial<ICharacter> = {}): ICharacter => ({
    id: 'char-offline-1',
    user_id: 'user-1',
    name: 'OffPlayer',
    class: 'Mage',
    level: 50,
    xp: 12000,
    hp: 400,
    max_hp: 400,
    mp: 800,
    max_mp: 800,
    attack: 30,
    defense: 15,
    attack_speed: 2.5,
    crit_chance: 5,
    crit_damage: 200,
    magic_level: 10,
    hp_regen: 0,
    mp_regen: 1,
    gold: 0,
    stat_points: 0,
    highest_level: 50,
    equipment: {},
    created_at: '',
    updated_at: '',
    ...overrides,
} as ICharacter);

const resetAll = (): void => {
    localStorage.clear();
    sessionStorage.clear();
    useCharacterStore.setState({ character: null, isLoading: false });
    useInventoryStore.setState({
        bag: [], equipment: { ...EMPTY_EQUIPMENT }, deposit: [],
        gold: 0, arenaPoints: 0, consumables: {}, stones: {},
    });
    useConnectivityStore.setState({
        mode: 'online',
        userExplicitlyOffline: false,
        isNetworkUp: true,
        snapshot: null,
    });
};

let infoSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
    resetAll();
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    infoSpy.mockRestore();
    warnSpy.mockRestore();
});


describe('offline mode: snapshot captures pre-offline state', () => {
    it('captures gold + level + xp + item count at the moment we go offline', () => {
        useCharacterStore.getState().setCharacter(makeChar({ level: 50, xp: 12000 }));
        useInventoryStore.setState({
            bag: [], equipment: { ...EMPTY_EQUIPMENT }, deposit: [],
            gold: 1000, arenaPoints: 0, consumables: {}, stones: {},
        });

        transitionToOffline({ explicit: true });

        const snap = useConnectivityStore.getState().snapshot;
        expect(snap).not.toBeNull();
        expect(snap?.characterId).toBe('char-offline-1');
        expect(snap?.level).toBe(50);
        expect(snap?.xp).toBe(12000);
        expect(snap?.gold).toBe(1000);
    });

    it('flips the play mode to offline AND records explicit=true', () => {
        useCharacterStore.getState().setCharacter(makeChar());
        transitionToOffline({ explicit: true });
        const c = useConnectivityStore.getState();
        expect(c.mode).toBe('offline');
        expect(c.userExplicitlyOffline).toBe(true);
    });

    it('flips the play mode but keeps explicit=false on a DC-driven transition', () => {
        useCharacterStore.getState().setCharacter(makeChar());
        transitionToOffline({ explicit: false });
        const c = useConnectivityStore.getState();
        expect(c.mode).toBe('offline');
        expect(c.userExplicitlyOffline).toBe(false);
    });

    it('persists the snapshot into sessionStorage so an F5 can resume offline', () => {
        useCharacterStore.getState().setCharacter(makeChar());
        transitionToOffline({ explicit: true });
        const raw = sessionStorage.getItem('grimshade.offlineSnapshot');
        expect(raw).not.toBeNull();
        const parsed = JSON.parse(raw!) as { characterId: string };
        expect(parsed.characterId).toBe('char-offline-1');
    });
});

describe('offline mode: live state diverges from snapshot during the session', () => {
    it('snapshot reflects ORIGINAL state even after live state has been mutated', () => {
        useCharacterStore.getState().setCharacter(makeChar({ level: 50, xp: 12000 }));
        useInventoryStore.setState({
            bag: [], equipment: { ...EMPTY_EQUIPMENT }, deposit: [],
            gold: 1000, arenaPoints: 0, consumables: {}, stones: {},
        });
        transitionToOffline({ explicit: true });

        useInventoryStore.getState().addGold(1000);
        useCharacterStore.getState().updateCharacter({ xp: 14000 });

        const snap = useConnectivityStore.getState().snapshot!;
        expect(snap.gold).toBe(1000);
        expect(snap.xp).toBe(12000);
        expect(useInventoryStore.getState().gold).toBe(2000);
        expect(useCharacterStore.getState().character?.xp).toBe(14000);
    });
});

describe('offline mode: transitionToOnline clears snapshot + computes delta', () => {
    it('clears the snapshot after a successful online transition', async () => {
        useCharacterStore.getState().setCharacter(makeChar());
        transitionToOffline({ explicit: true });
        expect(useConnectivityStore.getState().snapshot).not.toBeNull();

        await transitionToOnline();
        expect(useConnectivityStore.getState().snapshot).toBeNull();
    });

    it('flips mode back to online (and resets explicit to false)', async () => {
        useCharacterStore.getState().setCharacter(makeChar());
        transitionToOffline({ explicit: true });
        await transitionToOnline();
        const c = useConnectivityStore.getState();
        expect(c.mode).toBe('online');
        expect(c.userExplicitlyOffline).toBe(false);
    });

    it('returns a delta describing what changed during the offline session', async () => {
        useCharacterStore.getState().setCharacter(makeChar({ level: 50, xp: 0 }));
        useInventoryStore.setState({
            bag: [], equipment: { ...EMPTY_EQUIPMENT }, deposit: [],
            gold: 100, arenaPoints: 0, consumables: {}, stones: {},
        });
        transitionToOffline({ explicit: true });

        useInventoryStore.getState().addGold(250);
        useCharacterStore.getState().updateCharacter({ xp: 1000, level: 51 });

        const delta = await transitionToOnline();
        expect(delta).not.toBeNull();
        expect(delta?.levelGained).toBe(1);
        expect(delta?.goldDelta).toBe(250);
        expect(delta?.suspicious).toBe(false);
    });

    it('flags absurdly large gold jumps as suspicious (anti-cheat audit hook)', async () => {
        useCharacterStore.getState().setCharacter(makeChar());
        useInventoryStore.setState({
            bag: [], equipment: { ...EMPTY_EQUIPMENT }, deposit: [],
            gold: 100, arenaPoints: 0, consumables: {}, stones: {},
        });
        transitionToOffline({ explicit: true });

        useInventoryStore.setState({
            bag: [], equipment: { ...EMPTY_EQUIPMENT }, deposit: [],
            gold: 100_000, arenaPoints: 0, consumables: {}, stones: {},
        });

        const delta = await transitionToOnline();
        expect(delta?.suspicious).toBe(true);
        expect(delta?.reasons.join(' ')).toContain('gold');
    });

    it('returns null delta when the character was swapped underneath us', () => {
        useCharacterStore.getState().setCharacter(makeChar({ id: 'char-A' }));
        captureOfflineSnapshot();
        const snap = useConnectivityStore.getState().snapshot!;
        useCharacterStore.getState().setCharacter(makeChar({ id: 'char-B' }));
        expect(computeOfflineDelta(snap)).toBeNull();
    });
});

describe('offline mode: idempotency under back-to-back transitions', () => {
    it('a second transitionToOffline overwrites the snapshot with current state', () => {
        useCharacterStore.getState().setCharacter(makeChar({ xp: 100 }));
        transitionToOffline({ explicit: true });
        const firstSnap = useConnectivityStore.getState().snapshot!;
        expect(firstSnap.xp).toBe(100);

        useCharacterStore.getState().updateCharacter({ xp: 5000 });
        transitionToOffline({ explicit: true });
        const secondSnap = useConnectivityStore.getState().snapshot!;
        expect(secondSnap.xp).toBe(5000);
    });
});
