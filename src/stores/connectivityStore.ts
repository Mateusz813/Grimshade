/**
 * Connectivity / play-mode store.
 *
 * 2026-05-20 spec ("Ogarnac przelacznik do gry offline i online ..."):
 * the player has TWO modes:
 *
 *   • `online`  — full access (party, raids, arena, bot helpers, ladder,
 *                  market, rankings, deaths feed, chat).
 *                  Default for every fresh app launch.
 *
 *   • `offline` — solo-only. Allowed: hunting, solo bosses, transforms,
 *                  tasks, quests, trainer (solo). Blocked: party, raids,
 *                  arena, bot helpers, market, rankings, deaths feed,
 *                  chat — everything that depends on another live player
 *                  (or even a stand-in bot) or fetches from the server.
 *
 * Three concerns live in this store:
 *
 *   1. `mode` — the player's CURRENT mode. NOT persisted across app
 *      reloads (the second spec round explicitly asked "kazdy [boot]
 *      zawsze staramy sie zeby byl online"). The persisted bit is the
 *      session-scoped user choice below.
 *
 *   2. `userExplicitlyOffline` — set to true ONLY when the player
 *      clicked the Offline button in the avatar menu. Reset on every
 *      page reload (= app boot). Determines whether a network
 *      reconnect should auto-flip the player back to online:
 *        - explicit offline → STAY offline through DC + reconnect
 *        - automatic offline (DC) → auto-flip back to online on
 *          reconnect.
 *
 *   3. `isNetworkUp` — mirrored from `useSyncStore.isOnline` (which
 *      itself wraps `navigator.onLine`). Updated by the AppShell DC
 *      watcher.
 *
 * Snapshot system
 * ───────────────
 * 2026-05-20 spec ("Zawsze dokladnie sprawdzaj stan przed i po
 * synchronizacji z gry offline czy nie bedzie sytuacji ze cos zostalo
 * zduplikowane itp"): whenever we enter offline mode (DC OR user click)
 * we snapshot the CURRENT character state to sessionStorage as the
 * "trusted baseline". When the player switches back to online we
 * compare the post-offline state to the baseline + log a delta report
 * so any impossible jumps (e.g. doubled XP, gold spike, item count
 * explosion) surface in the dev console and can trigger a server-side
 * audit later.
 *
 * The snapshot lives in sessionStorage so an explicit "close + reopen"
 * cycle wipes it (matches the user's "ponowny powrot zawsze staramy
 * sie zeby kazdy byl online" rule).
 */

import { create } from 'zustand';

export type TPlayMode = 'online' | 'offline';

/**
 * Per-character snapshot captured at the moment the player transitions
 * from `online → offline`. Compared against current state when they
 * flip back to detect impossible offline-play deltas.
 */
export interface IOfflineSnapshot {
    /** Character id this snapshot belongs to — guards against char-switch races. */
    characterId: string;
    /** ISO timestamp when the snapshot was taken. */
    capturedAt: string;
    /** Pre-offline character stats — used for level/XP/gold delta sanity. */
    level: number;
    xp: number;
    hp: number;
    mp: number;
    gold: number;
    /** Item count (sum of all stacks) at snapshot time. */
    itemCount: number;
    /** Full store blob from `collectAllStores()` so a rollback is possible. */
    storesBlob: Record<string, unknown> | null;
}

const SNAPSHOT_STORAGE_KEY = 'grimshade.offlineSnapshot';
const EXPLICIT_OFFLINE_STORAGE_KEY = 'grimshade.userExplicitlyOffline';

const readStoredSnapshot = (): IOfflineSnapshot | null => {
    try {
        const raw = sessionStorage.getItem(SNAPSHOT_STORAGE_KEY);
        if (!raw) return null;
        return JSON.parse(raw) as IOfflineSnapshot;
    } catch {
        return null;
    }
};

const writeStoredSnapshot = (snap: IOfflineSnapshot | null): void => {
    try {
        if (snap === null) sessionStorage.removeItem(SNAPSHOT_STORAGE_KEY);
        else sessionStorage.setItem(SNAPSHOT_STORAGE_KEY, JSON.stringify(snap));
    } catch {
        /* Quota / private mode — fall back to in-memory only. */
    }
};

