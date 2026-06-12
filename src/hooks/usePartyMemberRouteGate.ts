import { useCharacterStore } from '../stores/characterStore';
import { usePartyStore } from '../stores/partyStore';

/**
 * 2026-05-12 spec ("nie rob redirectow, zablokuj kliki"): exposed as a
 * selector hook so views/tiles can disable the entry click if the local
 * player is a non-leader member of a multi-human party. No navigation,
 * no popups — clicking the disabled element is just a silent no-op.
 *
 * Routes guarded:
 *   - /boss, /raid, /trainer — these instances are leader-only entries
 *     into shared party combat. Members ride along via the leader's
 *     ready-check go-broadcast (see `requestPartyCombatStart`).
 *
 * Hunting (/combat), Transform, Dungeon, Arena are NOT gated — those
 * either piggy-back on the ready-check flow (hunt) or are solo
 * activities the member can do independently.
 */

export type TPartyGatedRoute = '/boss' | '/raid' | '/trainer';

/** Returns `true` when the local player is a non-leader member of a
 *  multi-human party and therefore CANNOT click into the given route. */
export const useIsPartyMemberLocked = (): boolean => {
    const character = useCharacterStore((s) => s.character);
    const party = usePartyStore((s) => s.party);
    if (!character || !party) return false;
    const otherHumans = party.members.filter((m) => m.id !== character.id && !m.isBot);
    if (otherHumans.length === 0) return false;
    return party.leaderId !== character.id;
};

/** Legacy export retained for AppShell mount — now a no-op since we
 *  switched from redirect-on-enter to disable-on-click. */
export const usePartyMemberRouteGate = (): void => {
    // intentionally empty — see useIsPartyMemberLocked for the new model
};
