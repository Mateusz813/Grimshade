import axios from 'axios';
import { supabase } from '../../lib/supabase';
import { getBackendBaseUrl } from '../../config/backendMode';

// Osobny klient axios dla backendu Laravel (NIE Supabase PostgREST). Ten sam
// token JWT GoTrue co reszta apki — backend go weryfikuje. baseURL z env.
const backendClient = axios.create({
    headers: { 'Content-Type': 'application/json' },
});

backendClient.interceptors.request.use(async (config) => {
    config.baseURL = getBackendBaseUrl();
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

export default backendClient;
