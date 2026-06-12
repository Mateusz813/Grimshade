// -- Disconnect-death policy (AppShell DC watcher) -----------------------------
//
// Pure decision rules for an INVOLUNTARY network drop (online -> offline)
// detected by the AppShell connectivity watcher. Extracted from the component
// so the rules are unit-testable game logic in /systems/ rather than UI glue
// (CLAUDE.md: "logika gry zawsze w /systems/").
//
// This module is intentionally side-effect-free — it imports only a TYPE from
// combatLeavePenalty (`import type` is erased at compile time, so the heavy
// auth-keepalive module is NOT pulled into AppShell's eager bundle; AppShell
// still lazy-imports combatLeavePenalty itself when it actually needs to apply
// the death).
//
// Spec (2026-05-20 + BACKLOG #17 "Gra w trybie offline"): losing connection
// should …
//   - in a PARTY *and* on a combat route -> DIE (combat-leave death) + be
//     dropped from the party. A live party can't be held hostage by a
//     teammate's dead connection.
//   - in the ARENA (with or without a party) -> DIE. Arena match abandonment
//     is always a loss.
//   - SOLO on a combat route (not in a party) -> do NOT die; combat keeps
//     running locally in offline mode.
//   - in a PARTY on a NON-combat route -> no death, but still drop the party
//     (handled by the caller) so teammates aren't stalled.
//   - SOLO on a non-combat route -> nothing; just enter offline mode.

import type { TLeaveSource } from './combatLeavePenalty';

export interface IDisconnectContext {
    /** Player is currently a member of a party (any role). */
    inParty: boolean;
    /** Current route is one of the hunt/dungeon/boss/raid/transform combat screens. */
    inCombat: boolean;
    /** Current route is an arena route (`/arena` or `/arena/match`). */
    inArena: boolean;
}

/**
 * Should an involuntary disconnect kill the character? True when the player
 * is in a party on a combat route, OR anywhere in the arena. Solo combat and
 * non-combat routes return false (no death).
 */
export const shouldDieOnDisconnect = ({ inParty, inCombat, inArena }: IDisconnectContext): boolean =>
    (inParty && inCombat) || inArena;

/**
 * Should an involuntary disconnect drop the player from their party? True
 * whenever the player is in a party — whether they die (combat/arena) or just
 * leave quietly (non-combat). Solo players have no party to drop.
 */
export const shouldLeavePartyOnDisconnect = ({ inParty }: IDisconnectContext): boolean => inParty;

// Combat routes that count as "in combat" for the disconnect-death rule.
export const DISCONNECT_COMBAT_ROUTES: ReadonlySet<string> = new Set([
    '/combat', '/dungeon', '/boss', '/raid', '/transform',
]);

// Arena routes — disconnect here is always a loss.
export const DISCONNECT_ARENA_ROUTES: ReadonlySet<string> = new Set([
    '/arena', '/arena/match',
]);

// Route -> death `source` mapping for a disconnect death. Mirrors the deaths
// feed's source enum so the graveyard shows the correct icon/filter.
const DISCONNECT_SOURCE_BY_ROUTE: Record<string, TLeaveSource> = {
    '/boss': 'boss',
    '/dungeon': 'dungeon',
    '/raid': 'raid',
    '/transform': 'transform',
    '/combat': 'monster',
};

/**
 * Resolve the death `source` for a disconnect death from the current route.
 * Arena routes have no dedicated source enum value, so they map to 'boss'
 * (boss-tier loss). Any unrecognized route falls back to 'monster'.
 */
export const resolveDisconnectSource = (route: string, inArena: boolean): TLeaveSource => {
    if (inArena) return 'boss';
    return DISCONNECT_SOURCE_BY_ROUTE[route] ?? 'monster';
};
