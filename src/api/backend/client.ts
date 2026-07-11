import axios from 'axios';
import { supabase } from '../../lib/supabase';
import { getBackendBaseUrl } from '../../config/backendMode';
import { useApiPendingStore } from '../../stores/apiPendingStore';
import { flushPendingCommit } from './pendingCommit';

// Osobny klient axios dla backendu Laravel (NIE Supabase PostgREST). Ten sam
// token JWT GoTrue co reszta apki — backend go weryfikuje. baseURL z env.
const backendClient = axios.create({
    headers: { 'Content-Type': 'application/json' },
});

// Licznik in-flight (→ globalny BackendLoader). inc na starcie requestu, dec
// przy KAŻDYM zakończeniu (sukces/błąd, w tym błąd interceptora requestu),
// żeby licznik nigdy nie utknął powyżej 0.
backendClient.interceptors.request.use(
    async (config) => {
        useApiPendingStore.getState().inc();
        config.baseURL = getBackendBaseUrl();
        // Przed mutującą akcją (poza samym commitem /state) wypchnij zaległy
        // commit walki, żeby serwer działał na najświeższym stanie i późniejszy
        // syncFromBackend nie skasował świeżego progresu (patrz pendingCommit.ts).
        const method = (config.method ?? 'get').toLowerCase();
        const url = config.url ?? '';
        if (method !== 'get' && !url.endsWith('/state')) {
            await flushPendingCommit();
        }
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (token) {
            config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
    },
    (error) => {
        useApiPendingStore.getState().dec();
        return Promise.reject(error);
    },
);

backendClient.interceptors.response.use(
    (response) => {
        useApiPendingStore.getState().dec();
        return response;
    },
    (error) => {
        useApiPendingStore.getState().dec();
        return Promise.reject(error);
    },
);

export default backendClient;
