import { backendApi } from './backendApi';
import { bumpServerVersion } from './serverVersion';
import { isBackendMode } from '../../config/backendMode';
import { applyBlobToStores } from '../../stores/characterScope';
import { useCharacterStore } from '../../stores/characterStore';
import type { ICharacter } from '../../types/character';

interface IStateResponse {
    character: ICharacter;
    state: Record<string, unknown>;
    updated_at?: string | null;
}

export const applyStateResponse = (res: unknown, charId: string): boolean => {
    const payload = res as Partial<IStateResponse> | null;
    if (!payload || typeof payload !== 'object') return false;
    if (!payload.character || !payload.state || typeof payload.state !== 'object') return false;
    useCharacterStore.getState().setCharacter(payload.character);
    applyBlobToStores(payload.state, charId);
    return true;
};

export const syncFromBackend = async (charId: string): Promise<void> => {
    const res = await backendApi.state(charId) as IStateResponse;
    bumpServerVersion(charId, res.updated_at);
    if (res.character) {
        useCharacterStore.getState().setCharacter(res.character);
    }
    if (res.state && typeof res.state === 'object') {
        applyBlobToStores(res.state, charId);
    }
};

export const syncIfBackend = async (charId: string | null | undefined): Promise<void> => {
    if (!charId || !isBackendMode()) return;
    await syncFromBackend(charId);
};
