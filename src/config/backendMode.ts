
const TOGGLE_KEY = 'grimshade_backend_mode';

const BACKEND_DEFAULT_ON = (import.meta.env.VITE_BACKEND_DEFAULT as string | undefined) === '1';

export const getBackendBaseUrl = (): string =>
    (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? '';

export const isBackendConfigured = (): boolean => getBackendBaseUrl().length > 0;

export const isBackendMode = (): boolean => {
    if (!isBackendConfigured()) return false;
    try {
        const toggle = localStorage.getItem(TOGGLE_KEY);
        if (BACKEND_DEFAULT_ON) return toggle !== '0';
        return toggle === '1';
    } catch {
        return BACKEND_DEFAULT_ON;
    }
};

export const isBackendCombatDelegated = (): boolean => false;

export const setBackendMode = (on: boolean): void => {
    try {
        if (on) localStorage.setItem(TOGGLE_KEY, '1');
        else localStorage.removeItem(TOGGLE_KEY);
    } catch {
    }
};
