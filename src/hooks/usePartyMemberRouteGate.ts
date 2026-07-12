import { useCharacterStore } from '../stores/characterStore';
import { usePartyStore } from '../stores/partyStore';


export const useIsPartyMemberLocked = (): boolean => {
    const character = useCharacterStore((s) => s.character);
    const party = usePartyStore((s) => s.party);
    if (!character || !party) return false;
    const otherHumans = party.members.filter((m) => m.id !== character.id && !m.isBot);
    if (otherHumans.length === 0) return false;
    return party.leaderId !== character.id;
};

export const usePartyMemberRouteGate = (): void => {
};
