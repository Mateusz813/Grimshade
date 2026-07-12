
import type { TLeaveSource } from './combatLeavePenalty';

export interface IDisconnectContext {
    inParty: boolean;
    inCombat: boolean;
    inArena: boolean;
}

export const shouldDieOnDisconnect = ({ inParty, inCombat, inArena }: IDisconnectContext): boolean =>
    (inParty && inCombat) || inArena;

export const shouldLeavePartyOnDisconnect = ({ inParty }: IDisconnectContext): boolean => inParty;

export const DISCONNECT_COMBAT_ROUTES: ReadonlySet<string> = new Set([
    '/combat', '/dungeon', '/boss', '/raid', '/transform',
]);

export const DISCONNECT_ARENA_ROUTES: ReadonlySet<string> = new Set([
    '/arena', '/arena/match',
]);

const DISCONNECT_SOURCE_BY_ROUTE: Record<string, TLeaveSource> = {
    '/boss': 'boss',
    '/dungeon': 'dungeon',
    '/raid': 'raid',
    '/transform': 'transform',
    '/combat': 'monster',
};

export const resolveDisconnectSource = (route: string, inArena: boolean): TLeaveSource => {
    if (inArena) return 'boss';
    return DISCONNECT_SOURCE_BY_ROUTE[route] ?? 'monster';
};
