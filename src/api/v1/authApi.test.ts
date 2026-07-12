
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { supabase } from '../../lib/supabase';
import { authApi } from './authApi';

beforeEach(() => {
    vi.clearAllMocks();
});

describe('authApi.login', () => {
    it('calls supabase.auth.signInWithPassword with the email + password', async () => {
        vi.mocked(supabase.auth.signInWithPassword).mockResolvedValueOnce({
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
            data: { user: null, session: null } as any,
            error: err as any,
        });
        await expect(
            authApi.login({ email: 'a@b.com', password: 'bad' }),
        ).rejects.toBe(err);
    });
});

describe('authApi.register', () => {
    it('calls supabase.auth.signUp with the payload', async () => {
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
        vi.mocked(supabase.auth.signOut).mockResolvedValueOnce({ error: err as any });
        await expect(authApi.logout()).rejects.toBe(err);
    });
});

describe('authApi.resetPassword', () => {
    beforeEach(() => {
        (supabase.auth as any).resetPasswordForEmail = vi.fn().mockResolvedValue({ error: null });
    });

    it('passes the email through to supabase', async () => {
        await authApi.resetPassword('forgot@me.com');
        expect(supabase.auth.resetPasswordForEmail).toHaveBeenCalledWith('forgot@me.com');
    });

    it('throws when supabase returns an error', async () => {
        const err = new Error('Email not found');
        (supabase.auth as any).resetPasswordForEmail = vi
            .fn()
            .mockResolvedValueOnce({ error: err });
        await expect(authApi.resetPassword('nope@me.com')).rejects.toBe(err);
    });
});

describe('authApi.updatePassword', () => {
    beforeEach(() => {
        (supabase.auth as any).updateUser = vi.fn().mockResolvedValue({ data: {}, error: null });
    });

    it('calls supabase.auth.updateUser with the new password', async () => {
        await authApi.updatePassword('newSecret123');
        expect(supabase.auth.updateUser).toHaveBeenCalledWith({ password: 'newSecret123' });
    });

    it('does not pass email / current password — only { password } (session-scoped)', async () => {
        await authApi.updatePassword('abcdef');
        const arg = vi.mocked(supabase.auth.updateUser).mock.calls[0][0];
        expect(Object.keys(arg as object)).toEqual(['password']);
    });

    it('throws when supabase returns an error (weak pw / expired session)', async () => {
        const err = new Error('Password should be at least 6 characters');
        (supabase.auth as any).updateUser = vi.fn().mockResolvedValueOnce({ data: {}, error: err });
        await expect(authApi.updatePassword('123')).rejects.toBe(err);
    });
});

describe('authApi.verifyCurrentPassword', () => {
    beforeEach(() => {
        vi.mocked(supabase.auth.getSession).mockResolvedValue({
            data: { session: { user: { email: 'me@grimshade.pl' } } } as any,
            error: null,
        });
        vi.mocked(supabase.auth.signInWithPassword).mockResolvedValue({
            data: { user: { id: 'u1' }, session: { access_token: 't' } } as any,
            error: null,
        });
    });

    it('re-authenticates with the session email + supplied password', async () => {
        await authApi.verifyCurrentPassword('oldpw');
        expect(supabase.auth.signInWithPassword).toHaveBeenCalledWith({
            email: 'me@grimshade.pl',
            password: 'oldpw',
        });
    });

    it('returns true when the password is correct', async () => {
        await expect(authApi.verifyCurrentPassword('oldpw')).resolves.toBe(true);
    });

    it('returns false when the password is wrong', async () => {
        vi.mocked(supabase.auth.signInWithPassword).mockResolvedValueOnce({
            data: null as any,
            error: { message: 'Invalid login credentials' } as never,
        });
        await expect(authApi.verifyCurrentPassword('bad')).resolves.toBe(false);
    });

    it('returns false (no re-auth attempt) when there is no active session', async () => {
        vi.mocked(supabase.auth.getSession).mockResolvedValueOnce({
            data: { session: null } as any,
            error: null,
        });
        vi.mocked(supabase.auth.signInWithPassword).mockClear();
        await expect(authApi.verifyCurrentPassword('whatever')).resolves.toBe(false);
        expect(supabase.auth.signInWithPassword).not.toHaveBeenCalled();
    });
});

describe('authApi.getSession', () => {
    it('returns the session payload on success', async () => {
        const session = { access_token: 'abc', user: { id: 'u3' } };
        vi.mocked(supabase.auth.getSession).mockResolvedValueOnce({
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
            data: { session: null } as any,
            error: err as any,
        });
        await expect(authApi.getSession()).rejects.toBe(err);
    });
});

describe('authApi.onAuthStateChange', () => {
    it('forwards the callback to supabase.auth.onAuthStateChange', () => {
        const callback = vi.fn();
        const subscription = { data: { subscription: { unsubscribe: vi.fn() } } };
        vi.mocked(supabase.auth.onAuthStateChange).mockReturnValueOnce(subscription as any);
        const result = authApi.onAuthStateChange(callback);
        expect(supabase.auth.onAuthStateChange).toHaveBeenCalledWith(callback);
        expect(result).toBe(subscription);
    });
});

