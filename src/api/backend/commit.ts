import { backendApi } from './backendApi';
import { isBackendMode, getBackendBaseUrl } from '../../config/backendMode';
import { getAuthToken } from './authToken';

interface ILocalSave {
    state: Record<string, unknown>;
    updated_at: string;
}

export interface ICombatEvent {
    type: 'dungeon' | 'boss' | 'raid' | 'transform' | 'hunt' | 'offline-hunt' | 'arena';
    sourceId?: string;
    outcome?: 'won' | 'lost' | 'fled' | 'settled';
    died?: boolean;
    protectionConsumed?: string | null;
    wavesCompleted?: number;
}

export const commitStateToBackend = async (
    charId: string | null | undefined,
    event?: ICombatEvent,
): Promise<boolean> => {
    if (!charId || !isBackendMode()) return false;

    let raw: string | null;
    try {
        raw = localStorage.getItem(`dungeon_rpg_save_char_${charId}`);
    } catch {
        return false;
    }
    if (!raw) return false;

    let state: Record<string, unknown> | undefined;
    try {
        state = (JSON.parse(raw) as ILocalSave).state;
    } catch {
        return false;
    }
    if (!state || typeof state !== 'object') return false;

    try {
        await backendApi.commitState(charId, state, event as Record<string, unknown> | undefined);
        return true;
    } catch {
        return false;
    }
};

export const commitStateViaKeepalive = (charId: string | null | undefined): void => {
    if (!charId || !isBackendMode()) return;
    const base = getBackendBaseUrl();
    const token = getAuthToken();
    if (!base || !token) return;

    let raw: string | null;
    try {
        raw = localStorage.getItem(`dungeon_rpg_save_char_${charId}`);
    } catch {
        return;
    }
    if (!raw) return;

    let state: Record<string, unknown> | undefined;
    try {
        state = (JSON.parse(raw) as ILocalSave).state;
    } catch {
        return;
    }
    if (!state || typeof state !== 'object') return;

    const requestId = globalThis.crypto?.randomUUID?.() ?? `r_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    try {
        void fetch(`${base}/api/v1/characters/${charId}/state`, {
            method: 'PUT',
            keepalive: true,
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ requestId, state }),
        }).catch(() => { });
    } catch {
    }
};
