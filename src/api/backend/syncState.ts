import { backendApi } from './backendApi';
import { isBackendMode } from '../../config/backendMode';
import { applyBlobToStores } from '../../stores/characterScope';
import { useCharacterStore } from '../../stores/characterStore';
import type { ICharacter } from '../../types/character';

interface IStateResponse {
    character: ICharacter;
    state: Record<string, unknown>;
    updated_at?: string | null;
}

/**
 * Pobiera autorytatywny stan z backendu (GET /state) i hydratuje store'y:
 *  - characterStore ← character (level/xp/hp/staty/rankingi),
 *  - reszta store'ów ← blob state (inventory/skills/quests/tasks/...).
 * Wołane PO każdej mutującej akcji backendu, żeby UI = stan serwera.
 */
export const syncFromBackend = async (charId: string): Promise<void> => {
    const res = await backendApi.state(charId) as IStateResponse;
    if (res.character) {
        useCharacterStore.getState().setCharacter(res.character);
    }
    if (res.state && typeof res.state === 'object') {
        applyBlobToStores(res.state, charId);
    }
};

/** Odśwież z backendu TYLKO gdy tryb backendu aktywny (no-op inaczej). */
export const syncIfBackend = async (charId: string | null | undefined): Promise<void> => {
    if (!charId || !isBackendMode()) return;
    await syncFromBackend(charId);
};
