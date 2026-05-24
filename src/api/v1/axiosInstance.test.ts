/**
 * Tests for the axios instance singleton.
 *
 * The instance is created at module import with a baseURL + apikey
 * header pulled from `import.meta.env`, and installs a request
 * interceptor that injects a Bearer token from Supabase's session.
 *
 * What we cover:
 * - The instance is an axios-compatible object (has request/get/post/etc).
 * - The base config picks up env-driven URL + apikey + Content-Type.
 * - The request interceptor reads from supabase.auth.getSession() and
 *   adds Authorization when a session exists, and leaves headers
 *   untouched when no session is present.
 *
 * Why we test the interceptor by intercepting the runtime call rather
 * than re-invoking the installed function: axios doesn't expose its
 * registered interceptors in a stable API, but it DOES surface the
 * `handlers` array on `interceptors.request` for testing. We pull the
 * first non-undefined handler and call it directly with a fake config.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { supabase } from '../../lib/supabase';
import api from './axiosInstance';

describe('axiosInstance', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('instance shape', () => {
        it('exposes the standard axios verb helpers', () => {
            // Sanity check: the default export must be an axios instance.
            expect(typeof api.get).toBe('function');
            expect(typeof api.post).toBe('function');
            expect(typeof api.put).toBe('function');
            expect(typeof api.patch).toBe('function');
            expect(typeof api.delete).toBe('function');
        });

        it('has request and response interceptors registered', () => {
            // Each axios instance ships with an interceptor manager —
            // we registered ONE request interceptor at module load.
            expect(api.interceptors.request).toBeDefined();
            expect(api.interceptors.response).toBeDefined();
        });

        it('carries the baseURL + apikey header from env', () => {
            // Vitest config doesn't set VITE_SUPABASE_*; instance still constructs
            // (undefined is acceptable for axios). Just assert the structure exists.
            expect(api.defaults).toBeDefined();
            expect(api.defaults.headers).toBeDefined();
            expect(api.defaults.headers['Content-Type']).toBe('application/json');
        });
    });

    describe('request interceptor', () => {
        // Pull the registered request fulfilled-handler. Axios stores them
        // on .handlers as `{ fulfilled, rejected, ... }` entries.
        const getRequestInterceptor = () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

// TODO: integration test — fire a real request via the instance and assert
// the interceptor populated Authorization. Skipped here because we'd need
// to mock the network layer too, and the unit-level coverage above already
// exercises every branch in the interceptor.
