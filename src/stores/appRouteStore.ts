import { create } from 'zustand';

/**
 * Tiny store that mirrors whether the current route is a "characterless"
 * one (login / register / character-select / create-character).
 *
 * Owned by AppShell, which calls `setIsCharacterless(...)` on every
 * route change. Other modules (notably `useBackgroundCombat`) read it
 * to bail out of expensive ticking when the player is not actively
 * playing a character — otherwise a half-finished fight in localStorage
 * would keep the engine's player/monster intervals running on the
 * character-select screen, firing `saveCurrentCharacterStores()` (3
 * REST writes per kill) every second.
 */

interface IAppRouteState {
    isCharacterless: boolean;
    setIsCharacterless: (value: boolean) => void;
}

export const useAppRouteStore = create<IAppRouteState>()((set) => ({
    isCharacterless: false,
    setIsCharacterless: (value) => set({ isCharacterless: value }),
}));
