/**
 * Online ↔ Offline transition helpers.
 *
 * 2026-05-20 spec: every offline-mode entry MUST capture a "trusted
 * baseline" snapshot of the player's stats + full store blob at the
 * exact moment we flip the mode. Every online-mode entry MUST then
 * compare the live state to that baseline + force a server sync so
 * the canonical row matches what the player actually played.
 *
 * The helpers live in their own module (not on the store) because they
 * pull in characterScope / saveGame / characterApi which would create
 * import cycles if attached directly to `connectivityStore.ts`.
 */

import { useCharacterStore } from '../stores/characterStore';
import { useInventoryStore } from '../stores/inventoryStore';
import { useConnectivityStore, type IOfflineSnapshot } from '../stores/connectivityStore';
import {
    saveCurrentCharacterStores,
    saveCurrentCharacterStoresSync,
} from '../stores/characterScope';

/**
 * Sum every item stack in the inventory + every equipped item. Used as
 * a single-number anti-cheat heuristic — duplicating items reliably
 * grows this number.
 */
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

/**
 * Capture the current per-character state as the offline-mode baseline.
 *
 * 2026-05-20 spec ("zanim wejdziemy w tryb offline w pierwszej
 * milisekundzie doslownie zapisz stan samego poczatku kiedy jestesmy
 * w trybie offline"): writes SYNCHRONOUSLY to localStorage via
 * `saveCurrentCharacterStoresSync()` BEFORE the snapshot itself. That
 * way even if the page crashes a tick later, the trusted state is
 * still recoverable and we never end up with an offline session
 * whose pre-state was never persisted.
 *
 * Safe to call from a `beforeunload` / `offline` event handler — all
 * the steps are synchronous.
 */
export const captureOfflineSnapshot = (): IOfflineSnapshot | null => {
    const char = useCharacterStore.getState().character;
    if (!char) return null;

    // Flush every persisted store to localStorage first so the snapshot
    // we hand back reflects a state that's already durable.
    saveCurrentCharacterStoresSync();

    // Re-collect the just-flushed blob so it travels with the snapshot.
    // Imported lazily to avoid pulling characterScope's transitive deps
    // into every caller of this file at module load.
    let storesBlob: Record<string, unknown> | null = null;
    try {
        // characterScope writes a single JSON blob to a known key — read
        // it back via gameStorage.localLoad style. Keeping a plain copy
        // in the snapshot lets future rollback logic restore from this
        // record without re-reading localStorage (which the player
        // could have wiped between sessions).
        // Matches the key written by characterScope.flushStoresToLocalStorage
        const raw = localStorage.getItem(`dungeon_rpg_save_char_${char.id}`);
        if (raw) {
            // The value is wrapped: `{ state: blob, updated_at }`. We only
            // need the blob — `state` is the actual stores payload.
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

/**
 * Compute a delta report between the trusted baseline and the live
 * state. Used by `transitionToOnline()` so suspicious offline-play
 * jumps surface in the dev console.
 *
 * Returns null when there's no usable snapshot (different character
 * loaded, snapshot missing, etc.).
 */
export interface IOfflineDelta {
    levelGained: number;
    xpGained: number;
    goldDelta: number;
    itemCountDelta: number;
    /** Seconds spent in offline mode. */
    elapsedSec: number;
    /**
     * True if any single metric grew faster than a hard-coded
     * "absurd" threshold (~10× of what a normal offline session
     * should yield). Caller can warn / audit.
     */
    suspicious: boolean;
    /** Free-form human-readable reasons for the suspicious flag. */
    reasons: string[];
}

const ABSURD_LEVEL_JUMP = 20;        // > 20 levels in one offline session
const ABSURD_GOLD_MULT = 50;          // gold grew > 50× (extreme)
const ABSURD_ITEM_MULT = 10;          // item count grew > 10× (suspicious duplication)

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
        reasons.push(`gold ${snap.gold} → ${liveGold} (×${(liveGold / snap.gold).toFixed(1)})`);
    }
    if (snap.itemCount > 0 && liveItemCount > snap.itemCount * ABSURD_ITEM_MULT) {
        reasons.push(`itemy ${snap.itemCount} → ${liveItemCount} (×${(liveItemCount / snap.itemCount).toFixed(1)})`);
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

/**
 * Transition the player into offline mode.
 *
 * Both the user-toggle path AND the DC-watcher path call this so the
 * snapshot capture happens exactly once per transition, before any
 * combat / death side effects fire.
 *
 * @param explicit  true when the player clicked the Offline toggle;
 *                  false when the DC watcher auto-flipped. Drives
 *                  whether a network reconnect auto-flips back.
 */
export const transitionToOffline = (opts: { explicit: boolean }): void => {
    // Snapshot FIRST — no matter what the caller does next, the
    // trusted baseline is now persisted.
    captureOfflineSnapshot();
    useConnectivityStore.getState().setMode('offline', { explicit: opts.explicit });
};

/**
 * Transition the player into online mode.
 *
 * 2026-05-20 spec ("Jak wlacze tryb online od razu powinna zrobic sie
 * synchronizacja zeby nie doszlo nigdy do sytuacji ze zduplikuja sie
 * jakies przedmioty"): always pushes the current state to Supabase
 * immediately so the canonical row matches what the player has
 * locally. Before the push, log the delta report against the
 * snapshot so a suspicious offline session leaves a paper trail.
 *
 * The snapshot is cleared after a successful push so a future offline
 * dip can capture a fresh baseline.
 */
export const transitionToOnline = async (): Promise<IOfflineDelta | null> => {
    const snap = useConnectivityStore.getState().snapshot;
    let delta: IOfflineDelta | null = null;
    if (snap) {
        delta = computeOfflineDelta(snap);
        if (delta) {
            // Console-level audit trail — server-side validation is a
            // future hardening step but the log is enough to spot a
            // duplication bug in QA.
            // eslint-disable-next-line no-console
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
                // eslint-disable-next-line no-console
                console.warn(
                    '[connectivity] SUSPICIOUS offline delta — audit recommended:',
                    delta.reasons.join('; '),
                );
            }
        }
    }
    // Flip mode FIRST so any background sync that fires concurrently
    // sees the new mode.
    useConnectivityStore.getState().setMode('online');
    // Force a full sync (Supabase + game_saves) so the canonical row
    // matches what was played offline. Fire-and-forget at the caller's
    // request — we still await here so the snapshot only clears once
    // the sync settled.
    try {
        await saveCurrentCharacterStores();
    } catch {
        // Sync failed (still offline at the OS level?). Keep the
        // snapshot around so the next sync attempt can still compare.
        return delta;
    }
    // Clear the snapshot now that the canonical row reflects the
    // offline session.
    useConnectivityStore.getState().setSnapshot(null);
    return delta;
};
