import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { usePartyStore } from '../stores/partyStore';
import {
    usePartyReadyCheckStore,
    type ReadyDestination,
} from '../stores/partyReadyCheckStore';
import { useCharacterStore } from '../stores/characterStore';
import { isBackendMode } from '../config/backendMode';
import { backendApi } from '../api/backend/backendApi';


export const usePartyReadyCheck = (): void => {
    const location = useLocation();
    const navigate = useNavigate();
    const party = usePartyStore((s) => s.party);
    const subscribe = usePartyReadyCheckStore((s) => s.subscribe);
    const destination = usePartyReadyCheckStore((s) => s.destination);
    const open = usePartyReadyCheckStore((s) => s.open);

    useEffect(() => {
        if (!party?.id) return;
        const cleanup = subscribe(party.id);
        return cleanup;
    }, [party?.id, subscribe]);

    useEffect(() => {
        if (open) return;
        if (!destination) return;
        if (location.pathname === destination) {
            usePartyReadyCheckStore.getState().consumeDestination();
            return;
        }
        navigate(destination, { replace: false });
        usePartyReadyCheckStore.getState().consumeDestination();
    }, [open, destination, location.pathname, navigate]);
};

export const requestPartyCombatStart = (params: {
    destination: ReadyDestination;
    label?: string;
    payload?: unknown;
    onConfirmed: () => void;
}): boolean => {
    const character = useCharacterStore.getState().character;
    const party = usePartyStore.getState().party;
    const store = usePartyReadyCheckStore.getState();

    if (!character) return false;

    if (party && party.leaderId === character.id) {
        void (async () => {
            try {
                if (isBackendMode()) {
                    await backendApi.updateParty(character.id, party.id, { isPublic: false });
                } else {
                    const { partyApi } = await import('../api/v1/partyApi');
                    await partyApi.updatePartyMeta(party.id, { is_public: false });
                }
            } catch {
            }
        })();
    }

    const otherHumans = party?.members.filter((m) => m.id !== character.id && !m.isBot) ?? [];
    if (!party || otherHumans.length === 0) {
        params.onConfirmed();
        return true;
    }

    if (party.leaderId !== character.id) {
        return false;
    }

    pendingGoAction = params.onConfirmed;

    const memberIds = party.members.filter((m) => !m.isBot).map((m) => m.id);
    store.start({
        destination: params.destination,
        requesterId: character.id,
        memberIds,
        payload: params.payload,
        label: params.label,
    });

    return true;
};

let pendingGoAction: (() => void) | null = null;

export const triggerPartyCombatGo = (params: {
    destination: ReadyDestination;
    label?: string;
    payload?: unknown;
    onConfirmed: () => void;
}): boolean => {
    const character = useCharacterStore.getState().character;
    const party = usePartyStore.getState().party;

    if (!character) return false;

    if (party && party.leaderId === character.id) {
        void (async () => {
            try {
                if (isBackendMode()) {
                    await backendApi.updateParty(character.id, party.id, { isPublic: false });
                } else {
                    const { partyApi } = await import('../api/v1/partyApi');
                    await partyApi.updatePartyMeta(party.id, { is_public: false });
                }
            } catch { }
        })();
    }

    const otherHumans = party?.members.filter((m) => m.id !== character.id && !m.isBot) ?? [];
    if (!party || otherHumans.length === 0) {
        params.onConfirmed();
        return true;
    }
    if (party.leaderId !== character.id) {
        return false;
    }

    pendingGoAction = params.onConfirmed;
    usePartyReadyCheckStore.getState().instantStart({
        destination: params.destination,
        payload: params.payload,
        label: params.label,
    });
    return true;
};

export const useReadyCheckGoEffect = (): void => {
    const open = usePartyReadyCheckStore((s) => s.open);
    const destination = usePartyReadyCheckStore((s) => s.destination);
    const payload = usePartyReadyCheckStore((s) => s.payload);
    const character = useCharacterStore.getState().character;
    const party = usePartyStore.getState().party;

    useEffect(() => {
        if (open) return;
        if (!destination) return;
        if (character && party?.leaderId === character.id && pendingGoAction) {
            const action = pendingGoAction;
            pendingGoAction = null;
            try { action(); } catch (e) { console.error('[readyCheck] leader go-action failed:', e); }
            return;
        }
        const replicator = goReplicators[destination];
        if (replicator) {
            try { replicator(payload); } catch (e) { console.error('[readyCheck] member go-replicator failed:', e); }
        }
    }, [open, destination]);
};

type GoReplicator = (payload: unknown) => void;
const goReplicators: Partial<Record<ReadyDestination, GoReplicator>> = {};

export const registerGoReplicator = (
    destination: ReadyDestination,
    fn: GoReplicator,
): void => {
    goReplicators[destination] = fn;
};
