import { backendApi } from './backendApi';
import { isBackendMode, getBackendBaseUrl } from '../../config/backendMode';
import { getAuthToken } from './authToken';

interface ILocalSave {
    state: Record<string, unknown>;
    updated_at: string;
}

/**
 * Kontekst zdarzenia walki wysyłany razem ze stanem, żeby backend mógł zwalidować
 * przejście (koniec dungeona/bossa/rajdu/transformu/areny lub checkpoint polowania).
 */
export interface ICombatEvent {
    type: 'dungeon' | 'boss' | 'raid' | 'transform' | 'hunt' | 'offline-hunt' | 'arena';
    sourceId?: string;
    outcome?: 'won' | 'lost' | 'fled' | 'settled';
    died?: boolean;
    protectionConsumed?: string | null;
    wavesCompleted?: number;
}

/**
 * Wysyła autorytatywny stan postaci (pełny blob z localStorage) do backendu.
 *
 * W trybie backendu klient liczy grę swoim silnikiem (identyczna rozgrywka +
 * animacje + realne staty z gearu), a TO jest jedyny kanał zapisu do bazy —
 * serwer waliduje wynik realną mocą postaci i zapisuje (jedyny zapisujący =
 * anti-cheat). No-op poza trybem backendu.
 *
 * Odpowiedź (autorytatywny stan) NIE jest aplikowana: w tym modelu klient jest
 * źródłem stanu, a serwer go utrwala. Błędy są łykane — localStorage jest
 * buforem write-ahead (loadGame: newest-wins), więc niewysłany commit dogoni
 * się przy następnym syncu / wczytaniu.
 *
 * Zwraca `true` gdy commit REALNIE doleciał do serwera (żeby wołający mógł
 * wyczyścić flagę "dirty"); `false` gdy no-op (poza trybem backendu / brak
 * bloba) lub błąd sieci (offline) — wtedy zostaje do ponowienia.
 */
export const commitStateToBackend = async (
    charId: string | null | undefined,
    event?: ICombatEvent,
): Promise<boolean> => {
    if (!charId || !isBackendMode()) return false;

    let raw: string | null = null;
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
        // offline / błąd walidacji — lokalny bufor zostaje, dogoni przy następnym syncu
        return false;
    }
};

/**
 * Zapis przy ZAMYKANIU karty (pagehide / hidden). Zwykły async commit tam NIE
 * dochodzi (przeglądarka ubija stronę zanim `supabase.auth.getSession()` +
 * request się dokończą). `fetch(..., {keepalive:true})` przeżywa unload i wysyła
 * request w tle — ale wymaga tokenu SYNCHRONICZNIE (stąd cache w authToken.ts).
 *
 * Ograniczenie przeglądarki: keepalive body ma limit ~64KB. Przy większym blobie
 * request może zostać odrzucony — wtedy ratuje bufor localStorage (na tym samym
 * urządzeniu nic nie ginie) + następny sync. To best-effort, nie gwarancja.
 */
export const commitStateViaKeepalive = (charId: string | null | undefined): void => {
    if (!charId || !isBackendMode()) return;
    const base = getBackendBaseUrl();
    const token = getAuthToken();
    if (!base || !token) return;

    let raw: string | null = null;
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
        }).catch(() => { /* best-effort — bufor lokalny zostaje */ });
    } catch {
        // np. body > limitu keepalive — bufor lokalny + następny sync ratują
    }
};
