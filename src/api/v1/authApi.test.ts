/**
 * Tests for authApi — thin wrapper over `supabase.auth.*`.
 *
 * Every method calls a supabase helper that the global setup
 * (`tests/vitest.setup.ts`) has already replaced with a vi.fn() returning
 * `{ data: null, error: null }`. We override per-test as needed.
 *
 * Coverage: login / register / logout / resetPassword / getSession /
 * onAuthStateChange — both success + error paths.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { supabase } from '../../lib/supabase';
import { authApi } from './authApi';

beforeEach(() => {
    vi.clearAllMocks();
});

describe('authApi.login', () => {
    it('calls supabase.auth.signInWithPassword with the email + password', async () => {
        vi.mocked(supabase.auth.signInWithPassword).mockResolvedValueOnce({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            data: { user: { id: 'u1' }, session: { access_token: 't' } } as any,
            error: null,
        });
        const result = await authApi.login({ email: 'x@y.com', password: 'pw' });
        expect(supabase.auth.signInWithPassword).toHaveBeenCalledWith({
            email: 'x@y.com',
            password: 'pw',
        });
        expect(result).toEqual({ user: { id: 'u1' }, session: { access_token: 't' } });
    });

    it('throws when supabase returns an error', async () => {
        const err = new Error('Invalid credentials');
        vi.mocked(supabase.auth.signInWithPassword).mockResolvedValueOnce({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            data: { user: null, session: null } as any,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            error: err as any,
        });
        await expect(
            authApi.login({ email: 'a@b.com', password: 'bad' }),
        ).rejects.toBe(err);
    });
});

describe('authApi.register', () => {
    it('calls supabase.auth.signUp with the payload', async () => {
        // The setup file doesn't pre-mock signUp; install it lazily.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase.auth as any).signUp = vi.fn().mockResolvedValueOnce({
            data: { user: { id: 'u2' } },
            error: null,
        });
        const result = await authApi.register({ email: 'new@u.com', password: 'pw123' });
        expect(supabase.auth.signUp).toHaveBeenCalledWith({
            email: 'new@u.com',
            password: 'pw123',
        });
        expect(result).toEqual({ user: { id: 'u2' } });
    });

    it('throws when supabase signUp returns an error', async () => {
        const err = new Error('Email taken');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase.auth as any).signUp = vi.fn().mockResolvedValueOnce({ data: null, error: err });
        await expect(authApi.register({ email: 'a@b.com', password: 'pw' })).rejects.toBe(err);
    });
});

describe('authApi.logout', () => {
    it('calls supabase.auth.signOut and resolves on success', async () => {
        vi.mocked(supabase.auth.signOut).mockResolvedValueOnce({ error: null });
        await expect(authApi.logout()).resolves.toBeUndefined();
        expect(supabase.auth.signOut).toHaveBeenCalled();
    });

    it('throws when signOut returns an error', async () => {
        const err = new Error('Network down');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        vi.mocked(supabase.auth.signOut).mockResolvedValueOnce({ error: err as any });
        await expect(authApi.logout()).rejects.toBe(err);
    });
});

describe('authApi.resetPassword', () => {
    beforeEach(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase.auth as any).resetPasswordForEmail = vi.fn().mockResolvedValue({ error: null });
    });

    it('passes the email through to supabase', async () => {
        await authApi.resetPassword('forgot@me.com');
        expect(supabase.auth.resetPasswordForEmail).toHaveBeenCalledWith('forgot@me.com');
    });

    it('throws when supabase returns an error', async () => {
        const err = new Error('Email not found');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase.auth as any).resetPasswordForEmail = vi
            .fn()
            .mockResolvedValueOnce({ error: err });
        await expect(authApi.resetPassword('nope@me.com')).rejects.toBe(err);
    });
});

describe('authApi.getSession', () => {
    it('returns the session payload on success', async () => {
        const session = { access_token: 'abc', user: { id: 'u3' } };
        vi.mocked(supabase.auth.getSession).mockResolvedValueOnce({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            data: { session: session as any },
            error: null,
        });
        const result = await authApi.getSession();
        expect(result).toBe(session);
    });

    it('returns null when no session exists', async () => {
        vi.mocked(supabase.auth.getSession).mockResolvedValueOnce({
            data: { session: null },
            error: null,
        });
        const result = await authApi.getSession();
        expect(result).toBeNull();
    });

    it('throws when supabase getSession returns an error', async () => {
        const err = new Error('Network down');
        vi.mocked(supabase.auth.getSession).mockResolvedValueOnce({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            data: { session: null } as any,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            error: err as any,
        });
        await expect(authApi.getSession()).rejects.toBe(err);
    });
});

describe('authApi.onAuthStateChange', () => {
    it('forwards the callback to supabase.auth.onAuthStateChange', () => {
        const callback = vi.fn();
        const subscription = { data: { subscription: { unsubscribe: vi.fn() } } };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        vi.mocked(supabase.auth.onAuthStateChange).mockReturnValueOnce(subscription as any);
        const result = authApi.onAuthStateChange(callback);
        expect(supabase.auth.onAuthStateChange).toHaveBeenCalledWith(callback);
        expect(result).toBe(subscription);
    });
});

// TODO: a deeper test for `onAuthStateChange` could simulate dispatched
// events (SIGNED_IN, SIGNED_OUT) and assert the callback receives them.
// Left out — the wrapper is a pure pass-through and supabase-js owns the
// event semantics.
