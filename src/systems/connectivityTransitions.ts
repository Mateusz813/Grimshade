
import { useCharacterStore } from '../stores/characterStore';
import { useInventoryStore } from '../stores/inventoryStore';
import { useConnectivityStore, type IOfflineSnapshot } from '../stores/connectivityStore';
import {
    saveCurrentCharacterStores,
    saveCurrentCharacterStoresSync,
} from '../stores/characterScope';

const countItems = (): number => {
    const inv = useInventoryStore.getState();
    let n = 0;
    for (const slot of inv.bag ?? []) {
        if (slot) n += (slot as { quantity?: number }).quantity ?? 1;
    }
    for (const eqSlot of Object.values(inv.equipment ?? {})) {
        if (eqSlot) n += 1;
    }
    return n;
};

export const captureOfflineSnapshot = (): IOfflineSnapshot | null => {
    const char = useCharacterStore.getState().character;
    if (!char) return null;

    saveCurrentCharacterStoresSync();

    let storesBlob: Record<string, unknown> | null = null;
    try {
        const raw = localStorage.getItem(`dungeon_rpg_save_char_${char.id}`);
        if (raw) {
            const parsed = JSON.parse(raw) as { state?: Record<string, unknown> };
            storesBlob = parsed?.state ?? null;
        }
    } catch {
        storesBlob = null;
    }

    const inv = useInventoryStore.getState();
    const snap: IOfflineSnapshot = {
        characterId: char.id,
        capturedAt: new Date().toISOString(),
        level: char.level,
        xp: char.xp,
        hp: char.hp,
        mp: char.mp,
        gold: inv.gold ?? 0,
        itemCount: countItems(),
        storesBlob,
    };
    useConnectivityStore.getState().setSnapshot(snap);
    return snap;
};

export interface IOfflineDelta {
    levelGained: number;
    xpGained: number;
    goldDelta: number;
    itemCountDelta: number;
    elapsedSec: number;
    suspicious: boolean;
    reasons: string[];
}

const ABSURD_LEVEL_JUMP = 20;
const ABSURD_GOLD_MULT = 50;
const ABSURD_ITEM_MULT = 10;

export const computeOfflineDelta = (snap: IOfflineSnapshot): IOfflineDelta | null => {
    const char = useCharacterStore.getState().character;
    if (!char) return null;
    if (char.id !== snap.characterId) return null;

    const inv = useInventoryStore.getState();
    const liveGold = inv.gold ?? 0;
    const liveItemCount = countItems();
    const elapsedSec = Math.max(0, Math.floor(
        (Date.now() - new Date(snap.capturedAt).getTime()) / 1000,
    ));

    const levelGained = char.level - snap.level;
    const xpGained = char.xp - snap.xp;
    const goldDelta = liveGold - snap.gold;
    const itemCountDelta = liveItemCount - snap.itemCount;

    const reasons: string[] = [];
    if (levelGained >= ABSURD_LEVEL_JUMP) {
        reasons.push(`+${levelGained} levels w jednej sesji offline`);
    }
    if (snap.gold > 0 && liveGold > snap.gold * ABSURD_GOLD_MULT) {
        reasons.push(`gold ${snap.gold} -> ${liveGold} (×${(liveGold / snap.gold).toFixed(1)})`);
    }
    if (snap.itemCount > 0 && liveItemCount > snap.itemCount * ABSURD_ITEM_MULT) {
        reasons.push(`itemy ${snap.itemCount} -> ${liveItemCount} (×${(liveItemCount / snap.itemCount).toFixed(1)})`);
    }
    return {
        levelGained,
        xpGained,
        goldDelta,
        itemCountDelta,
        elapsedSec,
        suspicious: reasons.length > 0,
        reasons,
    };
};

export const transitionToOffline = (opts: { explicit: boolean }): void => {
    captureOfflineSnapshot();
    useConnectivityStore.getState().setMode('offline', { explicit: opts.explicit });
};

export const transitionToOnline = async (): Promise<IOfflineDelta | null> => {
    const snap = useConnectivityStore.getState().snapshot;
    let delta: IOfflineDelta | null = null;
    if (snap) {
        delta = computeOfflineDelta(snap);
        if (delta) {
            console.info('[connectivity] Offline delta', {
                durationSec: delta.elapsedSec,
                levelGained: delta.levelGained,
                xpGained: delta.xpGained,
                goldDelta: delta.goldDelta,
                itemCountDelta: delta.itemCountDelta,
                suspicious: delta.suspicious,
                reasons: delta.reasons,
            });
            if (delta.suspicious) {
                console.warn(
                    '[connectivity] SUSPICIOUS offline delta — audit recommended:',
                    delta.reasons.join('; '),
                );
            }
        }
    }
    useConnectivityStore.getState().setMode('online');
    try {
        await saveCurrentCharacterStores();
    } catch {
        return delta;
    }
    useConnectivityStore.getState().setSnapshot(null);
    return delta;
};
