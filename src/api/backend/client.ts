import axios from 'axios';
import { supabase } from '../../lib/supabase';
import { getBackendBaseUrl } from '../../config/backendMode';
import { useApiPendingStore } from '../../stores/apiPendingStore';
import { flushPendingCommit } from './pendingCommit';
import { setAuthToken } from './authToken';

const backendClient = axios.create({
    headers: { 'Content-Type': 'application/json' },
});

backendClient.interceptors.request.use(
    async (config) => {
        const method = (config.method ?? 'get').toLowerCase();
        const url = config.url ?? '';
        const silent = method !== 'get';
        (config as { _silent?: boolean })._silent = silent;
        if (!silent) useApiPendingStore.getState().inc();
        config.baseURL = getBackendBaseUrl();
        if (method !== 'get' && !url.endsWith('/state')) {
            await flushPendingCommit();
        }
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (token) {
            config.headers.Authorization = `Bearer ${token}`;
            setAuthToken(token);
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
        if (!(response.config as { _silent?: boolean })._silent) {
            useApiPendingStore.getState().dec();
        }
        return response;
    },
    (error) => {
        if (!(error.config as { _silent?: boolean } | undefined)?._silent) {
            useApiPendingStore.getState().dec();
        }
        return Promise.reject(error);
    },
);

export default backendClient;
