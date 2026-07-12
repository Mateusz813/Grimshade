
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { supabase } from '../../lib/supabase';
import api from './axiosInstance';

describe('axiosInstance', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('instance shape', () => {
        it('exposes the standard axios verb helpers', () => {
            expect(typeof api.get).toBe('function');
            expect(typeof api.post).toBe('function');
            expect(typeof api.put).toBe('function');
            expect(typeof api.patch).toBe('function');
            expect(typeof api.delete).toBe('function');
        });

        it('has request and response interceptors registered', () => {
            expect(api.interceptors.request).toBeDefined();
            expect(api.interceptors.response).toBeDefined();
        });

        it('carries the baseURL + apikey header from env', () => {
            expect(api.defaults).toBeDefined();
            expect(api.defaults.headers).toBeDefined();
            expect(api.defaults.headers['Content-Type']).toBe('application/json');
        });
    });

    describe('request interceptor', () => {
        const getRequestInterceptor = () => {
            const handlers = (api.interceptors.request as any).handlers as Array<{
                fulfilled?: (cfg: { headers: Record<string, string> }) => Promise<unknown>;
            }>;
            const entry = handlers.find((h) => typeof h?.fulfilled === 'function');
            if (!entry?.fulfilled) {
                throw new Error('No request interceptor registered.');
            }
            return entry.fulfilled;
        };

        it('adds Authorization header when supabase has a session', async () => {
            vi.mocked(supabase.auth.getSession).mockResolvedValueOnce({
                data: { session: { access_token: 'abc-token' } as any },
                error: null,
            });
            const handler = getRequestInterceptor();
            const config = { headers: {} as Record<string, string> };
            const result = (await handler(config)) as { headers: Record<string, string> };
            expect(result.headers.Authorization).toBe('Bearer abc-token');
        });

        it('does NOT add Authorization header when there is no session', async () => {
            vi.mocked(supabase.auth.getSession).mockResolvedValueOnce({
                data: { session: null },
                error: null,
            });
            const handler = getRequestInterceptor();
            const config = { headers: {} as Record<string, string> };
            const result = (await handler(config)) as { headers: Record<string, string> };
            expect(result.headers.Authorization).toBeUndefined();
        });

        it('preserves existing headers when injecting the token', async () => {
            vi.mocked(supabase.auth.getSession).mockResolvedValueOnce({
                data: { session: { access_token: 'xyz' } as any },
                error: null,
            });
            const handler = getRequestInterceptor();
            const config = { headers: { 'X-Custom': 'keep-me' } as Record<string, string> };
            const result = (await handler(config)) as { headers: Record<string, string> };
            expect(result.headers['X-Custom']).toBe('keep-me');
            expect(result.headers.Authorization).toBe('Bearer xyz');
        });
    });
});