// 2026-05-20 v2: the "I explicitly chose offline" bit ALSO needs to
// survive a page refresh inside the same tab — otherwise an F5 during
// an offline session would forget that the player wanted offline and
// the reconnect watcher would yank them back to online behind their
// back. sessionStorage clears on tab close so a fresh app launch
// still starts fresh in online mode (matches the spec).
const readStoredExplicit = (): boolean => {
    try {
        return sessionStorage.getItem(EXPLICIT_OFFLINE_STORAGE_KEY) === '1';
    } catch {
        return false;
    }
};

const writeStoredExplicit = (flag: boolean): void => {
    try {
        if (flag) sessionStorage.setItem(EXPLICIT_OFFLINE_STORAGE_KEY, '1');
        else sessionStorage.removeItem(EXPLICIT_OFFLINE_STORAGE_KEY);
    } catch {
        /* fallthrough */
    }
};

interface IConnectivityState {
    /** Player's current play mode. */
    mode: TPlayMode;
    /**
     * True only when the player explicitly toggled to offline via the
     * avatar menu. Determines whether a network reconnect auto-flips
     * back to online (false) or keeps the player offline (true).
     * Reset on every app boot.
     */
    userExplicitlyOffline: boolean;
    /** Live network state mirrored from navigator.onLine. */
    isNetworkUp: boolean;
    /**
     * Snapshot of the trusted-online state captured at the moment we
     * went offline. Null while in online mode.
     */
    snapshot: IOfflineSnapshot | null;
    setMode: (mode: TPlayMode, opts?: { explicit?: boolean }) => void;
    setIsNetworkUp: (up: boolean) => void;
    setSnapshot: (snap: IOfflineSnapshot | null) => void;
}

// 2026-05-20 v2: bootstrap the initial state from sessionStorage.
//
// If a snapshot is still sitting in sessionStorage when the module
// loads, we're RESUMING an offline session that was interrupted by an
// F5 (sessionStorage persists across refresh but not across tab close).
// In that case we MUST start the app in offline mode — otherwise the
// boot-time Supabase fetch will clobber the local state with stale
// cloud data (the exact bug players reported: "ulepszylem skill do +3,
// refresh, cofa sie do +1").
//
// A fresh app launch (no snapshot) starts online as the spec requires.
const _initialSnapshot = readStoredSnapshot();
const _initialExplicit = readStoredExplicit();
const _initialMode: TPlayMode = _initialSnapshot ? 'offline' : 'online';

export const useConnectivityStore = create<IConnectivityState>((set) => ({
    // 2026-05-20 spec ("rob tak ze przy kazdym odpalaniu gry staraj sie
    // odpalac tryb online automatycznie"): every fresh boot starts in
    // ONLINE mode regardless of what the user last clicked — UNLESS a
    // snapshot is still in sessionStorage (we're mid-offline-session,
    // probably from an F5).
    mode: _initialMode,
    userExplicitlyOffline: _initialExplicit,
    isNetworkUp: typeof navigator !== 'undefined' ? navigator.onLine : true,
    snapshot: _initialSnapshot,
    setMode: (mode, opts) => {
        set((state) => {
            const nextExplicit =
                mode === 'offline'
                    ? (opts?.explicit ?? state.userExplicitlyOffline)
                    : false;
            writeStoredExplicit(nextExplicit);
            return { mode, userExplicitlyOffline: nextExplicit };
        });
    },
    setIsNetworkUp: (isNetworkUp) => set({ isNetworkUp }),
    setSnapshot: (snapshot) => {
        writeStoredSnapshot(snapshot);
        set({ snapshot });
    },
}));

/**
 * Convenience: is the player currently in offline mode? Used as a guard
 * at navigation entry points (arena, raids, party features).
 */
export const isOfflineMode = (): boolean =>
    useConnectivityStore.getState().mode === 'offline';
