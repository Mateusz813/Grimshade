import { create } from 'zustand';

/**
 * Tiny store that lets a combat view ask AppShell to hide the global bottom
 * navigation. The view itself renders a fixed-position `<CombatActionBar>`
 * (HP/MP %, 4 skill slots, exit) in place of it.
 *
 * Each combat view (Combat, Boss, Dungeon, Transform, Raid, Trainer) calls
 * `setActive(true)` while the player is actually in a fight and `false` when
 * they leave the view or the fight ends. Defensive: AppShell also resets it
 * to false on route change so a buggy view that forgot to clean up can't
 * permanently hide the nav.
 */
interface ICombatHudStore {
    /** When true, AppShell hides the global BottomNav so the view's own
     *  CombatActionBar can take its place at the bottom of the viewport. */
    active: boolean;
    setActive: (v: boolean) => void;
    /** When true, AppShell adds a `--compact` modifier so the view paints
     *  zero-padding/zero-margin around the sub-controls (no bottom scroll
     *  on normal phones). Used by Dungeon/Boss/Raid/Arena where the bag is
     *  hidden and the logs icon is pinned to the top-right corner — those
     *  views don't need the standard 140px clearance for the potion dock
     *  because their layouts already fit the viewport without scrolling.
     *
     *  The hunting Combat view leaves this `false` so its sub-row keeps
     *  the normal vertical breathing room and the bag remains in flow. */
    compact: boolean;
    setCompact: (v: boolean) => void;
}

export const useCombatHudStore = create<ICombatHudStore>((set) => ({
    active: false,
    setActive: (v) => set({ active: v }),
    compact: false,
    setCompact: (v) => set({ compact: v }),
}));
