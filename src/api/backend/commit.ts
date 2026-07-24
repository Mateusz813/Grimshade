import { backendApi } from './backendApi';
import { isBackendMode, getBackendBaseUrl } from '../../config/backendMode';
import { getAuthToken } from './authToken';
import { readServerVersion, bumpServerVersion } from './serverVersion';

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

    const baseUsed = readBaseUpdatedAt(charId);
    try {
        const res = await backendApi.commitState(
            charId,
            state,
            event as Record<string, unknown> | undefined,
            baseUsed,
        ) as { updated_at?: string | null };
        bumpServerVersion(charId, res?.updated_at);
        clearPendingCommit(charId);
        return true;
    } catch (e) {
        const res = (e as { response?: { status?: number; data?: unknown } }).response;
        const status = res?.status ?? 0;

        if (status === 409) {
            const serverVersion = (res?.data as { updated_at?: string | null } | undefined)?.updated_at ?? null;
            if (serverVersion) {
                try {
                    const freshState = readLocalState(charId) ?? state;
                    const rebased = await backendApi.commitState(
                        charId,
                        freshState,
                        event as Record<string, unknown> | undefined,
                        serverVersion,
                    ) as { updated_at?: string | null };
                    bumpServerVersion(charId, rebased?.updated_at);
                    clearPendingCommit(charId);
                    console.info('[commit] 409 → rebase — biezacy stan doslany na nowej wersji serwera', { charId });
                    return true;
                } catch (retryErr) {
                    console.warn('[commit] rebase po 409 odrzucony — pobieram stan z serwera', {
                        charId,
                        status: (retryErr as { response?: { status?: number } }).response?.status ?? 'brak',
                    });
                }
            }
            clearPendingCommit(charId);
            resyncFromServer(charId);
            return false;
        }

        console.warn('[commit] PUT /state ODRZUCONY — stan zachowany lokalnie do ponowienia', {
            status: status || 'brak odpowiedzi (siec/CORS)',
            body: res?.data,
            bytes: JSON.stringify(state).length,
        });
        retainPendingCommit(charId, state, event, status ? `http_${status}` : 'network', baseUsed);
        return false;
    }
};

const readLocalState = (charId: string): Record<string, unknown> | null => {
    try {
        const raw = localStorage.getItem(`dungeon_rpg_save_char_${charId}`);
        if (!raw) return null;
        const parsed = (JSON.parse(raw) as ILocalSave).state;
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
        return null;
    }
};

const resyncFromServer = (charId: string): void => {
    void import('./syncState')
        .then((m) => m.syncFromBackend(charId))
        .catch((err) => console.warn('[commit] resync po 409 nie powiodl sie', err));
};

const pendingKey = (charId: string): string => `dungeon_rpg_pending_commit_${charId}`;

export interface IPendingCommit {
    state: Record<string, unknown>;
    event?: ICombatEvent;
    reason: string;
    queuedAt: string;
    attempts: number;
    baseUpdatedAt: string | null;
}

export const readBaseUpdatedAt = (charId: string): string | null => readServerVersion(charId);

export const retainPendingCommit = (
    charId: string,
    state: Record<string, unknown>,
    event: ICombatEvent | undefined,
    reason: string,
    baseUpdatedAt: string | null,
): void => {
    try {
        const existing = readPendingCommit(charId);
        const entry: IPendingCommit = {
            state,
            event,
            reason,
            queuedAt: existing?.queuedAt ?? new Date().toISOString(),
            attempts: (existing?.attempts ?? 0) + 1,
            baseUpdatedAt,
        };
        localStorage.setItem(pendingKey(charId), JSON.stringify(entry));
    } catch {
    }
};

export const bumpLocalSaveUpdatedAt = (charId: string, updatedAt: string | null | undefined): void =>
    bumpServerVersion(charId, updatedAt);

export const readPendingCommit = (charId: string): IPendingCommit | null => {
    try {
        const raw = localStorage.getItem(pendingKey(charId));
        return raw ? (JSON.parse(raw) as IPendingCommit) : null;
    } catch {
        return null;
    }
};

export const clearPendingCommit = (charId: string): void => {
    try {
        localStorage.removeItem(pendingKey(charId));
    } catch {
    }
};

export const retryPendingCommit = async (charId: string | null | undefined): Promise<boolean> => {
    if (!charId || !isBackendMode()) return false;
    const pending = readPendingCommit(charId);
    if (!pending) return false;

    if (!('baseUpdatedAt' in pending)) {
        console.warn('[commit] porzucam wpis kolejki w starym formacie (bez wersji bazowej) — replay bez sprawdzenia konfliktu mogl nadpisac nowszy stan', { charId });
        clearPendingCommit(charId);
        resyncFromServer(charId);
        return false;
    }

    try {
        await backendApi.commitState(
            charId,
            pending.state,
            pending.event as Record<string, unknown> | undefined,
            pending.baseUpdatedAt,
        );
        clearPendingCommit(charId);
        console.info('[commit] zaległy zapis dosłany na serwer', { charId, reason: pending.reason });
        return true;
    } catch (e) {
        const status = (e as { response?: { status?: number } }).response?.status ?? 0;
        if (status === 409) {
            console.warn('[commit] zaległy zapis jest nieaktualny (serwer ma nowszy stan) — porzucam go zamiast nadpisywac', {
                charId,
                reason: pending.reason,
                queuedAt: pending.queuedAt,
            });
            clearPendingCommit(charId);
            resyncFromServer(charId);
        }
        return false;
    }
};

export const KEEPALIVE_BYTE_LIMIT = 60_000;

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
    const baseUpdatedAt = readBaseUpdatedAt(charId);
    const body = JSON.stringify({
        requestId,
        state,
        ...(baseUpdatedAt ? { base_updated_at: baseUpdatedAt } : {}),
    });
    const oversized = body.length > KEEPALIVE_BYTE_LIMIT;

    retainPendingCommit(charId, state, undefined, oversized ? 'keepalive_oversized' : 'keepalive', baseUpdatedAt);

    if (oversized) {
        console.warn('[commit] blob przekracza limit keepalive — wysylam zwyklym requestem (best-effort)', {
            bytes: body.length,
            limit: KEEPALIVE_BYTE_LIMIT,
        });
    }

    try {
        void fetch(`${base}/api/v1/characters/${charId}/state`, {
            method: 'PUT',
            keepalive: !oversized,
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body,
        })
            .then((r) => {
                if (r.ok) {
                    clearPendingCommit(charId);
                    return;
                }
                console.warn('[commit] PUT /state na zamknieciu odrzucony — zostaje w kolejce', { status: r.status, bytes: body.length });
            })
            .catch((err) => {
                console.warn('[commit] PUT /state na zamknieciu NIE doszedl', { err: String(err), bytes: body.length });
            });
    } catch (err) {
        console.warn('[commit] PUT /state na zamknieciu rzucil synchronicznie', { err: String(err), bytes: body.length });
    }
};
