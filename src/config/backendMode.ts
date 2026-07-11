// Tryb backendu. Dwa reżimy, wybierane BUILD-TIME przez env:
//
//  A) DOMYŚLNY (dev/opt-in) — VITE_BACKEND_DEFAULT NIE ustawiony:
//     backend włącza się TYLKO gdy (1) ustawiony VITE_API_BASE_URL ORAZ
//     (2) w localStorage jest `grimshade_backend_mode === '1'`. Gra działa po
//     staremu (client-authoritative), dopóki świadomie nie włączysz w panelu.
//
//  B) CUTOVER (VITE_BACKEND_DEFAULT === '1') — build produkcyjny na go-live:
//     backend jest ON dla WSZYSTKICH graczy, gdy tylko VITE_API_BASE_URL jest
//     ustawiony. Escape hatch: localStorage `grimshade_backend_mode === '0'`
//     jawnie wyłącza (do debugowania), inaczej zawsze ON.
//
// Reżim B NIE zmienia zachowania reżimu A — jest aktywny tylko z ustawionym env,
// więc lokalny dev/testy zostają na opt-in.

const TOGGLE_KEY = 'grimshade_backend_mode';

/** Czy to build cutoverowy (backend domyślnie ON). Deploy-time flag. */
const BACKEND_DEFAULT_ON = (import.meta.env.VITE_BACKEND_DEFAULT as string | undefined) === '1';

/** Adres backendu z env (np. http://localhost:8088). Pusty = brak backendu. */
export const getBackendBaseUrl = (): string =>
    (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? '';

/** Czy backend jest w ogóle skonfigurowany (URL ustawiony). */
export const isBackendConfigured = (): boolean => getBackendBaseUrl().length > 0;

/** Czy tryb backendu jest AKTYWNY. */
export const isBackendMode = (): boolean => {
    if (!isBackendConfigured()) return false;
    try {
        const toggle = localStorage.getItem(TOGGLE_KEY);
        // Cutover: ON dla wszystkich, chyba że jawny opt-out ('0').
        if (BACKEND_DEFAULT_ON) return toggle !== '0';
        // Zwykły build: opt-in — backend tylko gdy jawnie włączony ('1').
        return toggle === '1';
    } catch {
        return BACKEND_DEFAULT_ON;
    }
};

/** Włącz/wyłącz tryb backendu (używane przez panel testowy / ustawienia). */
export const setBackendMode = (on: boolean): void => {
    try {
        if (on) localStorage.setItem(TOGGLE_KEY, '1');
        else localStorage.removeItem(TOGGLE_KEY);
    } catch {
        /* localStorage niedostępny — ignoruj */
    }
};
