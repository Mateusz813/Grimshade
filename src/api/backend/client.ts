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
        useApiPendingStore.getState().inc();
        config.baseURL = getBackendBaseUrl();
        const method = (config.method ?? 'get').toLowerCase();
        const url = config.url ?? '';
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
        useApiPendingStore.getState().dec();
        return response;
    },
    (error) => {
        useApiPendingStore.getState().dec();
        return Promise.reject(error);
    },
);

export default backendClient;
